import { describe, expect, it } from 'vitest';
import { ease, makeSmokeScene, orbitFromTransform, orbitFromUser, rotationOf, transformFromOrbit, userFromOrbit, type OrbitUser, type SceneView, type Transform, type Vec3 } from '@opensekai/contracts';
import { compileBlueprint } from '../src/blueprint';
import { createSession } from '../src/session';
import { EMPTY_OVERRIDES } from '../src/overrides';
import { EMPTY_TWEENS, writeOrbit } from '../src/tweens';

// Camera Orbit Character (B32 R1–R10), through the same session API that the host relay calls, on the session clock.
type S = ReturnType<typeof createSession>;
type Frame = ReturnType<S['advance']>;
const at = { x: 0, y: 0 };
const PIVOT_OFFSET: Vec3 = [0, 1.3, 0];
const orbitMode = { mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset: PIVOT_OFFSET } as const;
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const log = (id: string, message: string) => node(id, 'debug.log', { level: 'info' }, { message });
const orbit = (id: string, target: OrbitUser, seconds?: number, cameraId = 'camera_wide', easing = 'Linear') =>
 node(id, 'camera.orbitCharacter', { cameraId, ...(seconds === undefined ? {} : { transitionSeconds: seconds, easing }) }, { yaw: target.yawDegrees, pitch: target.pitchDegrees, distance: target.distance });
const graph = (id: string, nodes: unknown[], connections: unknown[], trigger = node('go', 'event.manual')) => ({ schemaVersion: 1, id, name: id, enabled: true, variables: [], nodes: [trigger, ...nodes], connections });
// go → set; set.exit → started; set.transitionEnd → done.
const ended = (id: string, set: unknown) => graph(id, [set, log('started', `${id} exit`), log('done', `${id} end`)], [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'exit', 'started', 'flow'), wire('c', 'set', 'transitionEnd', 'done', 'flow')]);

function start(...graphs: unknown[]): S {
 const s = createSession(makeSmokeScene(), 's');
 const placed = s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: orbitMode }] });
 if (!placed.ok) throw new Error(placed.error.message);
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 s.advance(0);
 return s;
}
const run = (s: S, graphId = 'g') => s.runBlueprint(graphId, 'go');
const lines = (s: S) => s.debugBlueprints().entries.map(entry => [entry.atMs, entry.kind === 'log' ? entry.message : entry.kind]);
const entity = (scene: SceneView, id: string) => scene.entities.find(item => item.id === id)!;
const cameraOf = (frame: Frame | SceneView, id = 'camera_wide'): Transform => entity('scene' in frame ? frame.scene : frame, id).transform as Transform;
const near = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, digits));
// Quaternions q and -q are one rotation.
const sameRotation = (actual: readonly number[], expected: readonly number[]) => expect(Math.abs(actual.reduce((sum, value, i) => sum + value * expected[i]!, 0))).toBeCloseTo(1, 6);
const pose = (user: OrbitUser, pivot: Vec3 = PIVOT_OFFSET) => transformFromOrbit(orbitFromUser(user, pivot), [1, 1, 1]);
const startUser = userFromOrbit(orbitFromTransform(cameraOf(makeSmokeScene()), PIVOT_OFFSET));
const lerpUser = (from: OrbitUser, to: OrbitUser, k: number): OrbitUser => ({ yawDegrees: from.yawDegrees + (to.yawDegrees - from.yawDegrees) * k, pitchDegrees: from.pitchDegrees + (to.pitchDegrees - from.pitchDegrees) * k, distance: from.distance + (to.distance - from.distance) * k });
const target: OrbitUser = { yawDegrees: 90, pitchDegrees: 20, distance: 2 };
const sweep = (s: S, from: number, to: number) => { let last: Frame | undefined; for (let ms = from; ms <= to; ms += 20) last = s.advance(ms); return last!; };

