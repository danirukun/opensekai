import { expect, it } from 'vitest';
import type { BlueprintGraph } from '@opensekai/contracts';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { makeSmokeScene, type RuntimeFrame } from '@opensekai/contracts';
import { createBlueprintRuntime, initialState, type GraphRun } from '../src/blueprint-runtime';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const graph = (nodes: object[], connections: object[], id = 'g', enabled = true): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled, variables: [{ id: 'v', name: 'V', type: 'number', default: 0 }, { id: 'b', name: 'B', type: 'boolean', default: false }], nodes, connections } as BlueprintGraph);
const budget = () => ({ visits: 1024, effects: 64 });
const runOnce = (doc: BlueprintGraph) => {
 const compiled = compileBlueprint(doc);
 if (!compiled.ok) throw new Error(compiled.error.message);
 const state = initialState(doc);
 return runFlow(compiled.data, { nodeId: 'go', port: 'flow' }, state, budget(), 0);
};
const variables = (doc: BlueprintGraph) => { const run = runOnce(doc); return run.ok ? Object.fromEntries(run.data.state.variables) : run.error.message; };

// Manual → Switch On Number(cases 0, 1) ← Modulo Integer(b 2) ← Random Integer(0 to 9); each case stores a marker, and a second branch stores the drawn integer.
const parity = (id: string) => graph([
 node('go', 'event.manual'), node('rand', 'integer.random', {}, { min: 0, max: 9 }), node('mod', 'integer.modulo'),
 node('switch', 'flow.switch', { cases: [0, 1] }), node('even', 'variable.setNumber', { variableId: 'v' }, { value: 100 }), node('odd', 'variable.setNumber', { variableId: 'v' }, { value: 101 }),
 node('other', 'variable.setNumber', { variableId: 'v' }, { value: -1 }),
 node('isEven', 'integer.isEven'), node('store', 'variable.setBoolean', { variableId: 'b' }),
], [
 wire('1', 'go', 'flow', 'switch', 'flow'), wire('2', 'rand', 'result', 'mod', 'a'), wire('3', 'mod', 'result', 'switch', 'value'),
 wire('4', 'switch', 'case0', 'even', 'flow'), wire('5', 'switch', 'case1', 'odd', 'flow'), wire('6', 'switch', 'default', 'other', 'flow'),
 wire('7', 'even', 'exit', 'store', 'flow'), wire('8', 'odd', 'exit', 'store', 'flow'), wire('9', 'rand', 'result', 'isEven', 'value'), wire('10', 'isEven', 'result', 'store', 'value'),
], id);

it('runs Random Integer → Modulo Integer → Switch On Number through the integer to number widening', () => {
 const outcomes = new Set<number>();
 for (let i = 0; i < 24; i++) {
  const result = variables(parity(`graph-${i}`)) as { v: number; b: boolean };
  expect([100, 101]).toContain(result.v);
  // Store reads Random Integer again (the data cache lives for one input read), so only the type of the Is Even result is checked.
  expect(typeof result.b).toBe('boolean');
  outcomes.add(result.v);
 }
 expect([...outcomes].sort()).toEqual([100, 101]);
});

it('compares integers through the float compare nodes', () => {
 const compare = (type: string, a: number, b: number) => variables(graph([
  node('go', 'event.manual'), node('a', 'integer.add', {}, { a, b: 0 }), node('b', 'integer.add', {}, { a: b, b: 0 }), node('cmp', type), node('store', 'variable.setBoolean', { variableId: 'b' }),
 ], [wire('1', 'go', 'flow', 'store', 'flow'), wire('2', 'a', 'result', 'cmp', 'a'), wire('3', 'b', 'result', 'cmp', 'b'), wire('4', 'cmp', 'result', 'store', 'value')])) as { b: boolean };
 const big = Number.MAX_SAFE_INTEGER;
 expect(compare('logic.equal', big, big).b).toBe(true);
 expect(compare('logic.equal', big, big - 1).b).toBe(false);
 expect(compare('logic.greater', big, big - 1).b).toBe(true);
 expect(compare('logic.less', -big, -big + 1).b).toBe(true);
 expect(compare('logic.greaterOrEqual', 3, 3).b).toBe(true);
 expect(compare('logic.lessOrEqual', 4, 3).b).toBe(false);
});

it('rejects a number output on an integer input and accepts an integer output on a number input', () => {
 const doc = (source: string, target: string, port: string) => graph([node('src', source), node('dst', target)], [wire('1', 'src', 'result', 'dst', port)]);
 expect(compileBlueprint(doc('math.add', 'integer.add', 'a'))).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match', ids: ['src', 'dst'] } });
 expect(compileBlueprint(doc('integer.add', 'math.add', 'a')).ok).toBe(true);
 expect(compileBlueprint(doc('math.add', 'integer.round', 'value')).ok).toBe(true);
});

