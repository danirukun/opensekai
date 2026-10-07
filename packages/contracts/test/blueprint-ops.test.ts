import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintGraph } from '../src';

const base = () => BlueprintSetSchema.parse(structuredClone(fixture.blueprints));
const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } }) as BlueprintGraph['nodes'][number];
const ok = (r: ReturnType<typeof applyBlueprintOps>) => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const graph = (gs: BlueprintGraph[], id: string) => gs.find(g => g.id === id)!;

it('is pure and atomic: a failing op rejects the whole batch and leaves the input untouched', () => {
 const input = base(); const before = structuredClone(input);
 const r = applyBlueprintOps(input, [{ kind: 'updateGraph', graphId: 'flash-marker', name: 'Renamed' }, { kind: 'removeNode', graphId: 'flash-marker', nodeId: 'missing' }]);
 expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['missing'] } });
 expect(input).toEqual(before);
});

it('cascades a node removal to its wires', () => {
 const g = graph(ok(applyBlueprintOps(base(), [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }])), 'flash-marker');
 expect(g.connections.map(c => c.id)).toEqual(['w4', 'w5']);
});

it('replaces the existing wire on a data input and on a flow output', () => {
 let gs = ok(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'w6', sourceNodeId: 'off', sourcePort: 'value', targetNodeId: 'show', targetPort: 'visible' } }]));
 expect(graph(gs, 'flash-marker').connections.filter(c => c.targetNodeId === 'show' && c.targetPort === 'visible').map(c => c.id)).toEqual(['w6']);
 gs = ok(applyBlueprintOps(gs, [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'w7', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'hide', targetPort: 'flow' } }]));
 expect(graph(gs, 'flash-marker').connections.filter(c => c.sourceNodeId === 'key').map(c => c.id)).toEqual(['w7']);
});

it('rejects a wire between ports of different types or to a missing port', () => {
 expect(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'on', sourcePort: 'value', targetNodeId: 'wait', targetPort: 'flow' } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(applyBlueprintOps(base(), [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'key', sourcePort: 'nope', targetNodeId: 'wait', targetPort: 'flow' } }])).toMatchObject({ ok: false });
});

it('prunes wires on Sequence outputs that a settings change removes, and validates settings', () => {
 const gs = ok(applyBlueprintOps(base(), [
  { kind: 'addNode', graphId: 'toggle-performer', node: node('seq', 'flow.sequence', { outputs: 3 }) },
  { kind: 'connect', graphId: 'toggle-performer', connection: { id: 's2', sourceNodeId: 'seq', sourcePort: 'then2', targetNodeId: 'toggle', targetPort: 'flow' } },
  { kind: 'setNodeSettings', graphId: 'toggle-performer', nodeId: 'seq', settings: { outputs: 2 } },
 ]));
 expect(graph(gs, 'toggle-performer').connections.map(c => c.id)).toEqual(['w1']);
 expect(applyBlueprintOps(base(), [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: -1 } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['wait'] } });
});

it('moves, renames, enables, creates, removes, and replaces graphs', () => {
 let gs = ok(applyBlueprintOps(base(), [
  { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 10, y: 20 } },
  { kind: 'updateGraph', graphId: 'disabled', enabled: true, name: 'On' },
  { kind: 'createGraph', graph: { schemaVersion: 1, id: 'new', name: 'New', enabled: true, nodes: [], connections: [] } },
  { kind: 'removeGraph', graphId: 'toggle-performer' },
 ]));
 expect(graph(gs, 'flash-marker').nodes.find(n => n.id === 'wait')!.position).toEqual({ x: 10, y: 20 });
 expect(graph(gs, 'disabled')).toMatchObject({ enabled: true, name: 'On' });
 expect(gs.map(g => g.id)).toEqual(['flash-marker', 'disabled', 'new']);
 gs = ok(applyBlueprintOps(gs, [{ kind: 'replaceAll', graphs: [] }]));
 expect(gs).toEqual([]);
});

it('enforces graph and set limits after the batch', () => {
 const create = (i: number) => ({ kind: 'createGraph' as const, graph: { schemaVersion: 1 as const, id: `g${i}`, name: 'G', enabled: true, nodes: [], connections: [] } });
 expect(applyBlueprintOps([], Array.from({ length: 8 }, (_, i) => create(i))).ok).toBe(true);
 expect(applyBlueprintOps([], Array.from({ length: 9 }, (_, i) => create(i)))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(applyBlueprintOps(base(), [{ kind: 'createGraph', graph: { schemaVersion: 1, id: 'flash-marker', name: 'Dup', enabled: true, nodes: [], connections: [] } }])).toMatchObject({ ok: false });
});

it('rejects prototype-named ports', () => {
 const input = base(); const before = structuredClone(input);
 expect(applyBlueprintOps(input, [{ kind: 'connect', graphId: 'flash-marker', connection: { id: 'p', sourceNodeId: 'key', sourcePort: 'toString', targetNodeId: 'wait', targetPort: 'toString' } }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(input).toEqual(before);
});