describe('Camera Orbit Character without a transition (R5)', () => {
 it('writes the position and rotation and runs the end on the next clock step', () => {
  for (const seconds of [undefined, 0]) {
   const s = start(ended('g', orbit('set', target, seconds)));
   expect(run(s).ok).toBe(true);
   expect(lines(s)).toEqual([[0, 'g exit']]);
   const frame = s.advance(20);
   expect(lines(s)).toEqual([[0, 'g exit'], [20, 'g end']]);
   near(cameraOf(frame).position, pose(target).position);
   sameRotation(cameraOf(frame).rotation, rotationOf(Math.PI / 2, -20 * Math.PI / 180));
   // The idle commit writes the same values to the scene; the rotation goes through Euler and back.
   sweep(s, 40, 400);
   near(cameraOf(s.inspect()).position, pose(target).position);
   sameRotation(cameraOf(s.inspect()).rotation, pose(target).rotation);
   expect(cameraOf(s.inspect()).scale).toEqual([1, 1, 1]);
  }
 });
 it('writes nothing for the current orbit and still runs the end', () => {
  const s = start(ended('g', orbit('set', { ...startUser, yawDegrees: startUser.yawDegrees + 360 })));
  const before = s.inspect();
  run(s);
  sweep(s, 20, 400);
  expect(lines(s)).toEqual([[0, 'g exit'], [20, 'g end']]);
  expect(s.inspect()).toEqual(before);
 });
});

describe('Camera Orbit Character with a transition (R6)', () => {
 it('eases Yaw, Pitch, and Distance from the current orbit and ends at the exact target', () => {
  const s = start(ended('g', orbit('set', target, 1, 'camera_wide', 'InOutSine')));
  run(s);
  for (const ms of [250, 500, 750]) {
   const frame = sweep(s, ms - 240, ms);
   const expected = pose(lerpUser(startUser, target, ease('InOutSine', ms / 1000)));
   near(cameraOf(frame).position, expected.position);
   sameRotation(cameraOf(frame).rotation, expected.rotation);
  }
  const end = sweep(s, 760, 1000);
  near(cameraOf(end).position, pose(target).position, 9);
  expect(lines(s)).toEqual([[0, 'g exit']]);
  s.advance(1020);
  expect(lines(s)).toEqual([[0, 'g exit'], [1020, 'g end']]);
 });
 it('goes the short way for Yaw', () => {
  const s = start(graph('g', [orbit('set', { yawDegrees: 350, pitchDegrees: 0, distance: 3 })], [wire('a', 'go', 'flow', 'set', 'flow')]), graph('h', [orbit('set', { yawDegrees: 10, pitchDegrees: 0, distance: 3 }, 1)], [wire('a', 'go', 'flow', 'set', 'flow')]));
  run(s);
  s.advance(20);
  run(s, 'h');
  const middle = sweep(s, 40, 520);
  // Halfway between 350 and 370 is 0: the camera is on the +Z side, not on the -Z side (the long way through 180).
  near(cameraOf(middle).position, pose({ yawDegrees: 0, pitchDegrees: 0, distance: 3 }).position, 3);
 });
 it('runs a chain of two nodes through On Transition End', () => {
  const second: OrbitUser = { yawDegrees: 180, pitchDegrees: 10, distance: 3 };
  const s = start(graph('g', [orbit('one', target, 0.5), orbit('two', second, 0.5), log('done', 'chain end')], [wire('a', 'go', 'flow', 'one', 'flow'), wire('b', 'one', 'transitionEnd', 'two', 'flow'), wire('c', 'two', 'transitionEnd', 'done', 'flow')]));
  expect(compileBlueprint(graph('g', [orbit('one', target, 0.5)], [wire('a', 'go', 'flow', 'one', 'flow'), wire('b', 'one', 'transitionEnd', 'one', 'flow')])).ok).toBe(true);
  run(s);
  const half = sweep(s, 20, 500);
  near(cameraOf(half).position, pose(target).position, 9);
  const last = sweep(s, 520, 1100);
  near(cameraOf(last).position, pose(second).position, 9);
  // The second tween starts from the previous advance (500 ms), so it ends at 1000 ms.
  expect(lines(s)).toEqual([[1020, 'chain end']]);
 });
});

