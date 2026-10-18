import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintBatchSchema, BlueprintGraphSchema, BlueprintSetSchema, copyName, derivedId, exportBlueprint, importBlueprint, makeSmokeScene, serializeBlueprintFile, type BlueprintComment, type BlueprintGraph, type BlueprintOp } from '../src';

const base = () => BlueprintSetSchema.parse(structuredClone(fixture.blueprints));
const ok = (r: ReturnType<typeof applyBlueprintOps>) => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const find = (gs: BlueprintGraph[], id: string) => gs.find(g => g.id === id)!;
const note = (id: string, extra: Partial<BlueprintComment> = {}): BlueprintComment => ({ id, text: 'Setup', position: { x: -20, y: -40 }, size: { width: 400, height: 260 }, ...extra });
const add = (comment: BlueprintComment): BlueprintOp => ({ kind: 'addComment', graphId: 'flash-marker', comment });

it('loads a graph without comments unchanged and bounds comment count, text, and size', () => {
 const [first] = base();
 expect(first).not.toHaveProperty('comments');
 const graph = { ...first!, comments: [note('c1')] };
 expect(BlueprintGraphSchema.parse(graph).comments).toEqual([note('c1')]);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: [note('c1'), note('c1')] }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: Array.from({ length: 33 }, (_, i) => note(`c${i}`)) }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: [note('c1', { text: 'x'.repeat(513) })] }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: [note('c1', { text: '' })] }).success).toBe(true);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: [note('c1', { size: { width: 63, height: 100 } })] }).success).toBe(false);
 expect(BlueprintGraphSchema.safeParse({ ...graph, comments: [note('c1', { position: { x: Number.NaN, y: 0 } })] }).success).toBe(false);
});

