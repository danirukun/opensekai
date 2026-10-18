import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { emptyState } from '../src/blueprint-eval';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const graph = (nodes: object[], connections: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', nodes, connections });
const budget = () => ({ visits: 256, effects: 64 });
const compiled = (g: unknown) => { const c = compileBlueprint(g); if (!c.ok) throw new Error(c.error.message); return c.data; };

it('routes If Branch by a lazily read condition', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('cond', 'value.boolean', { value: false }), node('if', 'flow.branch'),
   node('yes', 'scene.toggleVisibility', { entityId: 'marker' }), node('no', 'camera.switch', { outputId: 'output_main', cameraId: 'camera_close' })],
  [wire('1', 'start', 'flow', 'if', 'flow'), wire('2', 'cond', 'value', 'if', 'condition'), wire('3', 'if', 'true', 'yes', 'flow'), wire('4', 'if', 'false', 'no', 'flow')]));
 expect(runFlow(g, { nodeId: 'start', port: 'flow' }, emptyState(), budget(), 0)).toMatchObject({ ok: true, data: { effects: [{ kind: 'selectCamera', outputId: 'output_main', cameraId: 'camera_close' }] } });
});

it('runs Sequence outputs depth-first in order', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('seq', 'flow.sequence', { outputs: 2 }), node('a', 'scene.toggleVisibility', { entityId: 'a' }), node('a2', 'scene.toggleVisibility', { entityId: 'a2' }), node('b', 'scene.toggleVisibility', { entityId: 'b' })],
  [wire('1', 'start', 'flow', 'seq', 'flow'), wire('2', 'seq', 'then0', 'a', 'flow'), wire('3', 'a', 'exit', 'a2', 'flow'), wire('4', 'seq', 'then1', 'b', 'flow')]));
 const run = runFlow(g, { nodeId: 'start', port: 'flow' }, emptyState(), budget(), 0);
 expect(run.ok && run.data.effects.map(e => 'entityId' in e && e.entityId)).toEqual(['a', 'a2', 'b']);
});

it('alternates Flip Flop and exposes Is A, without mutating the input state', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('ff', 'flow.flipFlop'), node('set', 'scene.setVisibility', { entityId: 'marker' }), node('set2', 'scene.setVisibility', { entityId: 'marker' })],
  [wire('1', 'start', 'flow', 'ff', 'flow'), wire('2', 'ff', 'a', 'set', 'flow'), wire('3', 'ff', 'b', 'set2', 'flow'), wire('4', 'ff', 'isA', 'set', 'visible'), wire('5', 'ff', 'isA', 'set2', 'visible')]));
 const state = emptyState();
 const first = runFlow(g, { nodeId: 'start', port: 'flow' }, state, budget(), 0);
 expect(first).toMatchObject({ ok: true, data: { effects: [{ kind: 'setVisibility', visible: true }] } });
 expect(state.flip.size).toBe(0);
 const second = runFlow(g, { nodeId: 'start', port: 'flow' }, first.ok ? first.data.state : state, budget(), 0);
 expect(second).toMatchObject({ ok: true, data: { effects: [{ kind: 'setVisibility', visible: false }] } });
});

it('schedules Delay and stops the current flow there', () => {
 const g = compiled(graph(
  [node('start', 'event.manual'), node('wait', 'flow.delay', { seconds: 2 }), node('t', 'scene.toggleVisibility', { entityId: 'marker' })],
  [wire('1', 'start', 'flow', 'wait', 'flow'), wire('2', 'wait', 'exit', 't', 'flow')]));
 expect(runFlow(g, { nodeId: 'start', port: 'flow' }, emptyState(), budget(), 500)).toMatchObject({ ok: true, data: { effects: [], delays: [{ nodeId: 'wait', dueMs: 2500 }] } });
 expect(runFlow(g, { nodeId: 'wait', port: 'exit' }, emptyState(), budget(), 2500)).toMatchObject({ ok: true, data: { effects: [{ kind: 'toggleVisibility' }] } });
});

