import { expect, it } from 'vitest';
import { KEYSTROKE_CODES } from '@opensekai/contracts';
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

it('answers a resent batch from the journal without applying it twice', () => {
 const store = loaded();
 const move = batch('same', [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 4, y: 4 } }]);
 const first = store.edit(move);
 const again = store.edit(move);
 expect(again).toEqual(first);
 expect(store.revision()).toBe(2);
});

it('rejects a reused batch id with different operations and keeps the store unchanged', () => {
 const store = loaded();
 store.edit(batch('same', [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 4, y: 4 } }]));
 const other = batch('same', [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 9, y: 9 } }]);
 expect(store.edit(other)).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'batchId already used', ids: ['same'] } });
 expect(store.revision()).toBe(2);
 const view = store.inspect();
 expect(view.kind === 'snapshot' && view.blueprints[1]!.nodes.find(n => n.id === 'wait')!.position).toEqual({ x: 4, y: 4 });
});

const keyGraphs = (count: number) => Array.from({ length: Math.ceil(count / 13) }, (_, g) => ({
 schemaVersion: 1, id: `k${g}`, name: 'K', enabled: true, connections: [],
 nodes: Array.from({ length: Math.min(13, count - g * 13) }, (_, n) => ({ id: `n${n}`, version: 1, type: 'event.keystroke',
  settings: { code: KEYSTROKE_CODES[g * 13 + n], control: true, alt: false, shift: false, meta: false }, position: { x: 0, y: 0 } })),
}));

it('rejects more than 64 active keystrokes and leaves the store unchanged', () => {
 const store = loaded();
 const before = JSON.stringify(store.inspect());
 expect(store.edit(batch('many', [{ kind: 'replaceAll', graphs: keyGraphs(65) }]))).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Too many active keystrokes', ids: [] } });
 expect(store.revision()).toBe(1);
 expect(JSON.stringify(store.inspect())).toBe(before);
 expect(store.edit(batch('fit', [{ kind: 'replaceAll', graphs: keyGraphs(64) }]))).toMatchObject({ ok: true, data: { revision: 2 } });
 const disabled = keyGraphs(65).map((g, i) => ({ ...g, enabled: i !== 0 }));
 expect(store.edit(batch('off', [{ kind: 'replaceAll', graphs: disabled }]))).toMatchObject({ ok: true });
});

it('rejects a Blueprint set above 192 KiB and leaves the store unchanged', () => {
 const store = loaded();
 const before = JSON.stringify(store.inspect());
 const wide = (graphs: number) => Array.from({ length: graphs }, (_, g) => ({
  schemaVersion: 1, id: `g${g}`, name: 'G', enabled: true, connections: [],
  nodes: Array.from({ length: 128 }, (_, n) => ({ id: `${'x'.repeat(250)}${n}`, version: 1, type: 'value.number', settings: { value: 0 }, position: { x: 0, y: 0 } })),
 }));
 expect(store.edit(batch('huge', [{ kind: 'replaceAll', graphs: wide(8) }]))).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: 'Blueprint set is too large', ids: [] } });
 expect(store.revision()).toBe(1);
 expect(JSON.stringify(store.inspect())).toBe(before);
 expect(store.edit(batch('ok', [{ kind: 'replaceAll', graphs: wide(4) }]))).toMatchObject({ ok: true });
});
