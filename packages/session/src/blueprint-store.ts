import { applyBlueprintOps, BlueprintBatchSchema, type AppError, type BlueprintBatch, type BlueprintGraph, type BlueprintInspect, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail } from './blueprint';
import { activeAccelerators, type BlueprintRuntime } from './blueprint-runtime';

const JOURNAL = 64, DELTA = 32, MAX_ACCELERATORS = 64, MAX_BYTES = 192 * 1024;
const encoder = new TextEncoder();
export interface BlueprintStore {
 edit(batch: unknown): Reply<{ revision: number; keystrokes: string[] }>;
 inspect(sinceRevision?: number, runtimeErrors?: ReadonlyMap<Id, AppError>): BlueprintInspect;
 revision(): number;
 active(graphId: Id): BlueprintGraph | undefined;
}

const withEnabled = (docs: readonly BlueprintGraph[], valid: ReadonlyMap<Id, BlueprintGraph>): BlueprintGraph[] =>
 docs.flatMap(doc => { const last = valid.get(doc.id); return last ? [{ ...last, enabled: doc.enabled }] : []; });

export function createBlueprintStore(runtime: BlueprintRuntime): BlueprintStore {
 let documents: BlueprintGraph[] = [], revision = 0;
 let journal: (BlueprintBatch & { revision: number })[] = [];
 const valid = new Map<Id, BlueprintGraph>();
 const compileErrors = new Map<Id, AppError>();
 return {
  edit(input) {
   const batch = BlueprintBatchSchema.safeParse(input);
   if (!batch.success) return fail('Invalid Blueprint batch');
   // A batch evicted from the 64-entry journal is no longer checked.
   const seen = journal.find(entry => entry.clientId === batch.data.clientId && entry.batchId === batch.data.batchId);
   if (seen) {
    if (JSON.stringify(seen.ops) !== JSON.stringify(batch.data.ops)) return fail('batchId already used', [batch.data.batchId]);
    return { ok: true, data: { revision: seen.revision, keystrokes: runtime.keystrokes() } };
   }
   if (!Number.isSafeInteger(revision + 1)) return fail('Revision limit reached');
   const next = applyBlueprintOps(documents, batch.data.ops);
   if (!next.ok) return next;
   if (encoder.encode(JSON.stringify(next.data)).length > MAX_BYTES) return fail('Blueprint set is too large');
   const nextValid = new Map([...valid].filter(([id]) => next.data.some(doc => doc.id === id)));
   const nextErrors = new Map([...compileErrors].filter(([id]) => next.data.some(doc => doc.id === id)));
   for (const doc of next.data) {
    const compiled = compileBlueprint(doc);
    if (compiled.ok) { nextValid.set(doc.id, compiled.data.graph); nextErrors.delete(doc.id); }
    else nextErrors.set(doc.id, compiled.error);
   }
   const nextActive = withEnabled(next.data, nextValid);
   if (activeAccelerators(nextActive).length > MAX_ACCELERATORS) return fail('Too many active keystrokes');
   const installed = runtime.install(nextActive);
   if (!installed.ok) return installed;
   documents = next.data;
   valid.clear(); for (const [id, graph] of nextValid) valid.set(id, graph);
   compileErrors.clear(); for (const [id, error] of nextErrors) compileErrors.set(id, error);
   revision += 1;
   journal = [...journal, { ...batch.data, revision }].slice(-JOURNAL);
   return { ok: true, data: { revision, keystrokes: runtime.keystrokes() } };
  },
  inspect(since, runtimeErrors = new Map()) {
   const errors = [
    ...[...compileErrors].map(([graphId, error]) => ({ graphId, kind: 'compile' as const, error })),
    ...[...runtimeErrors].filter(([graphId]) => documents.some(doc => doc.id === graphId)).map(([graphId, error]) => ({ graphId, kind: 'runtime' as const, error })),
   ].slice(0, 16);
   const oldest = journal[0]?.revision ?? revision + 1;
   const range = since === undefined ? [] : journal.filter(entry => entry.revision > since);
   const delta = since !== undefined && since <= revision && since >= oldest - 1 && range.length <= DELTA
    && !range.some(entry => entry.ops.some(op => op.kind === 'replaceAll' || op.kind === 'createGraph'));
   return delta
    ? { kind: 'delta', revision, batches: structuredClone(range), errors, keystrokes: runtime.keystrokes() }
    : { kind: 'snapshot', revision, blueprints: structuredClone(documents), errors, keystrokes: runtime.keystrokes() };
  },
  revision: () => revision,
  active: graphId => { const doc = documents.find(item => item.id === graphId); const last = valid.get(graphId); return doc && last ? { ...last, enabled: doc.enabled } : undefined; },
 };
}
