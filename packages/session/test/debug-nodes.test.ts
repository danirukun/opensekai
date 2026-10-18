import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { emptyState } from '../src/blueprint-eval';
import { createBlueprintRuntime } from '../src/blueprint-runtime';
import { createSession } from '../src/session';

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[], id = 'g'): BlueprintGraph =>
 ({ schemaVersion: 1, id, name: id, enabled: true, variables: [], nodes, connections } as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const manual = node('go', 'event.manual');

it('emits log, toast, and event effects with inline strings and typed payloads', () => {
 const runtime = createBlueprintRuntime();
 expect(runtime.install([graph([
  manual,
  node('log', 'debug.log', { level: 'warning' }, { message: 'hello' }),
  node('toast', 'debug.toast', { variant: 'success', durationSeconds: 2 }, { header: 'Chat', caption: '<b>hi</b>' }),
  node('event', 'debug.event', { payloadType: 'vector3' }, { name: 'aim', payload: [1, 2, 3] }),
 ], [wire('a', 'go', 'flow', 'log', 'flow'), wire('b', 'log', 'exit', 'toast', 'flow'), wire('c', 'toast', 'exit', 'event', 'flow')])]).ok).toBe(true);
 expect(runtime.step([{ kind: 'manual', graphId: 'g', nodeId: 'go' }], 0)[0]!.effects).toEqual([
  { kind: 'debugLog', nodeId: 'log', level: 'warning', message: 'hello' },
  { kind: 'debugToast', nodeId: 'toast', variant: 'success', header: 'Chat', caption: '<b>hi</b>', durationSeconds: 2 },
  { kind: 'debugEvent', nodeId: 'event', name: 'aim', payloadType: 'vector3', payload: [1, 2, 3] },
 ]);
});

it('keeps debug effects outside the effect budget', () => {
 const runtime = createBlueprintRuntime();
 runtime.install([graph([
  manual, node('loop', 'flow.forLoop', {}, { first: 0, last: 63 }),
  node('one', 'debug.log', { level: 'info' }), node('two', 'debug.log', { level: 'debug' }),
 ], [wire('a', 'go', 'flow', 'loop', 'flow'), wire('b', 'loop', 'body', 'one', 'flow'), wire('c', 'one', 'exit', 'two', 'flow')])]);
 const [run] = runtime.step([{ kind: 'manual', graphId: 'g', nodeId: 'go' }], 0);
 expect(run!.error).toBeNull();
 expect(run!.effects).toHaveLength(128);
});

it('records the value that a Debug Value node passes on, and watches an unread node without changing the state', () => {
 const compiled = compileBlueprint(graph([
  manual,
  node('t', 'value.boolean', { value: false }),
  node('probe', 'debug.value', { valueType: 'boolean' }),
  node('show', 'scene.setVisibility', { entityId: 'marker' }),
  node('rnd', 'math.random', {}, { min: 0, max: 1 }),
  node('watch', 'debug.value', { valueType: 'number' }),
  node('bad', 'math.clamp', {}, { value: 1, min: 2, max: 1 }),
  node('broken', 'debug.value', { valueType: 'number' }),
 ], [
  wire('a', 'go', 'flow', 'show', 'flow'), wire('b', 't', 'value', 'probe', 'value'), wire('c', 'probe', 'value', 'show', 'visible'),
  wire('d', 'rnd', 'result', 'watch', 'value'), wire('e', 'bad', 'result', 'broken', 'value'),
 ]));
 if (!compiled.ok) throw new Error(compiled.error.message);
 const state = emptyState(7);
 const result = runFlow(compiled.data, { nodeId: 'go', port: 'flow' }, state, { visits: 100, effects: 1 }, 0);
 if (!result.ok) throw new Error(result.error.message);
 expect(result.data.effects).toEqual([{ kind: 'setVisibility', entityId: 'marker', visible: false }]);
 expect(result.data.debug.map(sample => [sample.nodeId, sample.valueType])).toEqual([['probe', 'boolean'], ['watch', 'number']]);
 expect(result.data.debug[0]).toMatchObject({ value: false });
 // The watch read Random on a copy, so the run state keeps its seed.
 expect(result.data.state.random).toBe(7);
});

it('logs from an On Update graph at most 10 times a second and reports the drops', () => {
 const session = createSession(makeSmokeScene(), 's');
 const edit = (ops: BlueprintOp[], batchId: string) => session.editBlueprints({ clientId: 't', batchId, ops });
 expect(edit([{ kind: 'createGraph', graph: graph([node('tick', 'event.update'), node('log', 'debug.log', { level: 'info' }, { message: 'tick' })], [wire('a', 'tick', 'flow', 'log', 'flow')], 'loop') }], 'b1').ok).toBe(true);
 for (let t = 0; t < 60; t++) session.advance(t * 16);
 const first = session.debugBlueprints();
 expect(first.entries).toHaveLength(10);
 expect(first.entries.every(entry => entry.graphId === 'loop' && entry.nodeId === 'log' && entry.kind === 'log')).toBe(true);
 expect(first.dropped).toBe(50);
 session.advance(1000);
 expect(session.debugBlueprints(first.latest).entries).toMatchObject([{ atMs: 1000, dropped: 50, message: 'tick' }]);
});

it('adds no entry for a failed run and keeps Debug Value values of existing nodes only', () => {
 const session = createSession(makeSmokeScene(), 's');
 const edit = (ops: BlueprintOp[], batchId: string) => session.editBlueprints({ clientId: 't', batchId, ops });
 edit([{ kind: 'createGraph', graph: graph([
  manual, node('log', 'debug.log', { level: 'error' }, { message: 'before' }), node('show', 'scene.setVisibility', { entityId: 'missing' }),
  node('n', 'value.number', { value: 3 }), node('probe', 'debug.value', { valueType: 'number' }),
 ], [wire('a', 'go', 'flow', 'log', 'flow'), wire('b', 'log', 'exit', 'show', 'flow'), wire('c', 'n', 'value', 'probe', 'value')]) }], 'b1');
 expect(session.runBlueprint('g', 'go').ok).toBe(false);
 expect(session.debugBlueprints()).toMatchObject({ entries: [], values: [], latest: 0 });
 edit([{ kind: 'removeNode', graphId: 'g', nodeId: 'show' }], 'b2');
 expect(session.runBlueprint('g', 'go').ok).toBe(true);
 session.advance(16);
 expect(session.runBlueprint('g', 'go').ok).toBe(true);
 const read = session.debugBlueprints();
 expect(read.entries.map(entry => entry.kind === 'log' && entry.message)).toEqual(['before', 'before']);
 expect(read.values).toEqual([{ graphId: 'g', nodeId: 'probe', valueType: 'number', text: '3', changedMs: 0, seq: 2 }]);
 edit([{ kind: 'removeNode', graphId: 'g', nodeId: 'probe' }], 'b3');
 expect(session.debugBlueprints().values).toEqual([]);
});

it('adds no debug output when the scene commit of the step fails', () => {
 const session = createSession({ ...makeSmokeScene(), revision: Number.MAX_SAFE_INTEGER }, 's');
 session.editBlueprints({ clientId: 't', batchId: 'b1', ops: [{ kind: 'createGraph', graph: graph([
  manual, node('log', 'debug.log', { level: 'info' }, { message: 'hidden' }), node('show', 'scene.setVisibility', { entityId: 'marker' }),
  node('n', 'value.number', { value: 1 }), node('probe', 'debug.value', { valueType: 'number' }),
 ], [wire('a', 'go', 'flow', 'log', 'flow'), wire('b', 'log', 'exit', 'show', 'flow'), wire('c', 'n', 'value', 'probe', 'value')]) }] });
 expect(session.runBlueprint('g', 'go')).toMatchObject({ ok: false, error: { message: 'Revision limit reached' } });
 expect(session.debugBlueprints()).toMatchObject({ latest: 0, entries: [], values: [] });
});

// macOS QA of PR #211: Random Integer → Modulo Integer → Switch On Number, with a Debug Value on the chain.
// The shown value must be the value that the branch used, also when the Debug Value only watches the chain.
const randomChain = (watch: boolean) => graph([
 manual,
 node('rnd', 'integer.random', {}, { min: 0, max: 9 }),
 node('mod', 'integer.modulo', {}, { b: 2 }),
 node('probe', 'debug.value', { valueType: 'integer' }),
 node('switch', 'flow.switch', { cases: [0, 1] }),
 node('log0', 'debug.log', { level: 'info' }, { message: 'case0' }),
 node('log1', 'debug.log', { level: 'info' }, { message: 'case1' }),
], [
 wire('a', 'go', 'flow', 'switch', 'flow'), wire('b', 'rnd', 'result', 'mod', 'a'), wire('c', 'mod', 'result', 'probe', 'value'),
 watch ? wire('d', 'mod', 'result', 'switch', 'value') : wire('d', 'probe', 'value', 'switch', 'value'),
 wire('e', 'switch', 'case0', 'log0', 'flow'), wire('f', 'switch', 'case1', 'log1', 'flow'),
]);
for (const watch of [false, true]) it(`shows the value that a random chain gave the branch on each run (${watch ? 'watch' : 'pass-through'})`, () => {
 const session = createSession(makeSmokeScene(), 's');
 session.editBlueprints({ clientId: 't', batchId: 'b1', ops: [{ kind: 'createGraph', graph: randomChain(watch) }] });
 const seen: [string, string][] = [];
 for (let run = 0; run < 12; run++) {
  session.advance(run * 100);
  const before = session.debugBlueprints().latest;
  expect(session.runBlueprint('g', 'go').ok).toBe(true);
  const read = session.debugBlueprints(before);
  const entry = read.entries.at(-1)!;
  seen.push([entry.kind === 'log' ? entry.message : '', `case${read.values.find(value => value.nodeId === 'probe')!.text}`]);
 }
 expect(seen.map(([, shown]) => shown)).toEqual(seen.map(([branch]) => branch));
 // The chain gives both branches, so the check is not trivial.
 expect(new Set(seen.map(([branch]) => branch)).size).toBe(2);
});
