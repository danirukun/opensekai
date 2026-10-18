import { expect, it } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { applyBlueprintOps, BlueprintSetSchema, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { createUndoHistory, diffOps } from '../src/blueprints/undo';

const graphs = () => BlueprintSetSchema.parse(fixture.blueprints);
const flash = () => graphs()[1]!;
const apply = (graph: BlueprintGraph, ops: BlueprintOp[]) => { const r = applyBlueprintOps([graph], ops); if (!r.ok) throw new Error(r.error.message); return r.data[0]!; };
// Undo restores content; array order may differ, so compare sorted by ID.
const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const norm = (g: BlueprintGraph) => ({ ...g, nodes: byId(g.nodes), connections: byId(g.connections), variables: byId(g.variables) });

it('restores a deleted node with its wires, settings, and variables', () => {
 const before = { ...flash(), variables: [{ id: 'n', name: 'N', type: 'number' as const, default: 1 }] };
 const after = apply(before, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'show' }, { kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: 9 } }, { kind: 'removeVariable', graphId: 'flash-marker', variableId: 'n' }, { kind: 'moveNode', graphId: 'flash-marker', nodeId: 'hide', position: { x: 1, y: 2 } }]);
 expect(norm(apply(after, diffOps(after, before)))).toEqual(norm(before));
 expect(norm(apply(before, diffOps(before, after)))).toEqual(norm(after));
});

it('restores a wire that a connect replaced and wires a settings change dropped', () => {
 const g: BlueprintGraph = { ...flash(), nodes: [...flash().nodes, { id: 'seq', version: 1, type: 'flow.sequence', settings: { outputs: 3 }, position: { x: 0, y: 0 } }], connections: [...flash().connections, { id: 's2', sourceNodeId: 'seq', sourcePort: 'then2', targetNodeId: 'hide', targetPort: 'flow' }] };
 const after = apply(g, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'seq', settings: { outputs: 2 } }, { kind: 'connect', graphId: 'flash-marker', connection: { id: 'x', sourceNodeId: 'key', sourcePort: 'flow', targetNodeId: 'hide', targetPort: 'flow' } }]);
 expect(norm(apply(after, diffOps(after, g)))).toEqual(norm(g));
});

it('merges quick moves into one step and keeps a delete as its own step', () => {
 let time = 0;
 const history = createUndoHistory(() => time);
 let current = flash();
 const act = (ops: BlueprintOp[]) => { const next = apply(current, ops); history.record('flash-marker', current, next, ops); current = next; };
 for (let x = 0; x < 5; x++) { act([{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x, y: 0 } }]); time += 100; }
 time += 1000;
 act([{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'hide' }]);
 const undone: BlueprintOp[][] = [];
 const take = (ops: BlueprintOp[]) => { undone.push(ops); current = apply(current, ops); return true; };
 expect(history.undo('flash-marker', take)).toBe(true);
 expect(current.nodes.some(node => node.id === 'hide')).toBe(true);
 expect(history.undo('flash-marker', take)).toBe(true);
 expect(norm(current)).toEqual(norm(flash()));
 expect(history.undo('flash-marker', take)).toBe(false);
 expect(history.redo('flash-marker', take)).toBe(true);
 expect(current.nodes.find(node => node.id === 'wait')!.position).toEqual({ x: 4, y: 0 });
});

it('drops a step that no longer applies and clears redo after a new action', () => {
 const history = createUndoHistory(() => 0);
 const before = flash(), after = apply(before, [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x: 5, y: 5 } }]);
 history.record('flash-marker', before, after, []);
 expect(history.undo('flash-marker', () => false)).toBe(false);
 expect(history.redo('flash-marker', () => true)).toBe(false);
 expect(history.undo('flash-marker', () => true)).toBe(false);
 history.record('flash-marker', before, after, []);
 history.undo('flash-marker', () => true);
 history.record('flash-marker', before, after, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'hide' }]);
 expect(history.redo('flash-marker', () => true)).toBe(false);
});

it('keeps at most 64 steps per graph and ignores no-op actions', () => {
 const history = createUndoHistory(() => 0);
 let current = flash();
 history.record('flash-marker', current, current, []);
 for (let i = 0; i < 70; i++) { const next = apply(current, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'wait', settings: { seconds: i } }]); history.record('flash-marker', current, next, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: `distinct${i}` }]); current = next; }
 let count = 0;
 while (history.undo('flash-marker', () => true)) count++;
 expect(count).toBe(64);
});