it('allows a flow cycle only through Delay and rejects data cycles', () => {
 const loop = [node('start', 'event.manual'), node('t', 'scene.toggleVisibility', { entityId: 'm' }), node('wait', 'flow.delay', { seconds: 1 })];
 expect(compileBlueprint(graph(loop, [wire('1', 'start', 'flow', 't', 'flow'), wire('2', 't', 'exit', 'wait', 'flow'), wire('3', 'wait', 'exit', 't', 'flow')])).ok).toBe(true);
 const immediate = [node('a', 'scene.toggleVisibility', { entityId: 'm' }), node('b', 'scene.toggleVisibility', { entityId: 'm' })];
 expect(compileBlueprint(graph(immediate, [wire('1', 'a', 'exit', 'b', 'flow'), wire('2', 'b', 'exit', 'a', 'flow')]))).toMatchObject({ ok: false, error: { message: 'Blueprint has an immediate cycle' } });
 const data = [node('n1', 'logic.not'), node('n2', 'logic.not')];
 expect(compileBlueprint(graph(data, [wire('1', 'n1', 'result', 'n2', 'value'), wire('2', 'n2', 'result', 'n1', 'value')])).ok).toBe(false);
});

it('accepts a Flip Flop Is A read inside its own flow chain', () => {
 const g = graph(
  [node('start', 'event.manual'), node('ff', 'flow.flipFlop'), node('if', 'flow.branch'), node('t', 'scene.toggleVisibility', { entityId: 'm' })],
  [wire('1', 'start', 'flow', 'ff', 'flow'), wire('2', 'ff', 'a', 'if', 'flow'), wire('3', 'ff', 'isA', 'if', 'condition'), wire('4', 'if', 'true', 't', 'flow')]);
 expect(compileBlueprint(g).ok).toBe(true);
});

it('enforces Warudo port multiplicity', () => {
 const nodes = [node('start', 'event.manual'), node('x', 'scene.toggleVisibility', { entityId: 'm' }), node('y', 'scene.toggleVisibility', { entityId: 'm' }), node('k', 'event.manual')];
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'flow', 'x', 'flow'), wire('2', 'start', 'flow', 'y', 'flow')]))).toMatchObject({ ok: false, error: { ids: ['start'] } });
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'flow', 'x', 'flow'), wire('2', 'k', 'flow', 'x', 'flow')])).ok).toBe(true);
});

it('compiles unwired data and flow inputs', () => {
 expect(compileBlueprint(graph([node('set', 'scene.setVisibility', { entityId: 'm' })], [])).ok).toBe(true);
 expect(compileBlueprint(graph([node('t', 'scene.toggleVisibility', { entityId: 'm' })], [])).ok).toBe(true);
});

it('stops at the shared tick budget', () => {
 const nodes = [node('start', 'event.manual'), ...Array.from({ length: 70 }, (_, i) => node(`t${i}`, 'scene.toggleVisibility', { entityId: 'm' }))];
 const wires = [wire('w', 'start', 'flow', 't0', 'flow'), ...Array.from({ length: 69 }, (_, i) => wire(`w${i}`, `t${i}`, 'exit', `t${i + 1}`, 'flow'))];
 expect(runFlow(compiled(graph(nodes, wires)), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 50, effects: 256 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its flow limit' } });
 expect(runFlow(compiled(graph(nodes.slice(0, 4), wires.slice(0, 3))), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 256, effects: 2 }, 0)).toMatchObject({ ok: false, error: { message: 'Blueprint run exceeded its operation limit' } });
 expect(runFlow(compiled(graph(nodes, wires)), { nodeId: 'start', port: 'flow' }, emptyState(), { visits: 1024, effects: 256 }, 0).ok).toBe(true);
});

it('rejects a connection to a prototype-named port', () => {
 const nodes = [node('start', 'event.manual'), node('t', 'scene.toggleVisibility', { entityId: 'm' })];
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'toString', 't', 'flow')]))).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match' } });
 expect(compileBlueprint(graph(nodes, [wire('1', 'start', 'flow', 't', 'toString')]))).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match' } });
});