it('reads the input defaults of unconnected math inputs, and an inline value wins', () => {
 const lerp = (inputs?: object) => variables(graph([node('go', 'event.manual'), node('lerp', 'math.lerp', {}, inputs), node('store', 'variable.setNumber', { variableId: 'v' })],
  [wire('1', 'go', 'flow', 'store', 'flow'), wire('2', 'lerp', 'result', 'store', 'value')])) as { v: number };
 expect(lerp().v).toBe(0.5);
 expect(lerp({ a: 2, b: 4, t: 1 }).v).toBe(4);
 const scale = variables(graph([node('go', 'event.manual'), node('scale', 'vector3.scale', {}, { value: [1, 2, 3] }), node('brk', 'vector3.break'), node('store', 'variable.setNumber', { variableId: 'v' })],
  [wire('1', 'go', 'flow', 'store', 'flow'), wire('2', 'scale', 'result', 'brk', 'value'), wire('3', 'brk', 'z', 'store', 'value')])) as { v: number };
 expect(scale.v).toBe(3);
});

it('fails an integer overflow and a division by zero, and the failed run changes no state', () => {
 // Manual → Sequence: then0 stores a random integer as the camera Field of View, then1 stores a / b, where b is the truncated Key Axis (0 unless W is held).
 const doc = graph([
  node('go', 'event.manual'), node('seq', 'flow.sequence', { outputs: 2 }),
  node('rand', 'integer.random', {}, { min: 1, max: 1000 }), node('first', 'property.set', { entityId: 'cam', property: 'fovDegrees' }),
  node('axis', 'input.keyAxis', { negative: 'KeyS', positive: 'KeyW' }), node('trunc', 'integer.truncate'), node('div', 'integer.divide', {}, { a: 60 }),
  node('second', 'property.set', { entityId: 'cam', property: 'fovDegrees' }),
 ], [
  wire('1', 'go', 'flow', 'seq', 'flow'), wire('2', 'seq', 'then0', 'first', 'flow'), wire('3', 'rand', 'result', 'first', 'value'),
  wire('4', 'seq', 'then1', 'second', 'flow'), wire('5', 'axis', 'value', 'trunc', 'value'), wire('6', 'trunc', 'result', 'div', 'b'), wire('7', 'div', 'result', 'second', 'value'),
 ]);
 const values = (runs: GraphRun[]) => runs.flatMap(run => run.effects.map(effect => (effect as { value: number }).value));
 const runtime = createBlueprintRuntime(), fresh = createBlueprintRuntime();
 runtime.install([doc]); fresh.install([doc]);
 const failed = runtime.step([{ kind: 'manual', graphId: 'g', nodeId: 'go' }], 0);
 expect(failed).toEqual([{ graphId: 'g', effects: [], error: { code: 'INVALID_INPUT', message: 'Blueprint data could not be evaluated', ids: ['second'] }, nodeId: 'go' }]);
 const held = { held: new Set(['KeyW']), scene: () => null };
 const after = values(runtime.step([{ kind: 'manual', graphId: 'g', nodeId: 'go' }], 10, undefined, held));
 // The failed run drew a random integer, but the draw was not kept: the next run draws the first value of a fresh state.
 expect(after).toEqual(values(fresh.step([{ kind: 'manual', graphId: 'g', nodeId: 'go' }], 10, undefined, held)));
 expect(after[1]).toBe(60);

 const overflow = runOnce(graph([node('go', 'event.manual'), node('mul', 'integer.multiply', {}, { a: 2 ** 30, b: 2 ** 30 }), node('store', 'variable.setNumber', { variableId: 'v' })],
  [wire('1', 'go', 'flow', 'store', 'flow'), wire('2', 'mul', 'result', 'store', 'value')]));
 expect(overflow).toMatchObject({ ok: false, error: { message: 'Blueprint data could not be evaluated', ids: ['store'] } });
});

// On Update → Sequence: then0 sets the Field of View of camera c0, then1 of camera c1 (double only), both from one Smooth Damp whose target is 10 × Key Axis.
const damping = (id: string, double: boolean, negative = 'KeyS', enabled = true) => graph([
 node('tick', 'event.update'), node('seq', 'flow.sequence', { outputs: 2 }),
 node('axis', 'input.keyAxis', { negative, positive: 'KeyW' }), node('ten', 'math.multiply', {}, { b: 10 }), node('damp', 'math.smoothDamp', {}, { smoothTime: 0.2 }),
 node('s0', 'property.set', { entityId: 'c0', property: 'fovDegrees' }), ...(double ? [node('s1', 'property.set', { entityId: 'c1', property: 'fovDegrees' })] : []),
], [
 wire('1', 'tick', 'flow', 'seq', 'flow'), wire('2', 'axis', 'value', 'ten', 'a'), wire('3', 'ten', 'result', 'damp', 'target'),
 wire('4', 'seq', 'then0', 's0', 'flow'), wire('5', 'damp', 'result', 's0', 'value'),
 ...(double ? [wire('6', 'seq', 'then1', 's1', 'flow'), wire('7', 'damp', 'result', 's1', 'value')] : []),
], id, enabled);
// The session passes the tick time; these runtime tests pass it the same way.
const W = (tickMs: number) => ({ held: new Set(['KeyW']), scene: () => null, tickMs });
const fov = (runs: GraphRun[], graphId: string) => runs.filter(run => run.graphId === graphId).flatMap(run => run.effects.map(effect => (effect as { value: number }).value));

