import { expect, it } from 'vitest';
import type { BlueprintGraph } from '@opensekai/contracts';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { emptyState, type NodeRequest, type RunState } from '../src/blueprint-eval';
import { createBlueprintRuntime, listenedGraphs, MAX_TIMERS, nextDelays, nextTimers, rescheduleTimer, type Timer } from '../src/blueprint-runtime';

const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const toggle = (id: string) => node(id, 'scene.toggleVisibility', { entityId: id });
const graph = (id: string, nodes: object[], connections: object[], enabled = true) => ({ schemaVersion: 1, id, name: id, enabled, nodes, connections, variables: [] });
const compiled = (nodes: object[], connections: object[]) => { const c = compileBlueprint(graph('g', nodes, connections)); if (!c.ok) throw new Error(c.error.message); return c.data; };
const big = () => ({ visits: 4096, effects: 4096 });
const toggled = (runs: { effects: { kind: string }[] }[]) => runs.flatMap(run => run.effects.map(effect => 'entityId' in effect ? effect.entityId : ''));
const runtimeWith = (...graphs: object[]) => { const runtime = createBlueprintRuntime(); const installed = runtime.install(graphs); if (!installed.ok) throw new Error(installed.error.message); return runtime; };
const manual = (graphId: string, nodeId: string) => ({ kind: 'manual' as const, graphId, nodeId });

it('passes Do Once one time until its reset input opens it', () => {
 const g = compiled([node('in', 'event.manual'), node('reset', 'event.manual'), node('once', 'flow.doOnce'), toggle('x')],
  [wire('1', 'in', 'flow', 'once', 'flow'), wire('2', 'reset', 'flow', 'once', 'reset'), wire('3', 'once', 'exit', 'x', 'flow')]);
 let state: RunState = emptyState();
 const out = ['in', 'in', 'reset', 'in', 'in'].map(start => {
  const run = runFlow(g, { nodeId: start, port: 'flow' }, state, big(), 0);
  if (!run.ok) throw new Error(run.error.message);
  state = run.data.state;
  return run.data.effects.length;
 });
 expect(out).toEqual([1, 0, 0, 1, 0]);
});

