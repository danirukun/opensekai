import { createSandbox, type Catalog, type EvaluateResult, type LoadResult, type LogEntry, type SandboxOptions } from './sandbox';
import type { ExtensionStatus, FailureCause } from './manifest';

export type WorkerRequest =
 | { id: number; call: 'load'; manifest: unknown; source: string }
 | { id: number; call: 'evaluate'; type: string; inputs: unknown }
 | { id: number; call: 'unload'; extensionId: string }
 | { id: number; call: 'catalog' };

export type WorkerReply =
 | { id: number; call: 'load'; result: LoadResult; catalog: Catalog }
 | { id: number; call: 'evaluate'; result: EvaluateResult }
 | { id: number; call: 'unload'; result: boolean; catalog: Catalog }
 | { id: number; call: 'catalog'; result: Catalog; statuses: ExtensionStatus[] };

export type WorkerEvent =
 | { event: 'failed'; extensionId: string; cause: FailureCause }
 | { event: 'log'; entry: LogEntry };

export type WorkerMessage = WorkerReply | WorkerEvent;

// The worker side of the protocol. Every message is plain data, so it crosses postMessage by structured clone.
export async function createExtensionWorker(post: (message: WorkerMessage) => void, options: Omit<SandboxOptions, 'onLog' | 'onFailure'> = {}) {
 const sandbox = await createSandbox({
  ...options,
  onLog: entry => post({ event: 'log', entry }),
  onFailure: (extensionId, cause) => post({ event: 'failed', extensionId, cause }),
 });
 // Requests run one at a time in arrival order, so a load cannot interleave with an evaluation.
 let queue: Promise<void> = Promise.resolve();
 const handle = async (request: WorkerRequest): Promise<void> => {
  switch (request.call) {
   case 'load': {
    const result = await sandbox.load(request.manifest, request.source);
    return post({ id: request.id, call: 'load', result, catalog: sandbox.catalog() });
   }
   case 'evaluate': return post({ id: request.id, call: 'evaluate', result: sandbox.evaluate(request.type, request.inputs) });
   case 'unload': return post({ id: request.id, call: 'unload', result: sandbox.unload(request.extensionId), catalog: sandbox.catalog() });
   case 'catalog': return post({ id: request.id, call: 'catalog', result: sandbox.catalog(), statuses: sandbox.statuses() });
  }
 };
 return {
  // A request whose reply cannot be posted gets no reply; the client watchdog then replaces the worker.
  receive: (request: WorkerRequest) => { queue = queue.then(() => handle(request)).catch(() => undefined); return queue; },
  dispose: () => sandbox.dispose(),
 };
}

interface WorkerScope { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void }

// Call this from a dedicated Web Worker module with its global scope.
export function installExtensionWorker(scope: WorkerScope, options?: Omit<SandboxOptions, 'onLog' | 'onFailure' | 'now'>) {
 const ready = createExtensionWorker(message => scope.postMessage(message), options);
 // Listen at once; requests that arrive before the sandbox is ready wait for it in order.
 scope.addEventListener('message', event => { void ready.then(worker => worker.receive(event.data)); });
 return ready;
}