describe('Camera Orbit Character and a moving character (R4, R8)', () => {
 it('orbits the evaluated character while a Blueprint override moves it, and commits once after the end', () => {
  const moved: Vec3 = [1, 0, -0.5];
  const shift = graph('h', [node('set', 'property.set', { entityId: 'performer', property: 'position' }, { value: moved })], [wire('a', 'go', 'flow', 'set', 'flow')]);
  const s = start(ended('g', orbit('set', target, 1)), shift);
  run(s, 'h');
  run(s);
  const frame = sweep(s, 20, 500);
  // The performer override commits at 250 ms, during the move; the camera keeps orbiting the moved character.
  expect(entity(s.inspect(), 'performer').transform.position).toEqual(moved);
  const pivot: Vec3 = [moved[0], moved[1] + 1.3, moved[2]];
  near(cameraOf(frame).position, pose(lerpUser(startUser, target, 0.5), pivot).position);
  const revision = s.inspect().revision;
  sweep(s, 520, 1000);
  expect(s.inspect().revision).toBe(revision);
  sweep(s, 1020, 1600);
  expect(s.inspect().revision).toBe(revision + 1);
  near(cameraOf(s.inspect()).position, pose(target, pivot).position);
 });
 it('keeps the evaluated camera continuous across the end and the idle commit while the character walks', () => {
  const step: Vec3 = [0.002, 0, 0.001];
  const walk = graph('walk', [node('move', 'entity.move', { entityId: 'performer', space: 'world' }, { delta: step })], [wire('a', 'tick', 'flow', 'move', 'flow')], node('tick', 'event.update'));
  const s = start(ended('g', orbit('set', target, 1)), walk);
  s.advance(20);
  run(s);
  const relative: Vec3[] = [];
  let revision = s.inspect().revision;
  for (let ms = 40; ms <= 2000; ms += 20) {
   const frame = s.advance(ms);
   // The frame adds the smoke motion of the performer; take it out to get the evaluated (override) position.
   const smoke = entity(frame.scene, 'performer').transform.position;
   const performer = [smoke[0] - 0.08 * Math.sin(ms / 1000), smoke[1] - 0.02 * Math.sin(ms / 500), smoke[2]];
   relative.push(cameraOf(frame).position.map((value, i) => value - performer[i]!) as Vec3);
   if (ms === 1020) revision = s.inspect().revision;
  }
  // Relative to the walking character, the camera is the eased orbit around the pivot offset.
  near(relative[(500 - 40) / 20]!, pose(lerpUser(startUser, target, 0.48)).position);
  // The tween started at 20 ms, so it ends at 1020 ms. After the end the camera stays at the target relative to the character: no jump at the end or at the idle commit.
  const end = pose(target).position;
  for (const offset of relative.slice((1020 - 40) / 20)) near(offset, end);
  expect(s.inspect().revision).toBe(revision + 1);
  expect(lines(s)).toEqual([[20, 'g exit'], [1040, 'g end']]);
 });
});

describe('Camera Orbit Character review fixes', () => {
 it('keeps a moved orbit position follow-relative: Move Entity on the camera does not drop the follow offset', () => {
  const step: Vec3 = [0.002, 0, 0.001];
  const walk = graph('walk', [node('move', 'entity.move', { entityId: 'performer', space: 'world' }, { delta: step })], [wire('a', 'tick', 'flow', 'move', 'flow')], node('tick', 'event.update'));
  const lift = graph('lift', [node('move', 'entity.move', { entityId: 'camera_wide', space: 'world' }, { delta: [0, 0.1, 0] })], [wire('a', 'go', 'flow', 'move', 'flow')]);
  const s = start(ended('g', orbit('set', target)), walk, lift);
  s.advance(20);
  run(s);
  s.advance(40);
  run(s, 'lift');
  const relative = (frame: Frame, ms: number) => {
   const smoke = entity(frame.scene, 'performer').transform.position;
   return cameraOf(frame).position.map((value, i) => value - [smoke[0] - 0.08 * Math.sin(ms / 1000), smoke[1] - 0.02 * Math.sin(ms / 500), smoke[2]][i]!);
  };
  const lifted = pose(target).position.map((value, i) => value + (i === 1 ? 0.1 : 0));
  for (let ms = 60; ms <= 1000; ms += 20) near(relative(s.advance(ms), ms), lifted);
 });
 it('stops an orbit tween without its end when its Focus Character is removed', () => {
  const s = start(ended('g', orbit('set', target, 1)));
  run(s);
  s.advance(500);
  // An output camera keeps the scene valid; the performer is not an output camera.
  expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'removeEntity', entityId: 'performer' }] }).ok).toBe(true);
  const after = sweep(s, 520, 600);
  sweep(s, 620, 2000);
  expect(lines(s)).toEqual([[0, 'g exit']]);
  near(cameraOf(s.inspect()).position, cameraOf(after).position);
 });
});