it('reads only the input that Select chooses, for the selected type', () => {
 // `bad` would fail the run: Get Asset Property of an entity that is not in the scene.
 const g = (condition: boolean) => compiled(
  [node('in', 'event.manual'), node('sel', 'flow.select', { type: 'vector3' }, { condition, ifTrue: [1, 2, 3] }), node('bad', 'property.get', { entityId: 'missing', property: 'position' }), node('set', 'property.set', { entityId: 'e', property: 'position' })],
  [wire('1', 'in', 'flow', 'set', 'flow'), wire('2', 'bad', 'value', 'sel', 'ifFalse'), wire('3', 'sel', 'value', 'set', 'value')]);
 const run = runFlow(g(true), { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0);
 expect(run.ok && run.data.effects).toEqual([{ kind: 'setProperty', entityId: 'e', property: 'position', value: [1, 2, 3], nodeId: 'set' }]);
 expect(runFlow(g(false), { nodeId: 'in', port: 'flow' }, emptyState(), big(), 0).ok).toBe(false);
});

it('replaces the pending delay of a Debounce node and keeps other delays', () => {
 let order = 0;
 const next = () => order++;
 const kept = [{ nodeId: 'delay', dueMs: 900, order: next() }, { nodeId: 'deb', dueMs: 700, order: next() }];
 const request: NodeRequest = { kind: 'debounce', seconds: 0.5, nodeId: 'deb' };
 expect(nextDelays(kept, [], [request], 400, next)).toEqual([{ nodeId: 'delay', dueMs: 900, order: 0 }, { nodeId: 'deb', dueMs: 900, order: 2 }]);
});

it('continues Debounce once, its seconds after the last entry of a burst', () => {
 const runtime = runtimeWith(graph('g', [node('in', 'event.manual'), node('deb', 'flow.debounce', { seconds: 0.5 }), toggle('x')],
  [wire('1', 'in', 'flow', 'deb', 'flow'), wire('2', 'deb', 'exit', 'x', 'flow')]));
 runtime.step([], 0);
 expect(toggled([...runtime.step([manual('g', 'in')], 0), ...runtime.step([manual('g', 'in')], 300), ...runtime.step([manual('g', 'in')], 600)])).toEqual([]);
 expect(toggled(runtime.step([], 1099))).toEqual([]);
 expect(toggled(runtime.step([], 1100))).toEqual(['x']);
 expect(toggled(runtime.step([], 5000))).toEqual([]);
});

it('starts, restarts, and stops timers by name', () => {
 let order = 0;
 const next = () => order++;
 const start = (name: string, seconds: number, repeat = true): NodeRequest => ({ kind: 'startTimer', name, seconds, repeat, nodeId: 'n' });
 const one = nextTimers([], [start('a', 1), start('b', 2, false)], 100, next);
 expect(one).toEqual([{ name: 'a', dueMs: 1100, intervalMs: 1000, repeat: true, order: 0 }, { name: 'b', dueMs: 2100, intervalMs: 2000, repeat: false, order: 1 }]);
 expect(nextTimers(one, [start('a', 0.5)], 400, next).map(timer => [timer.name, timer.dueMs])).toEqual([['b', 2100], ['a', 900]]);
 expect(nextTimers(one, [{ kind: 'stopTimer', name: 'a', nodeId: 'n' }, { kind: 'stopTimer', name: 'missing', nodeId: 'n' }], 400, next).map(timer => timer.name)).toEqual(['b']);
});

it('repeats a due timer one interval later, at most once per step, and ends a one-shot timer', () => {
 const timer: Timer = { name: 't', dueMs: 1000, intervalMs: 1000, repeat: true, order: 0 };
 expect(rescheduleTimer(timer, 1016, 5)).toEqual({ ...timer, dueMs: 2000, order: 5 });
 // A late step (for example after a stall) does not fire the missed intervals.
 expect(rescheduleTimer(timer, 4500, 6)).toEqual({ ...timer, dueMs: 5500, order: 6 });
 expect(rescheduleTimer({ ...timer, repeat: false }, 1016, 7)).toBeNull();
});

it('fires On Timer nodes of the timer name on the session clock until Stop Timer', () => {
 const runtime = runtimeWith(graph('g', [node('go', 'event.manual'), node('stop', 'event.manual'), node('start', 'timer.start', { name: 'beat', repeat: true }, { seconds: 0.25 }),
  node('halt', 'timer.stop', { name: 'beat' }), node('on', 'timer.on', { name: 'beat' }), node('other', 'timer.on', { name: 'other' }), toggle('x'), toggle('y')],
 [wire('1', 'go', 'flow', 'start', 'flow'), wire('2', 'stop', 'flow', 'halt', 'flow'), wire('3', 'on', 'flow', 'x', 'flow'), wire('4', 'other', 'flow', 'y', 'flow')]));
 runtime.step([manual('g', 'go')], 0);
 const fired = [100, 250, 400, 500, 1000].map(time => toggled(runtime.step([], time)).length);
 expect(fired).toEqual([0, 1, 0, 1, 1]);
 runtime.step([manual('g', 'stop')], 1010);
 expect(toggled(runtime.step([], 2000))).toEqual([]);
});

it('fails a run that starts more timers than the limit and keeps the earlier timers', () => {
 const count = MAX_TIMERS + 1;
 const starts = Array.from({ length: count }, (_, i) => node(`s${i}`, 'timer.start', { name: `t${i}`, repeat: false }));
 const chain = starts.slice(1).map((item, i) => wire(`w${i}`, `s${i}`, 'exit', item.id, 'flow'));
 const runtime = runtimeWith(graph('g', [node('go', 'event.manual'), ...starts], [wire('in', 'go', 'flow', 's0', 'flow'), ...chain]));
 expect(runtime.step([manual('g', 'go')], 0)).toEqual([expect.objectContaining({ error: expect.objectContaining({ message: 'Blueprint timer limit reached' }) })]);
});

it('reads the session time and the enabled flag of a graph', () => {
 const g = compiled([node('in', 'event.manual'), node('time', 'timer.sessionTime'), node('on', 'blueprint.isEnabled', { graphId: 'other' }),
  node('sel', 'flow.select', { type: 'number' }), node('set', 'property.set', { entityId: 'e', property: 'fovDegrees' })],
 [wire('1', 'in', 'flow', 'set', 'flow'), wire('2', 'on', 'enabled', 'sel', 'condition'), wire('3', 'time', 'seconds', 'sel', 'ifTrue'), wire('4', 'sel', 'value', 'set', 'value')]);
 const value = (enabled: boolean) => {
  const run = runFlow(g, { nodeId: 'in', port: 'flow' }, emptyState(), big(), 2500, { deltaSeconds: 0, held: new Set(), scene: () => null, nowMs: 2500, graphEnabled: id => id === 'other' && enabled });
  return run.ok ? (run.data.effects[0] as { value: number }).value : null;
 };
 expect(value(true)).toBe(2.5);
 expect(value(false)).toBe(0);
});

it('stops an event loop at the hop limit with a runtime error and no hang', () => {
 const loop = graph('loop', [node('go', 'event.manual'), node('emit', 'event.emit', { name: 'x', payload: 'none' }), node('on', 'event.custom', { name: 'x', payload: 'none' }), node('again', 'event.emit', { name: 'x', payload: 'none' }), toggle('x')],
  [wire('1', 'go', 'flow', 'emit', 'flow'), wire('2', 'on', 'flow', 'again', 'flow'), wire('3', 'again', 'exit', 'x', 'flow')]);
 const runtime = runtimeWith(loop);
 runtime.step([], 0);
 const runs = runtime.step([manual('loop', 'go')], 16);
 // The manual run, then hops 1 to 8; the hop 8 run would emit hop 9 and fails with no effect.
 expect(runs).toHaveLength(9);
 expect(toggled(runs)).toHaveLength(7);
 expect(runs.at(-1)).toMatchObject({ graphId: 'loop', effects: [], error: { message: 'Blueprint event hop limit reached', ids: ['again'] } });
});

it('stops an event fan-out at the event budget of the step', () => {
 const fan = graph('fan', [node('go', 'event.manual'), node('emit', 'event.emit', { name: 'x', payload: 'none' }), node('on', 'event.custom', { name: 'x', payload: 'none' }),
  node('seq', 'flow.sequence', { outputs: 2 }), node('a', 'event.emit', { name: 'x', payload: 'none' }), node('b', 'event.emit', { name: 'x', payload: 'none' })],
 [wire('1', 'go', 'flow', 'emit', 'flow'), wire('2', 'on', 'flow', 'seq', 'flow'), wire('3', 'seq', 'then0', 'a', 'flow'), wire('4', 'seq', 'then1', 'b', 'flow')]);
 const runtime = runtimeWith(fan);
 runtime.step([], 0);
 const runs = runtime.step([manual('fan', 'go')], 16);
 expect(runs.length).toBeLessThanOrEqual(65);
 expect(runs.some(run => run.error?.message === 'Blueprint event limit reached')).toBe(true);
 // The budget is per step: the next step delivers again.
 expect(runtime.step([manual('fan', 'go')], 32).filter(run => run.error === null).length).toBeGreaterThan(1);
});

it('listens to enabled graphs and to the graphs that their Enable or Toggle nodes name, transitively', () => {
 const control = (id: string, type: string, target: string) => node(id, type, { graphId: target });
 const graphs = [
  graph('a', [control('n', 'blueprint.enable', 'b')], []),
  graph('b', [control('n', 'blueprint.toggle', 'c')], [], false),
  graph('c', [], [], false),
  graph('d', [], [], false),
  graph('e', [control('n', 'blueprint.enable', 'd')], [], false),
  graph('f', [control('n', 'blueprint.disable', 'd'), control('m', 'blueprint.enable', 'missing')], []),
 ] as unknown as BlueprintGraph[];
 expect(listenedGraphs(graphs).map(item => [item.id, item.enabled])).toEqual([['a', true], ['b', true], ['c', true], ['f', true]]);
});

it('drops the control requests of a step that threw, so a later step does not apply them', () => {
 const runtime = runtimeWith(graph('g', [node('a', 'event.manual'), node('b', 'event.manual'), node('off', 'blueprint.disable', { graphId: 'g' }), toggle('x')],
  [wire('1', 'a', 'flow', 'off', 'flow'), wire('2', 'b', 'flow', 'x', 'flow')]));
 runtime.step([], 0);
 expect(() => runtime.step([manual('g', 'a'), manual('g', 'b')], 16, run => { if (run.effects.length > 0) throw new Error('gate failed'); return null; })).toThrow('gate failed');
 runtime.step([], 32);
 expect(runtime.takeControlRequests()).toEqual([]);
 runtime.step([manual('g', 'a')], 48);
 expect(runtime.takeControlRequests()).toEqual([{ sourceGraphId: 'g', graphId: 'g', action: 'disable' }]);
});