it('adds, updates, and removes a comment, and rejects a duplicate or missing one', () => {
 let gs = ok(applyBlueprintOps(base(), [add(note('c1'))]));
 expect(find(gs, 'flash-marker').comments).toEqual([note('c1')]);
 expect(applyBlueprintOps(gs, [add(note('c1'))])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['c1'] } });
 gs = ok(applyBlueprintOps(gs, [{ kind: 'updateComment', graphId: 'flash-marker', commentId: 'c1', text: 'Flash', position: { x: 5, y: 6 } }]));
 expect(find(gs, 'flash-marker').comments).toEqual([note('c1', { text: 'Flash', position: { x: 5, y: 6 } })]);
 gs = ok(applyBlueprintOps(gs, [{ kind: 'updateComment', graphId: 'flash-marker', commentId: 'c1', size: { width: 64, height: 8192 } }]));
 expect(find(gs, 'flash-marker').comments![0]!.size).toEqual({ width: 64, height: 8192 });
 expect(applyBlueprintOps(gs, [{ kind: 'updateComment', graphId: 'flash-marker', commentId: 'nope', text: '' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['nope'] } });
 expect(applyBlueprintOps(gs, [{ kind: 'removeComment', graphId: 'flash-marker', commentId: 'nope' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 gs = ok(applyBlueprintOps(gs, [{ kind: 'removeComment', graphId: 'flash-marker', commentId: 'c1' }]));
 expect(find(gs, 'flash-marker').comments).toEqual([]);
 expect(applyBlueprintOps(base(), Array.from({ length: 33 }, (_, i) => add(note(`c${i}`))))).toMatchObject({ ok: false, error: { message: 'Blueprint set exceeds its limits' } });
});

it('validates the new operations in a batch', () => {
 const batch = (ops: unknown[]) => BlueprintBatchSchema.safeParse({ clientId: 'c', batchId: 'b', ops }).success;
 expect(batch([add(note('c1')), { kind: 'duplicateGraph', graphId: 'g', newGraphId: 'h' }, { kind: 'removeComment', graphId: 'g', commentId: 'c1' }])).toBe(true);
 expect(batch([{ kind: 'updateComment', graphId: 'g', commentId: 'c1', text: 'x'.repeat(513) }])).toBe(false);
 expect(batch([{ kind: 'updateComment', graphId: 'g', commentId: 'c1', size: { width: 10, height: 100 } }])).toBe(false);
 expect(batch([{ kind: 'duplicateGraph', graphId: 'g', newGraphId: 'h', name: '  ' }])).toBe(false);
});

it('derives the same copy IDs on every call and different IDs for another seed', () => {
 expect(derivedId('g2', 'node')).toBe(derivedId('g2', 'node'));
 expect(derivedId('g2', 'node')).toMatch(/^[0-9a-f]{32}$/);
 expect(derivedId('g3', 'node')).not.toBe(derivedId('g2', 'node'));
 expect(derivedId('g2', 'node2')).not.toBe(derivedId('g2', 'node'));
});

it('names a copy after the first free "copy" name and keeps it within 128 code units', () => {
 expect(copyName('Flash', [])).toBe('Flash copy');
 expect(copyName('Flash', ['Flash copy', 'Flash copy 2'])).toBe('Flash copy 3');
 const long = copyName('x'.repeat(128), []);
 expect(long).toHaveLength(128);
 expect(long.endsWith(' copy')).toBe(true);
 // A surrogate pair at the cut is dropped whole, not split.
 const emoji = copyName(`${'x'.repeat(122)}😀z`, []);
 expect(emoji).toBe(`${'x'.repeat(122)} copy`);
 expect(copyName(`${'x'.repeat(121)}😀z`, [])).toBe(`${'x'.repeat(121)}😀 copy`);
});

it('duplicates a graph with new node, wire, and comment IDs, disabled, after its source', () => {
 const source = ok(applyBlueprintOps(base(), [add(note('c1'))]));
 const gs = ok(applyBlueprintOps(source, [{ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'copy-1' }]));
 expect(gs.map(g => g.id)).toEqual(['toggle-performer', 'flash-marker', 'copy-1', 'disabled']);
 const original = find(gs, 'flash-marker'), copy = find(gs, 'copy-1');
 expect(copy.name).toBe('Flash marker copy');
 expect(copy.enabled).toBe(false);
 const map = new Map(original.nodes.map(n => [n.id, derivedId('copy-1', n.id)] as const));
 expect(copy.nodes).toEqual(original.nodes.map(n => ({ ...n, id: map.get(n.id) })));
 expect(copy.connections).toEqual(original.connections.map(c => ({ ...c, id: derivedId('copy-1', c.id), sourceNodeId: map.get(c.sourceNodeId), targetNodeId: map.get(c.targetNodeId) })));
 expect(copy.comments).toEqual([{ ...note('c1'), id: derivedId('copy-1', 'c1') }]);
 expect(copy.variables).toEqual(original.variables);
 // The same batch on another client gives the same result.
 expect(ok(applyBlueprintOps(source, [{ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'copy-1' }]))).toEqual(gs);
 const named = ok(applyBlueprintOps(gs, [{ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'copy-2' }, { kind: 'duplicateGraph', graphId: 'toggle-performer', newGraphId: 'copy-3', name: 'Mine' }]));
 expect(named.map(g => g.name).slice(0, 5)).toEqual(['Toggle performer', 'Mine', 'Flash marker', 'Flash marker copy 2', 'Flash marker copy']);
 expect(find(ok(applyBlueprintOps(base(), [{ kind: 'duplicateGraph', graphId: 'toggle-performer', newGraphId: 'x' }])), 'x')).not.toHaveProperty('comments');
});

it('rejects a duplicate of a missing graph, to a used ID, or past 8 graphs', () => {
 expect(applyBlueprintOps(base(), [{ kind: 'duplicateGraph', graphId: 'nope', newGraphId: 'x' }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(applyBlueprintOps(base(), [{ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'toggle-performer' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['toggle-performer'] } });
 const ops = Array.from({ length: 5 }, (_, i): BlueprintOp => ({ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: `copy-${i}` }));
 expect(ok(applyBlueprintOps(base(), ops))).toHaveLength(8);
 expect(applyBlueprintOps(base(), [...ops, { kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'copy-5' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Blueprint set exceeds its limits' } });
});

it('keeps comments through Blueprint file export and import', () => {
 const scene = makeSmokeScene();
 const graph = find(ok(applyBlueprintOps(base(), [add(note('c1'))])), 'flash-marker');
 const imported = importBlueprint(serializeBlueprintFile(exportBlueprint(graph, scene)), scene, () => 'new');
 if (!imported.ok) throw new Error(imported.error.message);
 expect(imported.data.graph.comments).toEqual([note('c1')]);
 const plain = importBlueprint(serializeBlueprintFile(exportBlueprint(find(base(), 'flash-marker'), scene)), scene, () => 'new');
 expect(plain.ok && plain.data.graph).not.toHaveProperty('comments');
});

it('points a Blueprint control node of the duplicated graph at the copy, and keeps targets in other graphs', () => {
 const control = (id: string, type: string, graphId: string) => ({ id, version: 1 as const, type, settings: { graphId }, position: { x: 0, y: 0 } });
 const source = ok(applyBlueprintOps(base(), [
  { kind: 'addNode', graphId: 'flash-marker', node: control('self', 'blueprint.toggle', 'flash-marker') as BlueprintGraph['nodes'][number] },
  { kind: 'addNode', graphId: 'flash-marker', node: control('peer', 'blueprint.enable', 'toggle-performer') as BlueprintGraph['nodes'][number] },
 ]));
 const copy = find(ok(applyBlueprintOps(source, [{ kind: 'duplicateGraph', graphId: 'flash-marker', newGraphId: 'copy-1' }])), 'copy-1');
 const target = (id: string) => (copy.nodes.find(node => node.id === derivedId('copy-1', id))!.settings as { graphId: string }).graphId;
 expect(target('self')).toBe('copy-1');
 expect(target('peer')).toBe('toggle-performer');
});
