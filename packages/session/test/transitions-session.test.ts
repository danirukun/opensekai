import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetRecord, type RuntimeFrame } from '@opensekai/contracts';
import { quatToEuler } from '../src/bone-offsets';
import { createSession } from '../src/session';

// Session tests through the public API: a manual trigger starts each transition, and only clock ticks follow.
type S = ReturnType<typeof createSession>;
const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object) => ({ id, version: 1, type, settings, position: at });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const num = (id: string, value: number) => node(id, 'value.number', { value });
const graph = (nodes: unknown[], connections: unknown[]) => ({ schemaVersion: 1, id: 'g', name: 'g', enabled: true, variables: [], nodes: [node('go', 'event.manual', {}), ...nodes], connections });
const record: AssetRecord = { id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1, name: 'Rem', expressions: [{ name: 'happy', preset: true }, { name: 'Wink', preset: false }] };
function start(nodes: unknown[], connections: unknown[]): S {
 const s = createSession(makeSmokeScene(), 's', [record]);
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [graph(nodes, connections)] }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 s.advance(0);
 return s;
}
const run = (s: S) => { const reply = s.runBlueprint('g', 'go'); if (!reply.ok) throw new Error(reply.error.message); };
// Advances the clock in 20 ms ticks up to `endMs` and returns the frame at each tick.
function ticks(s: S, fromMs: number, endMs: number): Map<number, RuntimeFrame> {
 const frames = new Map<number, RuntimeFrame>();
 for (let ms = fromMs; ms <= endMs; ms += 20) frames.set(ms, s.advance(ms));
 return frames;
}
const entity = (frame: RuntimeFrame, id: string) => frame.scene.entities.find(item => item.id === id)!;
const fov = (frame: RuntimeFrame) => { const camera = entity(frame, 'camera_wide'); return camera.kind === 'camera' ? camera.lens.fovDegrees : NaN; };
const pose = (frame: RuntimeFrame) => frame.avatarPoses?.find(item => item.avatarId === 'performer');

it('eases a camera Field of View and an entity Position over the ticks, and commits each final value once', () => {
 const s = start([
  num('wide', 85), num('x', 2.9), num('y', 0.7), num('z', -4),
  node('make', 'vector3.make', {}),
  node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', transitionSeconds: 1, easing: 'InOutSine' }),
  node('slide', 'property.set', { entityId: 'reference', property: 'position', transitionSeconds: 1 }),
 ], [
  wire('a', 'go', 'flow', 'lens', 'flow'), wire('b', 'wide', 'value', 'lens', 'value'), wire('c', 'lens', 'exit', 'slide', 'flow'),
  wire('d', 'x', 'value', 'make', 'x'), wire('e', 'y', 'value', 'make', 'y'), wire('f', 'z', 'value', 'make', 'z'), wire('g', 'make', 'value', 'slide', 'value'),
 ]);
 run(s);
 const revisions: number[] = [];
 const frames = new Map<number, RuntimeFrame>();
 for (let ms = 20; ms <= 2000; ms += 20) { frames.set(ms, s.advance(ms)); revisions.push(s.inspect().revision); }
 expect(fov(frames.get(500)!)).toBeCloseTo(65);
 expect(fov(frames.get(240)!)).toBeCloseTo(45 + 40 * (1 - Math.cos(Math.PI * 0.24)) / 2);
 expect(entity(frames.get(500)!, 'reference').transform.position).toEqual([expect.closeTo(1.9), expect.closeTo(0.7), expect.closeTo(-2)]);
 expect(fov(frames.get(1000)!)).toBe(85);
 // Monotonic for an ease without overshoot.
 const values = [...frames.values()].map(fov);
 expect(values.every((value, i) => i === 0 || value >= values[i - 1]!)).toBe(true);
 // No revision during the transition; one commit at the first tick 250 ms after the last write (1000 ms → 1260 ms).
 expect(revisions.slice(0, 62).every(revision => revision === 0)).toBe(true);
 expect(revisions.indexOf(1)).toBe(1260 / 20 - 1);
 expect(revisions.at(-1)).toBe(1);
 const committed = s.inspect().entities;
 expect(committed.find(e => e.id === 'camera_wide')).toMatchObject({ lens: { fovDegrees: 85 } });
 expect(committed.find(e => e.id === 'reference')?.transform.position).toEqual([2.9, 0.7, -4]);
});