describe('Camera Orbit Character join, replace, and stop rules (R5, R7)', () => {
 it('joins a tween to the same target and replaces a tween to another target', () => {
  const join = start(ended('g', orbit('set', target, 1)), ended('h', orbit('set', { ...target, yawDegrees: target.yawDegrees - 360 }, 1)));
  run(join);
  join.advance(500);
  run(join, 'h');
  sweep(join, 520, 1040);
  expect(lines(join)).toEqual([[0, 'g exit'], [500, 'h exit'], [1020, 'g end'], [1020, 'h end']]);

  const other: OrbitUser = { yawDegrees: -45, pitchDegrees: 5, distance: 4 };
  const replace = start(ended('g', orbit('set', target, 1)), ended('h', orbit('set', other, 1)));
  run(replace);
  replace.advance(500);
  run(replace, 'h');
  const last = sweep(replace, 520, 1600);
  near(cameraOf(last).position, pose(other).position, 9);
  expect(lines(replace)).toEqual([[0, 'g exit'], [500, 'h exit'], [1520, 'h end']]);
 });

 const stops: [string, (s: S) => unknown][] = [
  ['an immediate orbit write', s => s.editBlueprints({ clientId: 't', batchId: 'x', ops: [{ kind: 'createGraph', graph: graph('x', [orbit('set', { yawDegrees: -45, pitchDegrees: 5, distance: 4 })], [wire('a', 'go', 'flow', 'set', 'flow')]) }] }) && run(s, 'x')],
  ['an immediate Set Asset Property Position', s => s.editBlueprints({ clientId: 't', batchId: 'x', ops: [{ kind: 'createGraph', graph: graph('x', [node('set', 'property.set', { entityId: 'camera_wide', property: 'position' }, { value: [0, 2, 5] })], [wire('a', 'go', 'flow', 'set', 'flow')]) }] }) && run(s, 'x')],
  ['a Set Asset Property Rotation tween', s => s.editBlueprints({ clientId: 't', batchId: 'x', ops: [{ kind: 'createGraph', graph: graph('x', [node('set', 'property.set', { entityId: 'camera_wide', property: 'rotation', transitionSeconds: 2 }, { value: [0, 30, 0] })], [wire('a', 'go', 'flow', 'set', 'flow')]) }] }) && run(s, 'x')],
  ['a setCameraNavigation patch', s => s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { ...orbitMode, pivotOffset: [0, 1, 0] } }] })],
  ['a setTransform patch', s => s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setTransform', entityId: 'camera_wide', transform: { position: [0, 1, 4], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }] })],
  ['a disable of the graph', s => s.editBlueprints({ clientId: 't', batchId: 'x', ops: [{ kind: 'updateGraph', graphId: 'g', enabled: false }] })],
 ];
 for (const [name, stop] of stops) it(`stops on ${name} and runs no end`, () => {
  const s = start(ended('g', orbit('set', target, 1)));
  run(s);
  s.advance(500);
  const reply = stop(s) as { ok: boolean };
  expect(reply.ok).toBe(true);
  const after = sweep(s, 520, 800);
  sweep(s, 820, 2000);
  expect(lines(s)).toEqual([[0, 'g exit']]);
  // The camera is not at the orbit target, and it does not move toward it after the stop.
  expect(Math.hypot(...cameraOf(after).position.map((value, i) => value - pose(target).position[i]!))).toBeGreaterThan(0.05);
  if (name !== 'a Set Asset Property Rotation tween') near(cameraOf(s.inspect()).position, cameraOf(after).position);
 });
 it('drops the camera position and rotation overrides on a setCameraNavigation patch', () => {
  const s = start(ended('g', orbit('set', target)));
  run(s);
  s.advance(20);
  expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: { mode: 'freeLook', sensitivity: 1 } }] }).ok).toBe(true);
  const frame = s.advance(40);
  expect(cameraOf(frame)).toEqual(cameraOf(makeSmokeScene()));
 });
 it('stops a running position tween of the camera when an orbit tween starts, without its end', () => {
  const position = graph('p', [node('set', 'property.set', { entityId: 'camera_wide', property: 'position', transitionSeconds: 2 }, { value: [0, 3, 6] }), log('done', 'p end')], [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'transitionEnd', 'done', 'flow')]);
  const s = start(ended('g', orbit('set', target, 1)), position);
  run(s, 'p');
  s.advance(500);
  run(s);
  const last = sweep(s, 520, 3000);
  near(cameraOf(last).position, pose(target).position, 9);
  expect(lines(s)).toEqual([[500, 'g exit'], [1520, 'g end']]);
 });
});

