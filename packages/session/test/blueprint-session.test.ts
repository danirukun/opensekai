import { expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/protocol/blueprint-set.json';
import { makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';

type S = ReturnType<typeof createSession>;
const visible = (s: S, id: string) => s.inspect().entities.find(e => e.id === id)?.visible;
const press = (accelerator: string) => ({ events: [{ kind: 'keystroke' as const, accelerator }] });
const load = (s: S, graphs: unknown) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs }] });

it('applies a hotkey on the next tick and reports the Blueprint revision on frames', () => {
 const session = createSession(makeSmokeScene(), 's');
 expect(load(session, fixture.blueprints)).toEqual({ ok: true, data: { revision: 1, keystrokes: fixture.expectedAccelerators } });
 session.advance(0);
 const frame = session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(frame.scene.entities.find(e => e.id === 'performer')?.visible).toBe(false);
 expect(frame.blueprintRevision).toBe(1);
 expect(session.inspect().revision).toBe(1);
});

it('reports its accelerator set on inspect, so a host that lost it can learn it again', () => {
 const session = createSession(makeSmokeScene(), 's');
 expect(session.inspectBlueprints().keystrokes).toEqual([]);
 load(session, fixture.blueprints);
 expect(session.inspectBlueprints().keystrokes).toEqual(fixture.expectedAccelerators);
 expect(session.inspectBlueprints(0).keystrokes).toEqual(fixture.expectedAccelerators);
});

it('applies a delayed effect from session time', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 session.advance(100, 100, press('Control+Alt+KeyJ'));
 session.advance(2099);
 expect(visible(session, 'marker')).toBe(true);
 session.advance(2100);
 expect(visible(session, 'marker')).toBe(false);
});

it('keeps the last valid version firing while the document does not compile', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.editBlueprints({ clientId: 't', batchId: 'cut', ops: [{ kind: 'removeNode', graphId: 'toggle-performer', nodeId: 'toggle' }, { kind: 'addNode', graphId: 'toggle-performer', node: { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: { x: 0, y: 0 } } }] });
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([expect.objectContaining({ graphId: 'toggle-performer', kind: 'compile' })]);
});

it('isolates a graph whose target entity was removed and records a runtime error', () => {
 const session = createSession(makeSmokeScene(), 's');
 const graphs = structuredClone(fixture.blueprints);
 graphs[1]!.nodes[0]!.settings = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
 graphs[1]!.nodes[3]!.settings = { entityId: 'gone' };
 load(session, graphs);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([{ graphId: 'flash-marker', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND', ids: ['gone'] }) }]);
});

it('does not advance the scene revision when effects change nothing', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'm', name: 'M', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'on', version: 1, type: 'value.boolean', settings: { value: true }, position: { x: 0, y: 0 } },
  { id: 'set', version: 1, type: 'scene.setVisibility', settings: { entityId: 'marker' }, position: { x: 0, y: 0 } },
 ], connections: [
  { id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'set', targetPort: 'flow' },
  { id: 'b', sourceNodeId: 'on', sourcePort: 'value', targetNodeId: 'set', targetPort: 'visible' },
 ] }]);
 expect(session.runBlueprint('m', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(session.inspect().revision).toBe(0);
});

