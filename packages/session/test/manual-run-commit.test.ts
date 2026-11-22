import { expect, it } from 'vitest';
import { keystrokeAccelerator, makeSmokeScene, orbitFromUser, transformFromOrbit, type BlueprintGraph, type SceneView, type Vec3 } from '@opensekai/contracts';
import { createSession } from '../src/session';

// Editor and MCP fixes R4 to R7: a manual run and a custom event commit the override writes of their step before the reply.
// Each test uses a real session and a controlled clock (`advance`).
type S = ReturnType<typeof createSession>;
const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const graphOf = (id: string, trigger: unknown, nodes: unknown[], connections = [wire('flow', trigger === null ? 'go' : (trigger as { id: string }).id, 'flow', 'set', 'flow')]) =>
 ({ schemaVersion: 1, id, name: id, enabled: true, variables: [], nodes: [trigger ?? node('go', 'event.manual'), ...nodes], connections }) as BlueprintGraph;
const setPosition = (value: Vec3, entityId = 'reference') => node('set', 'property.set', { entityId, property: 'position' }, { value });
const setFov = (value: number, seconds?: number) => node('set', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', ...(seconds === undefined ? {} : { transitionSeconds: seconds, easing: 'Linear' }) }, { value });
// Manual → Set Asset Property(reference position) with an inline value.
const graph = graphOf('g', null, [setPosition([1, 2, 3])]);
const entityOf = (scene: SceneView, id: string) => scene.entities.find(item => item.id === id)!;
const positionOf = (scene: SceneView, id: string) => entityOf(scene, id).transform.position;
const fovOf = (scene: SceneView) => (entityOf(scene, 'camera_wide') as { lens: { fovDegrees: number } }).lens.fovDegrees;
// fovDegrees round-trips through the physical lens (D12), so a written value lands within float precision, not exactly.
const closeTo = (value: number, target: number) => Math.abs(value - target) < 1e-6;
function start(graphs: unknown[], scene: SceneView = makeSmokeScene()): S {
 const s = createSession(scene, 's');
 s.advance(16);
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 return s;
}

it('commits the write of a manual run before the reply, with no clock step after the run', () => {
 const session = createSession(makeSmokeScene(), 's');
 session.advance(16);
 expect(session.editBlueprints({ clientId: 't', batchId: 'b0', ops: [{ kind: 'createGraph', graph }] }).ok).toBe(true);
 expect(session.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 const scene = session.inspect();
 expect(scene.revision).toBe(1);
 expect(positionOf(scene, 'reference')).toEqual([1, 2, 3]);
});

it('commits the write of a custom event before the reply (R4)', () => {
 const s = start([graphOf('g', node('on', 'event.custom', { name: 'Go', payload: 'none' }), [setPosition([1, 2, 3])])]);
 expect(s.emitBlueprintEvent('Go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(positionOf(s.inspect(), 'reference')).toEqual([1, 2, 3]);
});

it('commits Move Entity from a manual run before the reply (R4)', () => {
 const [x, y, z] = positionOf(makeSmokeScene(), 'reference');
 const s = start([graphOf('g', null, [node('set', 'entity.move', { entityId: 'reference', space: 'world' }, { delta: [0, 0, 1] })])]);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(positionOf(s.inspect(), 'reference')).toEqual([x, y, z! + 1]);
});

it('commits Camera Orbit Character without a transition from a manual run before the reply (R4)', () => {
 const pivotOffset: Vec3 = [0, 1.3, 0];
 const s = createSession(makeSmokeScene(), 's');
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset } }] }).ok).toBe(true);
 const target = { yawDegrees: 90, pitchDegrees: 20, distance: 2 };
 const orbit = node('set', 'camera.orbitCharacter', { cameraId: 'camera_wide' }, { yaw: target.yawDegrees, pitch: target.pitchDegrees, distance: target.distance });
 expect(s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [graphOf('g', null, [orbit])] }] }).ok).toBe(true);
 s.advance(0);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 2 } });
 const pivot = positionOf(s.inspect(), 'performer').map((value, i) => value + pivotOffset[i]!) as Vec3;
 const expected = transformFromOrbit(orbitFromUser(target, pivot), [1, 1, 1]).position;
 positionOf(s.inspect(), 'camera_wide').forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
});

it('keeps a write with a transition out of the reply, and commits it after the end as before (R6)', () => {
 const before = fovOf(makeSmokeScene());
 const s = start([graphOf('g', null, [setFov(60, 1)])]);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(fovOf(s.inspect())).toBe(before);
 for (let ms = 32; ms <= 1260; ms += 16) s.advance(ms);
 expect(s.inspect().revision).toBe(0);
 for (let ms = 1276; ms <= 1300; ms += 16) s.advance(ms);
 expect(s.inspect()).toMatchObject({ revision: 1 });
 expect(fovOf(s.inspect())).toBeCloseTo(60, 9);
});