const settingsOp = (nodeId: string, seconds: number): BlueprintOp => ({ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId, settings: { seconds } });
const run = (history: ReturnType<typeof createUndoHistory>, start: BlueprintGraph, actions: BlueprintOp[][]) => {
 let current = start;
 for (const ops of actions) { const next = apply(current, ops); history.record('flash-marker', current, next, ops); current = next; }
 let steps = 0;
 while (history.undo('flash-marker', () => true)) steps++;
 return steps;
};

it('keeps quick discrete actions as separate steps', () => {
 const add = (id: string): BlueprintOp[] => [{ kind: 'addNode', graphId: 'flash-marker', node: { id, version: 1, type: 'flow.delay', settings: { seconds: 1 }, position: { x: 0, y: 0 } } }];
 expect(run(createUndoHistory(() => 0), flash(), [add('d1'), add('d2')])).toBe(2);
});

it('merges quick settings changes of the same node and not of another node', () => {
 expect(run(createUndoHistory(() => 0), flash(), [[settingsOp('wait', 7)], [settingsOp('wait', 8)]])).toBe(1);
 expect(run(createUndoHistory(() => 0), flash(), [[settingsOp('wait', 7)], [settingsOp('wait', 8)], [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'on', settings: { value: false } }]])).toBe(2);
});

it('reports whether a step is available', () => {
 const history = createUndoHistory(() => 0);
 expect(history.canUndo('flash-marker')).toBe(false);
 run(history, flash(), [[settingsOp('wait', 7)]]);
 expect(history.canUndo('flash-marker')).toBe(false);
 expect(history.canRedo('flash-marker')).toBe(true);
});

it('does not merge a quick move into a step when another change landed between them', () => {
 const move = (x: number): BlueprintOp[] => [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'wait', position: { x, y: 0 } }];
 const quick = (remote: boolean) => {
  const history = createUndoHistory(() => 0);
  const first = apply(flash(), move(1));
  history.record('flash-marker', flash(), first, move(1));
  const landed = remote ? apply(first, [{ kind: 'removeNode', graphId: 'flash-marker', nodeId: 'hide' }]) : first;
  history.record('flash-marker', landed, apply(landed, move(2)), move(2));
  let steps = 0;
  while (history.undo('flash-marker', () => true)) steps++;
  return steps;
 };
 expect(quick(false)).toBe(1);
 expect(quick(true)).toBe(2);
});

it('undoes and redoes an inline value, and merges quick edits of one value into one step', () => {
 let time = 0;
 const history = createUndoHistory(() => time);
 const start = apply(flash(), [{ kind: 'disconnect', graphId: 'flash-marker', connectionId: 'w2' }]);
 let current = start;
 const act = (ops: BlueprintOp[]) => { const next = apply(current, ops); history.record('flash-marker', current, next, ops); current = next; };
 const take = (ops: BlueprintOp[]) => { current = apply(current, ops); return true; };
 act([{ kind: 'setNodeInput', graphId: 'flash-marker', nodeId: 'show', port: 'visible', value: true }]); time += 100;
 act([{ kind: 'setNodeInput', graphId: 'flash-marker', nodeId: 'show', port: 'visible', value: false }]);
 expect(history.undo('flash-marker', take)).toBe(true);
 expect(norm(current)).toEqual(norm(start));
 expect(history.redo('flash-marker', take)).toBe(true);
 expect(current.nodes.find(node => node.id === 'show')!.inputs).toEqual({ visible: false });
});

it('restores an inline value that a settings change dropped', () => {
 const set = { id: 'set', version: 1 as const, type: 'property.set' as const, settings: { entityId: 'marker', property: 'position' as const }, position: { x: 0, y: 0 }, inputs: { value: [1, 2, 3] as [number, number, number] } };
 const before: BlueprintGraph = { ...flash(), nodes: [...flash().nodes, set] };
 const after = apply(before, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'set', settings: { entityId: 'marker', property: 'visible' } }]);
 expect(after.nodes.find(node => node.id === 'set')).not.toHaveProperty('inputs');
 expect(norm(apply(after, diffOps(after, before)))).toEqual(norm(before));
 expect(norm(apply(before, diffOps(before, after)))).toEqual(norm(after));
});
