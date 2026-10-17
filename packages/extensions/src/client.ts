import type { ExtensionStatus, FailureCause } from './manifest';
import type { Catalog, EvaluateResult, LoadResult, LogEntry } from './sandbox';
import type { WorkerMessage, WorkerReply, WorkerRequest } from './worker';

export interface WorkerPort {
 post(request: WorkerRequest): void;
 listen(handler: (message: WorkerMessage) => void): void;
 terminate(): void;
}

export interface ClientOptions {
 spawn: () => WorkerPort;
 // The longest time the worker may stay silent while a request waits.
 watchdogMs?: number;
 // Extra time for a new worker before its first message (module start and WASM compile).
 startupMs?: number;
 setTimer?: (run: () => void, ms: number) => unknown;
 clearTimer?: (timer: unknown) => void;
 onFailure?: (extensionId: string, cause: FailureCause) => void;
 onLog?: (entry: LogEntry) => void;
}

type Request = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;
interface Pending { request: WorkerRequest; owner: string | undefined; resolve: (reply: WorkerReply) => void }

const EMPTY: Catalog = { nodes: [], assetTypes: [] };
const UNRESPONSIVE: FailureCause = { code: 'unresponsive', message: 'The extension worker stopped answering and was replaced' };

// Main-thread side. It owns the worker lifetime: when the worker stops answering, it terminates the worker,
// disables the extension whose request was running, and loads the other extensions into a new worker.
export function createExtensionClient(options: ClientOptions) {
 const watchdogMs = options.watchdogMs ?? 2000;
 const startupMs = options.startupMs ?? 5000;
 const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
 const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
 const sources = new Map<string, { manifest: unknown; source: string }>();
 const failures = new Map<string, FailureCause>();
 const pending = new Map<number, Pending>();
 let catalog: Catalog = EMPTY;
 let nextId = 1, generation = 0, timer: unknown = null, closed = false, fresh = true;
 let port: WorkerPort;

 const markFailed = (extensionId: string, cause: FailureCause) => {
  sources.delete(extensionId);
  failures.set(extensionId, cause);
  catalog = { nodes: catalog.nodes.filter(n => n.extensionId !== extensionId), assetTypes: catalog.assetTypes.filter(a => a.extensionId !== extensionId) };
  options.onFailure?.(extensionId, cause);
 };

 const arm = () => {
  if (timer !== null) clearTimer(timer);
  timer = pending.size > 0 ? setTimer(recover, watchdogMs + (fresh ? startupMs : 0)) : null;
 };

 const receive = (from: number) => (message: WorkerMessage) => {
  if (from !== generation) return;
  fresh = false;
  if ('event' in message) {
   if (message.event === 'failed') markFailed(message.extensionId, message.cause);
   else options.onLog?.(message.entry);
   arm();
   return;
  }
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.call === 'load' || message.call === 'unload') catalog = message.catalog;
  if (message.call === 'catalog') catalog = message.result;
  entry.resolve(message);
  arm();
 };

 const start = () => {
  generation += 1;
  fresh = true;
  port = options.spawn();
  port.listen(receive(generation));
 };

 const ownerOf = (request: WorkerRequest): string | undefined => {
  if (request.call === 'load') {
   const id = (request.manifest as { id?: unknown } | null)?.id;
   return typeof id === 'string' ? id : undefined;
  }
  if (request.call === 'evaluate') return catalog.nodes.find(node => node.type === request.type)?.extensionId;
  if (request.call === 'unload') return request.extensionId;
  return undefined;
 };

 const send = (request: Request): Promise<WorkerReply> => new Promise(resolve => {
  const full = { ...request, id: nextId++ } as WorkerRequest;
  pending.set(full.id, { request: full, owner: ownerOf(full), resolve });
  port.post(full);
  if (pending.size === 1) arm();
 });

 const answerUnresponsive = (request: WorkerRequest): WorkerReply => {
  const id = request.id;
  switch (request.call) {
   case 'load': return { id, call: 'load', result: { ok: true, status: { id: ownerOf(request) ?? '', state: 'failed', cause: UNRESPONSIVE } }, catalog };
   case 'evaluate': return { id, call: 'evaluate', result: { ok: false, failure: UNRESPONSIVE } };
   case 'unload': return { id, call: 'unload', result: true, catalog };
   case 'catalog': return { id, call: 'catalog', result: catalog, statuses: statuses() };
  }
 };

 const CLOSED = { code: 'closed', message: 'Extension client is closed' } as const;
 const answerClosed = (request: WorkerRequest): WorkerReply => {
  const id = request.id;
  switch (request.call) {
   case 'load': return { id, call: 'load', result: { ok: false, reject: CLOSED }, catalog };
   case 'evaluate': return { id, call: 'evaluate', result: { ok: false, reject: CLOSED } };
   case 'unload': return { id, call: 'unload', result: false, catalog };
   case 'catalog': return { id, call: 'catalog', result: catalog, statuses: statuses() };
  }
 };

 function recover() {
  timer = null;
  const [head, ...rest] = [...pending.values()];
  if (!head) return;
  port.terminate();
  pending.clear();
  const culprit = head.owner;
  // An unload that stalls still removes the extension; it is not reported as a failure.
  if (culprit !== undefined && head.request.call !== 'unload') markFailed(culprit, UNRESPONSIVE);
  head.resolve(answerUnresponsive(head.request));
  start();
  const survivors = [...sources];
  sources.clear();
  catalog = EMPTY;
  for (const [, saved] of survivors) void load(saved.manifest, saved.source);
  // Requests that waited behind the stalled one run again in the new worker, after the reloads.
  for (const entry of rest) {
   if (entry.request.call === 'load' && entry.owner === culprit) { entry.resolve(answerUnresponsive(entry.request)); continue; }
   const { id: _, ...request } = entry.request;
   void send(request as Request).then(reply => entry.resolve({ ...reply, id: entry.request.id } as WorkerReply));
  }
 }

 async function load(manifest: unknown, source: string): Promise<LoadResult> {
  if (closed) return { ok: false, reject: CLOSED };
  const reply = await send({ call: 'load', manifest, source });
  if (reply.call !== 'load') throw new Error('Mismatched reply');
  if (reply.result.ok && reply.result.status.state === 'ready') {
   sources.set(reply.result.status.id, { manifest, source });
   failures.delete(reply.result.status.id);
  }
  return reply.result;
 }

 async function evaluate(type: string, inputs: unknown): Promise<EvaluateResult> {
  if (closed) return { ok: false, reject: CLOSED };
  const reply = await send({ call: 'evaluate', type, inputs });
  if (reply.call !== 'evaluate') throw new Error('Mismatched reply');
  return reply.result;
 }

 async function unload(extensionId: string): Promise<boolean> {
  if (closed) return false;
  sources.delete(extensionId);
  failures.delete(extensionId);
  const reply = await send({ call: 'unload', extensionId });
  return reply.call === 'unload' && reply.result;
 }

 function statuses(): ExtensionStatus[] {
  return [
   ...[...sources.keys()].map(id => ({ id, state: 'ready' as const })),
   ...[...failures].map(([id, cause]) => ({ id, state: 'failed' as const, cause })),
  ];
 }

 const close = () => {
  if (closed) return;
  closed = true;
  generation += 1;
  if (timer !== null) clearTimer(timer);
  port.terminate();
  for (const entry of pending.values()) entry.resolve(answerClosed(entry.request));
  pending.clear();
 };

 start();
 return { load, evaluate, unload, statuses, catalog: () => catalog, close };
}

export type ExtensionClient = ReturnType<typeof createExtensionClient>;