it('commits a keystroke write of a clock step only 250 ms after the write (R5)', () => {
 const key = { code: 'KeyK', control: true, alt: true, shift: false, meta: false };
 const s = start([graphOf('g', node('key', 'event.keystroke', key), [setPosition([1, 2, 3])])]);
 s.advance(32, 32, { events: [{ kind: 'keystroke', accelerator: keystrokeAccelerator(key) }] });
 expect(positionOf(s.advance(48).scene, 'reference')).toEqual([1, 2, 3]);
 s.advance(281);
 expect(s.inspect().revision).toBe(0);
 s.advance(282);
 expect(s.inspect().revision).toBe(1);
 expect(positionOf(s.inspect(), 'reference')).toEqual([1, 2, 3]);
});

it('commits only the writes of the manual step, not the writes of an On Update graph (R5)', () => {
 // A: On Update → Move Entity(reference, world, (0, 0, Key Axis(S, W))). B: Manual → Set Asset Property(marker position).
 const a = { schemaVersion: 1, id: 'a', name: 'A', enabled: true, variables: [], nodes: [
  node('tick', 'event.update'), node('axis', 'input.keyAxis', { negative: 'KeyS', positive: 'KeyW' }), node('make', 'vector3.make', {}, { x: 0, y: 0 }),
  node('move', 'entity.move', { entityId: 'reference', space: 'world' }),
 ], connections: [wire('a', 'tick', 'flow', 'move', 'flow'), wire('b', 'axis', 'value', 'make', 'z'), wire('c', 'make', 'value', 'move', 'delta')] };
 const s = start([a, graphOf('b', null, [setPosition([1, 2, 3], 'marker')])]);
 const W = { held: ['KeyW'] };
 const z = positionOf(makeSmokeScene(), 'reference')[2]!;
 s.advance(32, 32, W);
 s.advance(48, 48, W);
 expect(s.runBlueprint('b', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(positionOf(s.inspect(), 'marker')).toEqual([1, 2, 3]);
 expect(positionOf(s.inspect(), 'reference')[2]).toBe(z);
 // The On Update override stays and still shows.
 expect(positionOf(s.advance(64, 64, W).scene, 'reference')[2]).toBeGreaterThan(z);
});

it('makes no commit for a write of the current value (R7)', () => {
 const s = start([graphOf('g', null, [setPosition(positionOf(makeSmokeScene(), 'reference') as Vec3)])]);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(s.inspect().revision).toBe(0);
});

// The value 60 is already in a pending override of another run, so the manual write changes nothing and commits nothing.
for (const seconds of [undefined, 1]) it(`does not commit a pending keystroke override when a manual write${seconds ? ' with a transition' : ''} sets the same value (R7)`, () => {
 const key = { code: 'KeyK', control: true, alt: true, shift: false, meta: false };
 const s = start([graphOf('k', node('key', 'event.keystroke', key), [setFov(60)]), graphOf('g', null, [setFov(60, seconds)])]);
 s.advance(32, 32, { events: [{ kind: 'keystroke', accelerator: keystrokeAccelerator(key) }] });
 s.advance(48);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 s.advance(281);
 expect(s.inspect().revision).toBe(0);
 s.advance(282);
 expect(s.inspect().revision).toBe(1);
 expect(fovOf(s.inspect())).toBeCloseTo(60, 9);
});

it('does not commit the override of an ended transition when a manual write sets the same value (R7)', () => {
 const s = start([graphOf('t', null, [setFov(60, 1)]), graphOf('g', null, [setFov(60)])]);
 expect(s.runBlueprint('t', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 let ms = 32;
 for (; !closeTo(fovOf(s.advance(ms).scene), 60); ms += 16) if (ms > 1300) throw new Error('the transition did not end');
 expect(s.inspect().revision).toBe(0);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 const ended = ms;
 for (ms += 16; s.inspect().revision === 0 && ms <= ended + 400; ms += 16) s.advance(ms);
 expect(s.inspect().revision).toBe(1);
 expect(fovOf(s.inspect())).toBeCloseTo(60, 9);
});

it('runs a wired On Transition End of a manual write on the next clock step, not in the call (R7)', () => {
 const g = graphOf('g', null, [setFov(60), node('done', 'debug.log', { level: 'info' }, { message: 'end' })], [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'transitionEnd', 'done', 'flow')]);
 const s = start([g]);
 const lines = () => s.debugBlueprints().entries.map(entry => [entry.atMs, entry.kind === 'log' ? entry.message : entry.kind]);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(fovOf(s.inspect())).toBeCloseTo(60, 9);
 expect(lines()).toEqual([]);
 s.advance(32);
 expect(lines()).toEqual([[32, 'end']]);
});

it('replies with the error of a failed commit, drops the override, and reports the graph (R7)', () => {
 const scene = { ...makeSmokeScene(), revision: Number.MAX_SAFE_INTEGER };
 const before = positionOf(scene, 'reference');
 const s = start([graph], scene);
 expect(s.runBlueprint('g', 'go')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Revision limit reached' } });
 expect(s.inspect().revision).toBe(Number.MAX_SAFE_INTEGER);
 expect(positionOf(s.advance(32).scene, 'reference')).toEqual(before);
 expect(s.inspectBlueprints().errors).toEqual([{ graphId: 'g', kind: 'runtime', error: { code: 'INVALID_INPUT', message: 'Revision limit reached', ids: [] } }]);
});
