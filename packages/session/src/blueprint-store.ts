import { applyBlueprintOps, BlueprintBatchSchema, type AppError, type BlueprintBatch, type BlueprintGraph, type BlueprintInspect, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail } from './blueprint';
import type { BlueprintRuntime } from './blueprint-runtime';

const JOURNAL = 64, DELTA = 32;
export interface BlueprintStore {
 edit(batch: unknown): Reply<{ revision: number; keystrokes: string[] }>;
 inspect(sinceRevision?: number, runtimeErrors?: ReadonlyMap<Id, AppError>): BlueprintInspect;
 revision(): number;
 active(graphId: Id): BlueprintGraph | undefined;
}

export function createBlueprintStore(runtime: BlueprintRuntime): BlueprintStore {
 let documents: BlueprintGraph[] = [], revision = 0;
 let journal: (BlueprintBatch & { revision: number })[] = [];
 const valid = new Map<Id, BlueprintGraph>();
 const compileErrors = new Map<Id, AppError>();
 const activeSet = () => documents.flatMap(doc => { const last = valid.get(doc.id); return last ? [{ ...last, enabled: doc.enabled }] : []; });
 return {
  edit(input) {
   const batch = BlueprintBatchSchema.safeParse(input);
   if (!batch.success) return fail('Invalid Blueprint batch');
   if (!Number.isSafeInteger(revision + 1)) return fail('Revision limit reached');
   const next = applyBlueprintOps(documents, batch.data.ops);
   if (!next.ok) return next;
   documents = next.data;
   for (const id of [...valid.keys()]) if (!documents.some(doc => doc.id === id)) { valid.delete(id); compileErrors.delete(id); }
   for (const doc of documents) {
    const compiled = compileBlueprint(doc);
    if (compiled.ok) { valid.set(doc.id, compiled.data.graph); compileErrors.delete(doc.id); }
    else compileErrors.set(doc.id, compiled.error);
   }
   const installed = runtime.install(activeSet());
   if (!installed.ok) return installed;
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
    ? { kind: 'delta', revision, batches: structuredClone(range), errors }
    : { kind: 'snapshot', revision, blueprints: structuredClone(documents), errors };
  },
  revision: () => revision,
  active: graphId => { const doc = documents.find(item => item.id === graphId); const last = valid.get(graphId); return doc && last ? { ...last, enabled: doc.enabled } : undefined; },
 };
}