it('keeps an old graph without transition settings immediate', () => {
 const s = start([num('wide', 85), node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees' })], [wire('a', 'go', 'flow', 'lens', 'flow'), wire('b', 'wide', 'value', 'lens', 'value')]);
 run(s);
 expect(fov(s.advance(20))).toBe(85);
 expect(s.inspect().revision).toBe(0);
 s.advance(270);
 expect(s.inspect().revision).toBe(1);
});

it('stops a transition when a patch sets the property, and the patch value stays', () => {
 const s = start([num('wide', 85), node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', transitionSeconds: 1 })], [wire('a', 'go', 'flow', 'lens', 'flow'), wire('b', 'wide', 'value', 'lens', 'value')]);
 run(s);
 ticks(s, 20, 500);
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setCameraLens', entityId: 'camera_wide', lens: { fovDegrees: 30, near: 0.01, far: 100 } }] })).toEqual({ ok: true, data: { revision: 1 } });
 const frames = ticks(s, 520, 1600);
 expect(fov(frames.get(1000)!)).toBe(30);
 expect(s.inspect().revision).toBe(1);
});

it('fades an expression with the transition time and easing of Set Expression', () => {
 const s = start([node('yes', 'value.boolean', { value: true }), node('face', 'character.setExpression', { entityId: 'performer', expression: 'happy', transitionSeconds: 1, easing: 'InQuad' })],
  [wire('a', 'go', 'flow', 'face', 'flow'), wire('b', 'yes', 'value', 'face', 'active')]);
 run(s);
 const frames = ticks(s, 20, 1200);
 expect(pose(frames.get(500)!)?.expressions.happy).toBeCloseTo(0.25);
 expect(pose(frames.get(1000)!)?.expressions.happy).toBe(1);
 expect(s.inspect().revision).toBe(0);
});

it('sets a blend shape weight with a transition, without a scene revision', () => {
 const s = start([num('weight', 0.8), node('shape', 'character.setBlendShape', { entityId: 'performer', blendShape: 'blink', transitionSeconds: 0.5 })],
  [wire('a', 'go', 'flow', 'shape', 'flow'), wire('b', 'weight', 'value', 'shape', 'weight')]);
 run(s);
 const frames = ticks(s, 20, 800);
 expect(pose(frames.get(240)!)?.expressions.blink).toBeCloseTo(0.384);
 expect(pose(frames.get(800)!)?.expressions.blink).toBe(0.8);
 expect(s.inspect().revision).toBe(0);
});

it('turns the head toward a camera with the Look At weight and transition', () => {
 const s = start([num('weight', 1), node('look', 'character.lookAt', { entityId: 'performer', targetId: 'camera_wide', transitionSeconds: 1 })],
  [wire('a', 'go', 'flow', 'look', 'flow'), wire('b', 'weight', 'value', 'look', 'weight')]);
 run(s);
 const frames = ticks(s, 20, 1200);
 const pitch = (ms: number) => quatToEuler(pose(frames.get(ms)!)!.boneOffsets!.head!)[0];
 // The camera is 3 m in front and 0.2 m below the estimated head point: look down by atan(0.2 / 3).
 const full = Math.atan2(0.2, 3) * 180 / Math.PI;
 expect(pitch(500)).toBeCloseTo(full / 2);
 expect(pitch(1200)).toBeCloseTo(full);
 expect(s.inspect().revision).toBe(0);
});

it('rolls back the character layers of a run whose effects fail', () => {
 const s = start([num('weight', 1), node('shape', 'character.setBlendShape', { entityId: 'performer', blendShape: 'blink' }), node('look', 'character.lookAt', { entityId: 'performer', targetId: 'performer' })],
  [wire('a', 'go', 'flow', 'shape', 'flow'), wire('b', 'weight', 'value', 'shape', 'weight'), wire('c', 'shape', 'exit', 'look', 'flow'), wire('d', 'weight', 'value', 'look', 'weight')]);
 expect(s.runBlueprint('g', 'go')).toMatchObject({ ok: false, error: { message: 'Look At target is the character' } });
 expect(pose(s.advance(20))).toBeUndefined();
});

it('reaches the target when On Update triggers each transition again on every tick', () => {
 const s = createSession(makeSmokeScene(), 's', [record]);
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [{ ...graph([
  node('tick', 'event.update', {}), num('wide', 85), num('weight', 0.8), num('one', 1), node('yes', 'value.boolean', { value: true }),
  node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', transitionSeconds: 0.5 }),
  node('face', 'character.setExpression', { entityId: 'performer', expression: 'happy', transitionSeconds: 0.5 }),
  node('shape', 'character.setBlendShape', { entityId: 'performer', blendShape: 'blink', transitionSeconds: 0.5 }),
  node('look', 'character.lookAt', { entityId: 'performer', targetId: 'camera_wide', transitionSeconds: 0.5 }),
 ], [
  wire('a', 'tick', 'flow', 'lens', 'flow'), wire('b', 'wide', 'value', 'lens', 'value'),
  wire('c', 'lens', 'exit', 'face', 'flow'), wire('d', 'yes', 'value', 'face', 'active'),
  wire('e', 'face', 'exit', 'shape', 'flow'), wire('f', 'weight', 'value', 'shape', 'weight'),
  wire('g', 'shape', 'exit', 'look', 'flow'), wire('h', 'one', 'value', 'look', 'weight'),
 ]) }] }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 const frames = ticks(s, 0, 1500);
 const pitch = (frame: RuntimeFrame) => quatToEuler(pose(frame)!.boneOffsets!.head!)[0];
 const full = Math.atan2(0.2, 3) * 180 / Math.PI;
 const mid = frames.get(260)!;
 expect(fov(mid)).toBeGreaterThan(55);
 expect(fov(mid)).toBeLessThan(85);
 expect(pose(mid)?.expressions.happy).toBeGreaterThan(0.3);
 expect(pose(mid)?.expressions.blink).toBeGreaterThan(0.3);
 expect(pitch(mid)).toBeGreaterThan(full * 0.3);
 const end = frames.get(1500)!;
 expect(fov(end)).toBe(85);
 expect(pose(end)?.expressions).toMatchObject({ happy: 1, blink: 0.8 });
 expect(pitch(end)).toBeCloseTo(full);
 // The repeated write of the reached value changes nothing, so the Field of View commits once.
 expect(s.inspect().revision).toBe(1);
});

it('stops the transitions, blend shapes, and look-at of a graph that is disabled', () => {
 const s = start([
  num('wide', 85), num('weight', 0.8), num('one', 1),
  node('lens', 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', transitionSeconds: 1 }),
  node('shape', 'character.setBlendShape', { entityId: 'performer', blendShape: 'blink', transitionSeconds: 1 }),
  node('look', 'character.lookAt', { entityId: 'performer', targetId: 'camera_wide', transitionSeconds: 1 }),
 ], [
  wire('a', 'go', 'flow', 'lens', 'flow'), wire('b', 'wide', 'value', 'lens', 'value'), wire('c', 'lens', 'exit', 'shape', 'flow'),
  wire('d', 'weight', 'value', 'shape', 'weight'), wire('e', 'shape', 'exit', 'look', 'flow'), wire('f', 'one', 'value', 'look', 'weight'),
 ]);
 run(s);
 const before = ticks(s, 20, 500).get(500)!;
 expect(fov(before)).toBeCloseTo(65);
 expect(pose(before)?.expressions.blink).toBeCloseTo(0.4);
 expect(s.editBlueprints({ clientId: 't', batchId: 'off', ops: [{ kind: 'updateGraph', graphId: 'g', enabled: false }] }).ok).toBe(true);
 const after = ticks(s, 520, 1200);
 expect(fov(after.get(1000)!)).toBeCloseTo(fov(before));
 expect(pose(after.get(520)!)).toBeUndefined();
 // The last sample commits as the value of the stopped transition.
 expect(s.inspect().revision).toBe(1);
 expect(s.inspect().entities.find(e => e.id === 'camera_wide')).toMatchObject({ lens: { fovDegrees: fov(before) } });
});