it('switches an output camera and rejects a run on a missing graph', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'cam', name: 'Cam', nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: { x: 0, y: 0 } },
  { id: 'cut', version: 1, type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_close' }, position: { x: 0, y: 0 } },
 ], connections: [{ id: 'a', sourceNodeId: 'go', sourcePort: 'flow', targetNodeId: 'cut', targetPort: 'flow' }] }]);
 expect(session.runBlueprint('cam', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(session.inspect().outputs.find(o => o.id === 'output_main')?.cameraId).toBe('camera_close');
 expect(session.runBlueprint('nope', 'go')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('adds no whole-scene clone for the Blueprint step on a tick without input or due delays', () => {
 const wholeSceneClones = (blueprints: boolean) => {
  const session = createSession(makeSmokeScene(), 's');
  if (blueprints) load(session, fixture.blueprints);
  session.advance(0);
  const revision = session.inspect().revision;
  const spy = vi.spyOn(globalThis, 'structuredClone');
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
   session.advance(16);
   expect(stringify.mock.calls.filter(([value]) => typeof value === 'object' && value !== null && 'entities' in value && 'outputs' in value)).toHaveLength(0);
   expect(session.inspect().revision).toBe(revision);
   expect(session.inspectBlueprints().errors).toEqual([]);
   return spy.mock.calls.filter(([value]) => typeof value === 'object' && value !== null && 'entities' in value && 'outputs' in value).length;
  } finally { stringify.mockRestore(); spy.mockRestore(); }
 };
 expect(wholeSceneClones(true)).toBe(wholeSceneClones(false));
});

const withRuntimeError = () => {
 const session = createSession(makeSmokeScene(), 's');
 const graphs = structuredClone(fixture.blueprints);
 graphs[1]!.nodes[0]!.settings = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
 graphs[1]!.nodes[3]!.settings = { entityId: 'gone' };
 load(session, graphs);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(session.inspectBlueprints().errors).toHaveLength(1);
 return session;
};
const edit = (s: S, ops: object[]) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops });

it('clears a runtime error when an edit changes the logic of its graph, but not when it moves a node', () => {
 const session = withRuntimeError();
 edit(session, [{ kind: 'moveNode', graphId: 'flash-marker', nodeId: 'show', position: { x: 5, y: 5 } }, { kind: 'updateGraph', graphId: 'flash-marker', name: 'Renamed' }]);
 expect(session.inspectBlueprints().errors).toHaveLength(1);
 edit(session, [{ kind: 'setNodeSettings', graphId: 'flash-marker', nodeId: 'show', settings: { entityId: 'marker' } }]);
 expect(session.inspectBlueprints().errors).toEqual([]);
});

it('does not bring back a runtime error when a removed graph is created again', () => {
 const session = withRuntimeError();
 edit(session, [{ kind: 'removeGraph', graphId: 'flash-marker' }]);
 const original = fixture.blueprints[1]!;
 edit(session, [{ kind: 'createGraph', graph: original }]);
 expect(session.inspectBlueprints().errors).toEqual([]);
});

it('does not abort the frame when the Blueprint step throws', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => { throw new Error('boom'); });
 try {
  const frame = session.advance(16, 16, press('Control+Alt+KeyH'));
  expect(frame.sequence).toBe(2);
 } finally { spy.mockRestore(); }
 expect(session.advance(32).sequence).toBe(3);
});

it('does not run, keep an error for, or carry state into a graph that a new show replaces', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(visible(session, 'performer')).toBe(false);
 session.advance(32, 16, press('Control+Alt+KeyH'));
 const broken = { ...structuredClone(fixture.blueprints[0]!), nodes: [...fixture.blueprints[0]!.nodes, { id: 'dangling', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: { x: 0, y: 0 } }] };
 expect(load(session, [broken])).toEqual({ ok: true, data: { revision: 2, keystrokes: [] } });
 const before = JSON.stringify(session.inspect());
 session.advance(48, 16, press('Control+Alt+KeyH'));
 expect(JSON.stringify(session.inspect())).toBe(before);
 expect(session.inspectBlueprints().errors.map(e => e.kind)).toEqual(['compile']);
});

it('clears a runtime error of a graph that a new show replaces with a document that does not compile', () => {
 const session = createSession(makeSmokeScene(), 's');
 const ghost = { ...structuredClone(fixture.blueprints[0]!), nodes: fixture.blueprints[0]!.nodes.map(n => n.id === 'toggle' ? { ...n, settings: { entityId: 'ghost' } } : n) };
 load(session, [ghost]);
 session.advance(0);
 session.advance(16, 16, press('Control+Alt+KeyH'));
 expect(session.inspectBlueprints().errors.map(e => e.kind)).toEqual(['runtime']);
 load(session, [{ ...ghost, nodes: [...ghost.nodes, { id: 'dangling', version: 1, type: 'scene.setVisibility', settings: { entityId: 'performer' }, position: { x: 0, y: 0 } }] }]);
 expect(session.inspectBlueprints().errors.map(e => e.kind)).toEqual(['compile']);
});

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });

