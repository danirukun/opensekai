import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph } from '@opensekai/contracts';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { createBlueprintRuntime, activeHeldKeys } from '../src/blueprint-runtime';
import { emptyState } from '../src/blueprint-eval';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[], id = 'g'): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled: true, variables: [{ id: 'v', name: 'V', type: 'number', default: 0 }], nodes, connections } as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const num = (id: string, value: number) => ({ id, version: 1, type: 'value.number', settings: { value }, position: at });

it('makes, adds, scales, and breaks Vector3 values', () => {
 const g = graph([
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  num('one', 1), num('two', 2), num('three', 3),
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at },
  { id: 'add', version: 1, type: 'vector3.add', settings: {}, position: at },
  { id: 'scale', version: 1, type: 'vector3.scale', settings: {}, position: at },
  { id: 'break', version: 1, type: 'vector3.break', settings: {}, position: at },
  { id: 'set', version: 1, type: 'variable.setNumber', settings: { variableId: 'v' }, position: at },
 ], [
  wire('a', 'one', 'value', 'make', 'x'), wire('b', 'two', 'value', 'make', 'y'), wire('c', 'three', 'value', 'make', 'z'),
  wire('d', 'make', 'value', 'add', 'a'), wire('e', 'make', 'value', 'add', 'b'),
  wire('f', 'add', 'result', 'scale', 'value'), wire('g', 'two', 'value', 'scale', 'factor'),
  wire('h', 'scale', 'result', 'break', 'value'), wire('i', 'break', 'z', 'set', 'value'),
  wire('j', 'go', 'flow', 'set', 'flow'),
 ]);
 const compiled = compileBlueprint(g);
 if (!compiled.ok) throw new Error(compiled.error.message);
 const result = runFlow(compiled.data, { nodeId: 'go', port: 'flow' }, { ...emptyState(), variables: new Map([['v', 0]]) }, { visits: 64, effects: 8 }, 0);
 expect(result.ok && result.data.state.variables.get('v')).toBe(12);
});

it('reads an unconnected vector3 input as its inline value, else zero', () => {
 const g = (inputs?: object) => graph([
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'break', version: 1, type: 'vector3.break', settings: {}, position: at, ...(inputs ? { inputs } : {}) },
  { id: 'set', version: 1, type: 'variable.setNumber', settings: { variableId: 'v' }, position: at },
 ], [wire('a', 'break', 'y', 'set', 'value'), wire('b', 'go', 'flow', 'set', 'flow')]);
 const run = (doc: BlueprintGraph) => { const c = compileBlueprint(doc); if (!c.ok) throw new Error(c.error.message); return runFlow(c.data, { nodeId: 'go', port: 'flow' }, { ...emptyState(), variables: new Map([['v', 7]]) }, { visits: 64, effects: 8 }, 0); };
 const read = (doc: BlueprintGraph) => { const r = run(doc); return r.ok ? r.data.state.variables.get('v') : r.error.message; };
 expect(read(g())).toBe(0);
 expect(read(g({ value: [1, 2.5, 3] }))).toBe(2.5);
});

// On Update → Set Visibility(reference, visible ← Is Key Held(KeyW)).
const held = graph([
 { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at },
 { id: 'key', version: 1, type: 'input.keyHeld', settings: { code: 'KeyW' }, position: at },
 { id: 'show', version: 1, type: 'scene.setVisibility', settings: { entityId: 'reference' }, position: at },
], [wire('a', 'tick', 'flow', 'show', 'flow'), wire('b', 'key', 'held', 'show', 'visible')]);

it('runs On Update on every advance and reads held keys from the clock', () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [held] }] });
 const visible = () => session.inspect().entities.find(e => e.id === 'reference')?.visible;
 session.advance(0);
 expect(visible()).toBe(false);
 session.advance(16, 16, { held: ['KeyW'] });
 expect(visible()).toBe(true);
 session.advance(32);
 expect(visible()).toBe(false);
});

it('reports the watched keys of enabled graphs', () => {
 const axis = graph([{ id: 'axis', version: 1, type: 'input.keyAxis', settings: { negative: 'KeyS', positive: 'KeyW' }, position: at }], [], 'axis');
 expect(activeHeldKeys([held, axis])).toEqual(['KeyS', 'KeyW']);
 expect(activeHeldKeys([{ ...held, enabled: false }])).toEqual([]);
 const session = createSession(makeSmokeScene(), 's');
 expect(session.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [held, axis] }] })).toEqual({ ok: true, data: { revision: 1, keystrokes: [], heldKeys: ['KeyS', 'KeyW'] } });
 expect(session.inspectBlueprints().heldKeys).toEqual(['KeyS', 'KeyW']);
});

it('clamps deltaSeconds to 0.1 and gives 0 on the first update', () => {
 // On Update → Set Visibility(entity, visible ← deltaSeconds > threshold).
 const over = (threshold: number, id: string) => graph([
  { id: 'tick', version: 1, type: 'event.update', settings: {}, position: at }, num('limit', threshold),
  { id: 'gt', version: 1, type: 'logic.greater', settings: {}, position: at },
  { id: 'show', version: 1, type: 'scene.setVisibility', settings: { entityId: id }, position: at },
 ], [wire('a', 'tick', 'flow', 'show', 'flow'), wire('b', 'tick', 'deltaSeconds', 'gt', 'a'), wire('c', 'limit', 'value', 'gt', 'b'), wire('d', 'gt', 'result', 'show', 'visible')], id);
 const runtime = createBlueprintRuntime();
 runtime.install([over(0, 'marker'), over(0.0999, 'reference'), over(0.1, 'performer')]);
 const visible = (runs: ReturnType<typeof runtime.step>) => Object.fromEntries(runs.flatMap(run => run.effects).map(e => [(e as { entityId: string }).entityId, (e as { visible: boolean }).visible]));
 expect(visible(runtime.step([{ kind: 'update' }], 1000))).toEqual({ marker: false, reference: false, performer: false });
 expect(visible(runtime.step([{ kind: 'update' }], 1050))).toEqual({ marker: true, reference: false, performer: false });
 expect(visible(runtime.step([{ kind: 'update' }], 60_000))).toEqual({ marker: true, reference: true, performer: false });
});
