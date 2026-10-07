import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { createBlueprintStore } from '../src/blueprint-store';

const batch = (batchId: string, ops: object[]) => ({ clientId: 'c', batchId, ops });
const loaded = () => { const store = createBlueprintStore(createBlueprintRuntime()); store.edit(batch('load', [{ kind: 'replaceAll', graphs: fixture.blueprints }])); return store; };

it('applies batches in order, journals them, and returns active accelerators', () => {
 const store = loaded();
 expect(store.edit(batch('b2', [{ kind: 'updateGraph', graphId: 'toggle-performer', enabled: false }]))).toEqual({ ok: true, data: { revision: 2, keystrokes: ['Control+Alt+KeyJ'] } });
 expect(store.inspect(1)).toMatchObject({ kind: 'delta', revision: 2, batches: [{ revision: 2, batchId: 'b2' }], errors: [] });
 expect(store.inspect(2)).toMatchObject({ kind: 'delta', batches: [] });
});

it('answers with a snapshot outside the journal or across a whole-graph batch', () => {
 const store = loaded();
 expect(store.inspect(0)).toMatchObject({ kind: 'snapshot', revision: 1 });
 expect(store.inspect()).toMatchObject({ kind: 'snapshot' });
 // After load (revision 1) and 70 moves, revision is 71 and the journal holds revisions 8–71.
 for (let i = 0; i < 70; i++) store.edit(batch(`m${i}`, [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: i, y: 0 } }]));
 expect(store.inspect(2)).toMatchObject({ kind: 'snapshot' });
 expect(store.inspect(30)).toMatchObject({ kind: 'snapshot' });
 expect(store.inspect(39)).toMatchObject({ kind: 'delta', revision: 71 });
});

it('keeps a document that does not compile, reports it, and keeps the last valid version active', () => {
 const store = loaded();
 const reply = store.edit(batch('cut', [{ kind: 'disconnect', graphId: 'flash-marker', connectionId: 'w2' }]));
 expect(reply).toMatchObject({ ok: true, data: { keystrokes: ['Control+Alt+KeyH', 'Control+Alt+KeyJ'] } });
 const view = store.inspect();
 expect(view.kind === 'snapshot' && view.blueprints[1]!.connections.map(c => c.id)).not.toContain('w2');
 expect(view.errors).toEqual([{ graphId: 'flash-marker', kind: 'compile', error: expect.objectContaining({ message: 'Blueprint input is not connected', ids: ['show'] }) }]);
 expect(store.active('flash-marker')!.connections.map(c => c.id)).toContain('w2');
 store.edit(batch('off', [{ kind: 'updateGraph', graphId: 'flash-marker', enabled: false }]));
 expect(store.active('flash-marker')!.enabled).toBe(false);
});

it('rejects a batch that names a missing node and does not advance the revision', () => {
 const store = loaded();
 expect(store.edit(batch('x', [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'nope' }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(store.revision()).toBe(1);
});