it('moves Smooth Damp toward its target over On Update ticks, once per tick even with two reads in one run', () => {
 const runtime = createBlueprintRuntime();
 runtime.install([damping('single', false), damping('double', true)]);
 expect(fov(runtime.step([{ kind: 'update' }], 0), 'single')).toEqual([0]);
 let previous = 0;
 for (let tick = 1; tick <= 120; tick++) {
  const runs = runtime.step([{ kind: 'update' }], tick * 16, undefined, W(tick * 16));
  const [value] = fov(runs, 'single'), double = fov(runs, 'double');
  expect(double).toEqual([value, value]);
  expect(value!).toBeGreaterThan(previous); expect(value!).toBeLessThanOrEqual(10);
  if (tick === 10) expect(value!).toBeLessThan(9);
  previous = value!;
 }
 expect(previous).toBeCloseTo(10, 2);
});

it('resets Smooth Damp on a logic change and on enable, and keeps it on a reinstall with the same logic', () => {
 const runtime = createBlueprintRuntime();
 const tick = (ms: number) => fov(runtime.step([{ kind: 'update' }], ms, undefined, W(ms)), 'g')[0];
 runtime.install([damping('g', false)]);
 runtime.step([{ kind: 'update' }], 0);
 const moving = [tick(16), tick(32)];
 expect(moving[1]).toBeLessThan(10);
 // Same logic: the state stays and the value keeps moving from where it was.
 runtime.install([damping('g', false)]);
 const kept = tick(48)!;
 expect(kept).toBeGreaterThan(moving[1]!); expect(kept).toBeLessThan(10);
 // A settings change resets the state: the first read starts at the target.
 runtime.install([damping('g', false, 'KeyA')]);
 expect(tick(64)).toBe(10);
 // Disable, then enable: a new state again.
 runtime.install([damping('g', false, 'KeyS')]);
 runtime.step([{ kind: 'update' }], 80);
 runtime.install([damping('g', false, 'KeyS', false)]);
 runtime.install([damping('g', false, 'KeyS')]);
 expect(tick(96)).toBe(10);
});

// Session: On Update → Set Asset Property(camera_wide, Field of View) ← Smooth Damp ← 40 + 30 × Key Axis(S, W), with one or two On Update nodes.
const zoom = (updates: number) => graph([
 ...Array.from({ length: updates }, (_, i) => node(`tick${i}`, 'event.update')),
 node('axis', 'input.keyAxis', { negative: 'KeyS', positive: 'KeyW' }), node('mul', 'math.multiply', {}, { b: 30 }), node('add', 'math.add', {}, { b: 40 }),
 node('damp', 'math.smoothDamp', {}, { smoothTime: 0.2 }), node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees' }),
], [
 ...Array.from({ length: updates }, (_, i) => wire(`f${i}`, `tick${i}`, 'flow', 'lens', 'flow')),
 wire('1', 'axis', 'value', 'mul', 'a'), wire('2', 'mul', 'result', 'add', 'a'), wire('3', 'add', 'result', 'damp', 'target'), wire('4', 'damp', 'result', 'lens', 'value'),
]);
const lensOf = (frame: RuntimeFrame) => { const camera = frame.scene.entities.find(item => item.id === 'camera_wide')!; return camera.kind === 'camera' ? camera.lens.fovDegrees : NaN; };
const zoomFrames = (updates: number) => {
 const s = createSession(makeSmokeScene(), 's');
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [zoom(updates)] }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 const values = [lensOf(s.advance(0, 0))];
 for (let ms = 20; ms <= 2000; ms += 20) values.push(lensOf(s.advance(ms, ms, { held: ['KeyW'] })));
 return values;
};

it('steps Smooth Damp once per session tick when two On Update nodes read it', () => {
 const one = zoomFrames(1), two = zoomFrames(2);
 expect(one[0]).toBe(40);
 expect(one[5]).toBeGreaterThan(40); expect(one[5]).toBeLessThan(65);
 expect(one.at(-1)).toBeCloseTo(70, 2);
 two.forEach((value, i) => expect(value, `tick ${i}`).toBeCloseTo(one[i]!, 9));
});