describe('Camera Orbit Character failures (R3)', () => {
 it('fails without a change for an unknown camera, a camera in another mode, and a non-finite value', () => {
  const s = start(graph('g', [orbit('set', target, 1, 'nobody')], [wire('a', 'go', 'flow', 'set', 'flow')]), graph('h', [orbit('set', target, 1, 'camera_close')], [wire('a', 'go', 'flow', 'set', 'flow')]));
  const before = s.inspect(), frame = s.advance(20);
  expect(run(s)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['nobody'] } });
  expect(run(s, 'h')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['camera_close'] } });
  const after = sweep(s, 40, 1500);
  expect(s.inspect()).toEqual(before);
  for (const id of ['camera_wide', 'camera_close']) expect(cameraOf(after, id)).toEqual(cameraOf(frame, id));

  const scene = createSession(makeSmokeScene(), 'x').inspect();
  scene.entities = scene.entities.map(item => item.id === 'camera_wide' && item.kind === 'camera' ? { ...item, navigation: orbitMode } : item);
  for (const value of [NaN, Infinity]) {
   const written = writeOrbit({ overrides: EMPTY_OVERRIDES, tweens: EMPTY_TWEENS }, scene, { kind: 'orbitCamera', cameraId: 'camera_wide', target: { ...target, distance: value } }, 'g', 0);
   expect(written).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['camera_wide'] } });
  }
 });
});

describe('Switch Camera and the main camera (R11)', () => {
 const cut = (outputId: string) => graph('g', [node('set', 'camera.switch', { outputId, cameraId: 'camera_close' })], [wire('a', 'go', 'flow', 'set', 'flow')]);
 it('sets the OBS output and the editor preview in one revision for output_main', () => {
  const s = createSession(makeSmokeScene(), 's');
  expect(s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [cut('output_main')] }] }).ok).toBe(true);
  s.advance(0);
  expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
  expect(s.inspect().outputs.map(output => [output.id, output.cameraId])).toEqual([['output_main', 'camera_close'], ['preview_main', 'camera_close']]);
 });
 it('sets only the preview for preview_main', () => {
  const s = createSession(makeSmokeScene(), 's');
  expect(s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [cut('preview_main')] }] }).ok).toBe(true);
  s.advance(0);
  expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
  expect(s.inspect().outputs.map(output => [output.id, output.cameraId])).toEqual([['output_main', 'camera_wide'], ['preview_main', 'camera_close']]);
 });
});

