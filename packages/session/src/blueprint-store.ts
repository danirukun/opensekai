import { applyBlueprintOps, BlueprintBatchSchema, type AppError, type BlueprintBatch, type BlueprintGraph, type BlueprintInspect, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail, type CompiledBlueprint } from './blueprint';
import { activeAccelerators, type BlueprintRuntime } from './blueprint-runtime';

const JOURNAL = 64, DELTA = 32, MAX_ACCELERATORS = 64, MAX_BYTES = 192 * 1024, DELTA_BYTES = 160 * 1024;
const encoder = new TextEncoder();
export interface BlueprintStore {
 edit(batch: unknown): Reply<{ revision: number; keystrokes: string[] }>;
 inspect(sinceRevision?: number, runtimeErrors?: ReadonlyMap<Id, AppError>): BlueprintInspect;
 revision(): number;
 active(graphId: Id): BlueprintGraph | undefined;
}

// The last valid version keeps the executable content of its compile; `enabled` always comes from the current document.
const withEnabled = (docs: readonly BlueprintGraph[], valid: ReadonlyMap<Id, CompiledBlueprint>): CompiledBlueprint[] =>
 docs.flatMap(doc => {
  const last = valid.get(doc.id);
  return last ? [last.graph.enabled === doc.enabled ? last : { ...last, graph: { ...last.graph, enabled: doc.enabled } }] : [];
 });

export function createBlueprintStore(runtime: BlueprintRuntime): BlueprintStore {
 let documents: BlueprintGraph[] = [], revision = 0;
 let journal: (BlueprintBatch & { revision: number })[] = [];
 const valid = new Map<Id, CompiledBlueprint>(), keys = new Map<Id, string>();
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
   const opened = batch.data.ops.some(op => op.kind === 'replaceAll');
   const recreated = new Set(batch.data.ops.flatMap(op => op.kind === 'createGraph' ? [op.graph.id] : []));
   const nextKeys = new Map(next.data.map(doc => [doc.id, JSON.stringify(doc)] as const));
   const nextValid = new Map([...valid].filter(([id]) => !opened && !recreated.has(id) && nextKeys.has(id)));
   const nextErrors = new Map([...compileErrors].filter(([id]) => !opened && !recreated.has(id) && nextKeys.has(id)));
   for (const doc of next.data) {
    if ((nextValid.has(doc.id) || nextErrors.has(doc.id)) && keys.get(doc.id) === nextKeys.get(doc.id)) continue;
    const compiled = compileBlueprint(doc);
    if (compiled.ok) { nextValid.set(doc.id, compiled.data); nextErrors.delete(doc.id); }
    else nextErrors.set(doc.id, compiled.error);
   }
   const nextActive = withEnabled(next.data, nextValid);
   if (activeAccelerators(nextActive.map(entry => entry.graph)).length > MAX_ACCELERATORS) return fail('Too many active keystrokes');
   runtime.installCompiled(nextActive, opened);
   documents = next.data;
   valid.clear(); for (const [id, compiled] of nextValid) valid.set(id, compiled);
   compileErrors.clear(); for (const [id, error] of nextErrors) compileErrors.set(id, error);
   keys.clear(); for (const [id, key] of nextKeys) keys.set(id, key);
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
   const keystrokes = runtime.keystrokes();
   const reply: BlueprintInspect = delta
    ? { kind: 'delta', revision, batches: structuredClone(range), errors, keystrokes }
    : { kind: 'snapshot', revision, blueprints: structuredClone(documents), errors, keystrokes };
   return reply.kind === 'delta' && encoder.encode(JSON.stringify(reply)).length > DELTA_BYTES
    ? { kind: 'snapshot', revision, blueprints: structuredClone(documents), errors, keystrokes }
    : reply;
  },
  revision: () => revision,
  active: graphId => { const doc = documents.find(item => item.id === graphId); const last = valid.get(graphId)?.graph; return doc && last ? { ...last, enabled: doc.enabled } : undefined; },
 };
}
