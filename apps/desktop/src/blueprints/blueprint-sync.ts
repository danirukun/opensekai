import { applyBlueprintOps, type AppApi, type ErrorCode, type BlueprintGraph, type BlueprintInspect, type BlueprintOp, type BlueprintStatus, type Id, type Reply } from '@opensekai/contracts';

export type SyncIssue = { kind: 'rejected'; code: ErrorCode; message: string } | { kind: 'unavailable' } | null;
// A missing graph or node, or a batch that no longer applies after a remote change, means another client got there first.
export const issueText = (issue: SyncIssue): string =>
 issue?.kind === 'unavailable' ? 'Session unavailable'
  : issue?.kind === 'rejected' ? (issue.code === 'NOT_FOUND' || issue.code === 'CONFLICT' ? 'Changed elsewhere' : issue.message)
  : '';
export interface BlueprintSync {
 view(): BlueprintGraph[]; revision(): number; errors(): BlueprintStatus[]; issue(): SyncIssue;
 load(): Promise<void>; pull(): Promise<void>; poll(): Promise<void>; edit(ops: BlueprintOp[]): Reply<BlueprintGraph[]>; idle(): Promise<void>;
 subscribe(fn: (next: BlueprintGraph[], previous: BlueprintGraph[]) => void): () => void;
}
interface Pending { batchId: Id; ops: BlueprintOp[]; sent: boolean; revision?: number }
const isMove = (ops: BlueprintOp[]) => ops.length === 1 && ops[0]!.kind === 'moveNode';
const sameMove = (a: BlueprintOp[], b: BlueprintOp[]) => isMove(a) && isMove(b) && a[0]!.kind === 'moveNode' && b[0]!.kind === 'moveNode' && a[0].graphId === b[0].graphId && a[0].nodeId === b[0].nodeId;

export function createBlueprintSync(api: Pick<AppApi, 'blueprintEdit' | 'blueprintInspect'>, clientId: Id = crypto.randomUUID()): BlueprintSync {
 let confirmed: BlueprintGraph[] = [], view: BlueprintGraph[] = [], revision = 0, pending: Pending[] = [];
 let errors: BlueprintStatus[] = [], issue: SyncIssue = null;
 let sending: Promise<void> | null = null, pulling: Promise<void> | null = null, loading: Promise<void> | null = null;
 const listeners = new Set<(next: BlueprintGraph[], previous: BlueprintGraph[]) => void>();
 const show = (next: BlueprintGraph[]) => { const previous = view; view = next; for (const fn of listeners) fn(next, previous); };
 // Server reconciliation: confirmed server state, then this client's unconfirmed batches applied again on top.
 const rebuild = () => {
  let next = confirmed;
  pending = pending.filter(batch => {
   const r = applyBlueprintOps(next, batch.ops);
   if (r.ok) next = r.data;
   else if (!batch.sent) issue = { kind: 'rejected', code: 'CONFLICT', message: r.error.message };
   return r.ok || batch.sent;
  });
  show(next);
 };
 const adopt = async (reply: BlueprintInspect): Promise<void> => {
  if (reply.revision < revision) return;
  if (reply.kind === 'snapshot') confirmed = reply.blueprints;
  else {
   if (reply.batches.length > 0 && reply.batches[0]!.revision !== revision + 1) return fetch();
   for (const batch of reply.batches) {
    const r = applyBlueprintOps(confirmed, batch.ops);
    if (!r.ok) return fetch();
    confirmed = r.data;
    if (batch.clientId === clientId) pending = pending.filter(p => p.batchId !== batch.batchId);
   }
  }
  revision = reply.revision; errors = reply.errors;
  pending = pending.filter(p => p.revision === undefined || p.revision > revision);
  rebuild();
 };
 const fetch = async (sinceRevision?: number): Promise<void> => {
  try {
   const reply = await api.blueprintInspect(sinceRevision === undefined ? {} : { sinceRevision });
   if (!reply.ok) { issue = { kind: 'unavailable' }; return; }
   if (issue?.kind === 'unavailable' && !pending.some(p => !p.sent)) issue = null;
   await adopt(reply.data);
  } catch { issue = { kind: 'unavailable' }; }
 };
 // Inspect calls run one at a time, so a late reply cannot overtake a newer one. A queued pull reads the revision when it starts.
 let queue: Promise<unknown> = Promise.resolve();
 const enqueue = (job: () => Promise<void>): Promise<void> => { const done = queue.then(job); queue = done; return done; };
 const load = (): Promise<void> => {
  if (!loading) loading = enqueue(() => fetch()).finally(() => { loading = null; });
  return loading;
 };
 const pull = (): Promise<void> => {
  if (!pulling) pulling = enqueue(() => fetch(revision)).finally(() => { pulling = null; });
  return pulling;
 };
 // Returns false when the session could not be reached, so the loop stops instead of spinning.
 const drain = async (): Promise<boolean> => {
  try {
   for (let batch = pending.find(p => !p.sent); batch; batch = pending.find(p => !p.sent)) {
    batch.sent = true;
    const reply = await api.blueprintEdit({ clientId, batchId: batch.batchId, ops: batch.ops });
    if (reply.ok) { batch.revision = reply.data.revision; if (issue?.kind === 'unavailable') issue = null; continue; }
    pending = pending.filter(p => p !== batch);
    issue = { kind: 'rejected', code: reply.error.code, message: reply.error.message };
    await load();
   }
   return true;
  } catch {
   issue = { kind: 'unavailable' };
   for (const p of pending) if (p.revision === undefined) p.sent = false;
   return false;
  }
 };
 const sendLoop = async (): Promise<void> => {
  do {
   const reached = await drain();
   await pull();
   if (!reached) return;
  } while (pending.some(p => !p.sent));
 };
 const flush = (): Promise<void> => {
  if (!sending) sending = sendLoop().finally(() => { sending = null; });
  return sending;
 };
 return {
  view: () => view, revision: () => revision, errors: () => errors, issue: () => issue,
  load, pull,
  // One poll tick: resend unsent batches (for example after an outage), then pull the journal.
  poll: () => pending.some(p => !p.sent) ? flush() : pull(),
  edit(ops) {
   const result = applyBlueprintOps(view, ops);
   if (!result.ok) return result;
   const last = pending.at(-1);
   if (last && !last.sent && sameMove(last.ops, ops)) last.ops = ops;
   else pending.push({ batchId: crypto.randomUUID(), ops, sent: false });
   if (issue?.kind === 'rejected') issue = null;
   show(result.data);
   void flush();
   return result;
  },
  async idle() { while (sending || pulling || loading) await (sending ?? pulling ?? loading); },
  subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
 };
}
