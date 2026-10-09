import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { emptyState, type RunState } from '../src/blueprint-eval';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const toggle = (id: string) => node(id, 'scene.toggleVisibility', { entityId: id });
const compiled = (nodes: object[], connections: object[]) => { const c = compileBlueprint({ schemaVersion: 1, id: 'g', name: 'G', nodes, connections }); if (!c.ok) throw new Error(c.error.message); return c.data; };
const big = () => ({ visits: 4096, effects: 4096 });
// Runs each start node in order, carrying state, and returns the entity IDs each run toggled.
const play = (g: ReturnType<typeof compiled>, starts: string[], times: number[] = []) => {
 let state: RunState = emptyState();
 return starts.map((start, i) => {
  const run = runFlow(g, { nodeId: start, port: 'flow' }, state, big(), times[i] ?? 0);
  if (!run.ok) throw new Error(run.error.message);
  state = run.data.state;
  return run.data.effects.map(effect => 'entityId' in effect ? effect.entityId : '').join(',');
 });
};

it('passes Gate only while open and changes state from its other inputs', () => {
 const g = compiled(
  [node('enter', 'event.manual'), node('open', 'event.manual'), node('close', 'event.manual'), node('flip', 'event.manual'), node('gate', 'flow.gate', { startOpen: false }), toggle('x')],
  [wire('1', 'enter', 'flow', 'gate', 'enter'), wire('2', 'open', 'flow', 'gate', 'open'), wire('3', 'close', 'flow', 'gate', 'close'), wire('4', 'flip', 'flow', 'gate', 'toggle'), wire('5', 'gate', 'exit', 'x', 'flow')]);
 expect(play(g, ['enter', 'open', 'enter', 'close', 'enter', 'flip', 'enter', 'flip', 'enter'])).toEqual(['', '', 'x', '', '', '', 'x', '', '']);
});

it('steps Multi Gate through its outputs, with and without loop, and resets', () => {
 const nodes = (loop: boolean) => [node('in', 'event.manual'), node('reset', 'event.manual'), node('mg', 'flow.multiGate', { outputs: 2, loop }), toggle('a'), toggle('b')];
 const wires = [wire('1', 'in', 'flow', 'mg', 'enter'), wire('2', 'reset', 'flow', 'mg', 'reset'), wire('3', 'mg', 'out0', 'a', 'flow'), wire('4', 'mg', 'out1', 'b', 'flow')];
 expect(play(compiled(nodes(true), wires), ['in', 'in', 'in'])).toEqual(['a', 'b', 'a']);
 expect(play(compiled(nodes(false), wires), ['in', 'in', 'in', 'reset', 'in'])).toEqual(['a', 'b', '', '', 'a']);
});

it('lets Throttle pass once per interval of session time', () => {
 const g = compiled([node('in', 'event.manual'), node('t', 'flow.throttle', { seconds: 1 }), toggle('x')], [wire('1', 'in', 'flow', 't', 'flow'), wire('2', 't', 'exit', 'x', 'flow')]);
 expect(play(g, ['in', 'in', 'in', 'in'], [0, 500, 1000, 1999])).toEqual(['x', '', 'x', '']);
});

it('runs For Loop body for each index depth first, then completed', () => {
 const g = compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: 1 }), node('last', 'value.number', { value: 3 }), node('loop', 'flow.forLoop'),
   node('one', 'value.number', { value: 1 }), node('gt', 'logic.greater'), node('set', 'scene.setVisibility', { entityId: 'v' }), toggle('done')],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'),
   wire('4', 'loop', 'body', 'set', 'flow'), wire('5', 'loop', 'index', 'gt', 'a'), wire('6', 'one', 'value', 'gt', 'b'), wire('7', 'gt', 'result', 'set', 'visible'), wire('8', 'loop', 'completed', 'done', 'flow')]);
 const run = runFlow(g, { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0);
 expect(run.ok && run.data.effects).toEqual([
  { kind: 'setVisibility', entityId: 'v', visible: false }, { kind: 'setVisibility', entityId: 'v', visible: true }, { kind: 'setVisibility', entityId: 'v', visible: true }, { kind: 'toggleVisibility', entityId: 'done' }]);
 expect(run.ok && run.data.state.loops.get('loop')).toBe(3);
});

it('runs only completed when last is less than first, and fails above 64 iterations', () => {
 const loop = (first: number, last: number) => compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: first }), node('last', 'value.number', { value: last }), node('loop', 'flow.forLoop'), toggle('body'), toggle('done')],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'), wire('4', 'loop', 'body', 'body', 'flow'), wire('5', 'loop', 'completed', 'done', 'flow')]);
 expect(play(loop(3, 1), ['in'])).toEqual(['done']);
 expect(play(loop(1, 64), ['in'])[0]!.split(',')).toHaveLength(65);
 expect(runFlow(loop(1, 65), { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0)).toMatchObject({ ok: false, error: { message: 'Blueprint loop exceeded its iteration limit', ids: ['loop'] } });
});

it('stops a run at 512 visits per event', () => {
 const g = compiled(
  [node('in', 'event.manual'), node('first', 'value.number', { value: 1 }), node('last', 'value.number', { value: 64 }), node('loop', 'flow.forLoop'), node('seq', 'flow.sequence', { outputs: 8 }), ...Array.from({ length: 8 }, (_, i) => toggle(`t${i}`))],
  [wire('1', 'in', 'flow', 'loop', 'flow'), wire('2', 'first', 'value', 'loop', 'first'), wire('3', 'last', 'value', 'loop', 'last'), wire('4', 'loop', 'body', 'seq', 'flow'), ...Array.from({ length: 8 }, (_, i) => wire(`s${i}`, 'seq', `then${i}`, `t${i}`, 'flow'))]);
 expect(runFlow(g, { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its flow limit' } });
});

it('routes Switch On Number by the rounded value, else default', () => {
 const g = (value: number) => compiled(
  [node('in', 'event.manual'), node('v', 'value.number', { value }), node('sw', 'flow.switch', { cases: [0, 1] }), toggle('zero'), toggle('one'), toggle('other')],
  [wire('1', 'in', 'flow', 'sw', 'flow'), wire('2', 'v', 'value', 'sw', 'value'), wire('3', 'sw', 'case0', 'zero', 'flow'), wire('4', 'sw', 'case1', 'one', 'flow'), wire('5', 'sw', 'default', 'other', 'flow')]);
 expect([0, 0.6, 1, 7, -0.4].map(v => play(g(v), ['in'])[0])).toEqual(['zero', 'one', 'one', 'other', 'zero']);
});