it('reports a manual run as ok when its own change committed, even if another graph has a failing due delay', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [
  { schemaVersion: 1, id: 'A', name: 'A', enabled: true, nodes: [node('go', 'event.manual'), node('toggle', 'scene.toggleVisibility', { entityId: 'performer' })], connections: [wire('a', 'go', 'flow', 'toggle', 'flow')] },
  { schemaVersion: 1, id: 'B', name: 'B', enabled: true, nodes: [node('go', 'event.manual'), node('wait', 'flow.delay', { seconds: 0 }), node('show', 'scene.toggleVisibility', { entityId: 'gone' })], connections: [wire('a', 'go', 'flow', 'wait', 'flow'), wire('b', 'wait', 'exit', 'show', 'flow')] },
 ]);
 expect(session.runBlueprint('B', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 const before = session.inspect().revision;
 expect(session.runBlueprint('A', 'go')).toEqual({ ok: true, data: { revision: before + 1 } });
 expect(visible(session, 'performer')).toBe(false);
 expect(session.inspectBlueprints().errors).toEqual([{ graphId: 'B', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND', ids: ['gone'] }) }]);
});

it('does not move a Flip Flop when the action behind it fails', () => {
 const scene = makeSmokeScene();
 const session = createSession(scene, 's');
 load(session, [{ schemaVersion: 1, id: 'F', name: 'F', enabled: true,
  nodes: [node('go', 'event.manual'), node('flip', 'flow.flipFlop'), node('cut', 'camera.switch', { outputId: 'output_main', cameraId: 'camera_close' }), node('toggle', 'scene.toggleVisibility', { entityId: 'marker' })],
  connections: [wire('a', 'go', 'flow', 'flip', 'flow'), wire('b', 'flip', 'a', 'cut', 'flow'), wire('c', 'flip', 'b', 'toggle', 'flow')] }]);
 const without = { ...structuredClone(scene), entities: scene.entities.filter(entity => entity.id !== 'camera_close'), revision: session.inspect().revision };
 expect(session.replaceScene(without, session.inspect().revision).ok).toBe(true);
 expect(session.runBlueprint('F', 'go')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(session.replaceScene(structuredClone(scene), session.inspect().revision).ok).toBe(true);
 expect(session.runBlueprint('F', 'go').ok).toBe(true);
 expect(session.inspect().outputs.find(o => o.id === 'output_main')?.cameraId).toBe('camera_close');
 expect(visible(session, 'marker')).toBe(true);
});

it('logs a failed Blueprint tick once per distinct message and returns an error reply for a failed manual run', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, fixture.blueprints);
 session.advance(0);
 const log = vi.spyOn(console, 'error').mockImplementation(() => {});
 const real = structuredClone;
 const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(((value: unknown) => { if (new Error().stack?.includes('applyEffects')) throw new Error('boom'); return real(value); }) as typeof structuredClone);
 try {
  session.advance(16, 16, press('Control+Alt+KeyH'));
  session.advance(32, 32, press('Control+Alt+KeyH'));
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith('Blueprint step failed', expect.any(Error));
 } finally { spy.mockRestore(); log.mockRestore(); }
});

it('returns an error reply when a manual run throws', () => {
 const session = createSession(makeSmokeScene(), 's');
 load(session, [{ schemaVersion: 1, id: 'A', name: 'A', enabled: true, nodes: [node('go', 'event.manual'), node('toggle', 'scene.toggleVisibility', { entityId: 'performer' })], connections: [wire('a', 'go', 'flow', 'toggle', 'flow')] }]);
 const log = vi.spyOn(console, 'error').mockImplementation(() => {});
 const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => { throw new Error('boom'); });
 try {
  expect(session.runBlueprint('A', 'go')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Blueprint step failed' } });
 } finally { spy.mockRestore(); log.mockRestore(); }
 expect(session.runBlueprint('A', 'go').ok).toBe(true);
});
