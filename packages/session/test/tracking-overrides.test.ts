import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, defaultTrackingConfig, makeSmokeScene, SceneViewSchema, type Quat, type SceneEntity, type ScenePatch, type SceneView, type TrackingBone, type TrackingConfig, type TrackingMapping, type TrackingSample } from '@opensekai/contracts';
import { applyCalibration, captureCalibration } from '../src/tracking-calibration';
import { applyMapping } from '../src/tracking-mapping';
import { createTrackingComposer } from '../src/tracking';
import { createSession } from '../src/session';
import { eulerToQuat, multiplyQuat } from '../src/bone-offsets';

const RAD = Math.PI / 180;
const about = (axis: 0 | 1 | 2, degrees: number): Quat => { const q: Quat = [0, 0, 0, Math.cos(degrees * RAD / 2)]; q[axis] = Math.sin(degrees * RAD / 2); return q; };
const [qx, qy, qz] = [(d: number) => about(0, d), (d: number) => about(1, d), (d: number) => about(2, d)];
const inverse = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const angle = (q: Quat) => 2 * Math.acos(Math.min(1, Math.abs(q[3]))) / RAD;
// Equal rotations: q and -q are the same rotation.
function expectSame(a: Quat, b: Quat, digits = 6) {
 const sign = a.reduce((sum, value, i) => sum + value * b[i]!, 0) < 0 ? -1 : 1;
 a.forEach((value, i) => expect(value * sign).toBeCloseTo(b[i]!, digits));
}
const bone = (rotation: Quat, space: TrackingBone['space'] = 'normalized'): TrackingBone => ({ rotation, space });
const sample = (bones: Record<string, TrackingBone>, expressions: Record<string, number> = {}, sourceId = 's', receivedAtMs = 0, generation = 1): TrackingSample => ({ sourceId, generation, receivedAtMs, bones, expressions });
const mapping = (patch: Partial<TrackingMapping>): TrackingMapping => ({ ...structuredClone(DEFAULT_TRACKING_MAPPING) as TrackingMapping, ...patch });

describe('calibration', () => {
 it('captures only the six calibration bones with their spaces', () => {
  const captured = captureCalibration(sample({ head: bone(qy(10), 'raw'), chest: bone(qx(5)), leftEye: bone(qy(3)), leftUpperArm: bone(qz(40)) }));
  expect(captured).toEqual({ bones: { chest: bone(qx(5)), head: bone(qy(10), 'raw') } });
  expect(captureCalibration(sample({ leftEye: bone(qy(3)) }))).toBeNull();
 });
 it('makes the captured pose identity and leaves other bones and spaces alone', () => {
  const neutral = sample({ head: bone(qy(10), 'raw'), hips: bone(qx(4)) });
  const calibration = captureCalibration(neutral)!;
  const same = applyCalibration(neutral, calibration);
  expectSame(same.bones.head!.rotation, [0, 0, 0, 1]);
  expectSame(same.bones.hips!.rotation, [0, 0, 0, 1]);
  const other = applyCalibration(sample({ head: bone(qy(10), 'normalized'), leftUpperArm: bone(qz(40)) }), calibration);
  expect(other.bones.head!.rotation).toEqual(qy(10));
  expect(other.bones.leftUpperArm!.rotation).toEqual(qz(40));
 });
 it('reads a 30° head as 20° after a calibration at 10°', () => {
  const calibration = captureCalibration(sample({ head: bone(qy(10), 'raw') }))!;
  expect(angle(applyCalibration(sample({ head: bone(qy(30), 'raw') }), calibration).bones.head!.rotation)).toBeCloseTo(20, 6);
 });
 it('calibrates a MediaPipe head above the calibrated chest', () => {
  // A MediaPipe head is inverse(chest) × face.
  const shape = (chestPitch: number, faceYaw: number) => sample({ chest: bone(qx(chestPitch)), head: bone(multiplyQuat(inverse(qx(chestPitch)), qy(faceYaw))) });
  const neutral = shape(10, 5), calibration = captureCalibration(neutral)!;
  const moved = shape(25, 35), result = applyCalibration(moved, calibration);
  const expected = multiplyQuat(inverse(multiplyQuat(neutral.bones.chest!.rotation, neutral.bones.head!.rotation)), multiplyQuat(moved.bones.chest!.rotation, moved.bones.head!.rotation));
  expectSame(multiplyQuat(result.bones.chest!.rotation, result.bones.head!.rotation), expected);
  const still = applyCalibration(shape(10, 35), calibration);
  expectSame(multiplyQuat(still.bones.chest!.rotation, still.bones.head!.rotation), qy(30));
 });
});

describe('mapping', () => {
 it('scales the head angle by its intensity', () => {
  for (const [intensity, degrees] of [[0, 0], [.5, 20], [1, 40], [2, 80]] as const)
   expect(angle(applyMapping(sample({ head: bone(qy(40)) }), mapping({ headIntensity: intensity })).bones.head!.rotation)).toBeCloseTo(degrees, 6);
  // 260° about +Y: the half angle is 130°, so w is negative and the axis stays.
  const wide = applyMapping(sample({ head: bone(qy(130)) }), mapping({ headIntensity: 2 })).bones.head!.rotation;
  wide.forEach((value, i) => expect(value).toBeCloseTo([0, Math.sin(130 * RAD), 0, Math.cos(130 * RAD)][i]!, 9));
 });
 it('turns the head offset in Euler order YXZ, +Z toward +X for a positive y', () => {
  const offset = applyMapping(sample({ head: bone([0, 0, 0, 1]) }), mapping({ headOffset: [0, 15, 0] })).bones.head!.rotation;
  offset.forEach((value, i) => expect(value).toBeCloseTo([0, Math.sin(7.5 * RAD), 0, Math.cos(7.5 * RAD)][i]!, 9));
  expectSame(applyMapping(sample({ head: bone([0, 0, 0, 1]) }), mapping({ headOffset: [10, 15, 0] })).bones.head!.rotation, multiplyQuat(qy(15), qx(10)));
  expectSame(eulerToQuat([10, 15, 0]), multiplyQuat(qy(15), qx(10)));
 });
 it('scales the eye angles by the eye intensity', () => {
  const eyes = applyMapping(sample({ leftEye: bone(qy(20)), rightEye: bone(qx(-10)), head: bone(qy(20)) }), mapping({ eyeIntensity: .5 })).bones;
  expect(angle(eyes.leftEye!.rotation)).toBeCloseTo(10, 6);
  expect(angle(eyes.rightEye!.rotation)).toBeCloseTo(5, 6);
  expect(eyes.head!.rotation).toEqual(qy(20));
 });
 it('maps each blend shape range, then the sensitivity, by canonical name', () => {
  const range = { inputMin: .2, inputMax: .8, outputMin: 0, outputMax: 1 };
  const map = (value: number, m: TrackingMapping, name = 'eyeBlinkLeft') => applyMapping(sample({}, { [name]: value }), m).expressions[name];
  const ranged = mapping({ blendShapes: { eyeBlinkLeft: range } });
  expect(map(.5, ranged)).toBeCloseTo(.5, 9);
  expect(map(.1, ranged)).toBe(0);
  expect(map(.9, ranged)).toBe(1);
  expect(map(.5, ranged, 'eyeBlink_L')).toBeCloseTo(.5, 9);
  expect(applyMapping(sample({}, { eyeBlink_L: .1 }), ranged).expressions).toEqual({ eyeBlink_L: 0 });
  expect(map(.9, mapping({ blendShapes: { jawOpen: { ...range, outputMax: 0 } } }), 'jawOpen')).toBe(0);
  expect(map(.7, mapping({ blendShapeSensitivity: 2 }), 'jawOpen')).toBe(1);
  expect(map(.2, mapping({ blendShapeSensitivity: 2 }), 'customSmile')).toBeCloseTo(.4, 9);
 });
 it('gives both blink channels the larger value with linked blink', () => {
  expect(applyMapping(sample({}, { eyeBlink_L: .2, eyeBlink_R: .9, jawOpen: .3 }), mapping({ linkedBlink: true })).expressions).toEqual({ eyeBlink_L: .9, eyeBlink_R: .9, jawOpen: .3 });
  expect(applyMapping(sample({}, { eyeBlinkLeft: .2 }), mapping({ linkedBlink: true })).expressions).toEqual({ eyeBlinkLeft: .2 });
 });
 it('leaves a sample unchanged with the default mapping', () => {
  const input = sample({ head: bone(qy(130)), leftEye: bone(qx(8)) }, { jawOpen: .4, customSmile: .7 });
  expect(applyMapping(input, mapping({}))).toEqual(input);
 });
});

const transform = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as Quat, scale: [1, 1, 1] as [number, number, number] };
const source = (id: string, kind: TrackingConfig['kind'], extra: Partial<Extract<SceneEntity, { kind: 'tracking' }>> = {}): SceneEntity => {
 const config = defaultTrackingConfig(kind);
 config.enabled = true;
 return { id, kind: 'tracking', name: id, visible: true, transform, config, generation: 1, smoothing: { enabled: false, minCutoff: 5, beta: .5, derivativeCutoff: 1 }, ...extra } as SceneEntity;
};
function performers(sources: SceneEntity[], first: { bodySourceId: string | null; faceSourceId: string | null; fingersSourceId?: string | null }, second?: typeof first): SceneView {
 const scene = makeSmokeScene();
 scene.entities.push(...sources);
 const performer = scene.entities.find(entity => entity.id === 'performer')!;
 if (performer.kind !== 'avatar') throw new Error('Avatar');
 performer.tracking = first;
 if (second) scene.entities.push({ ...structuredClone(performer), id: 'second', name: 'Second', tracking: second });
 return SceneViewSchema.parse(scene);
}
const update = (...samples: TrackingSample[]) => ({ samples, statuses: [] });
const poseOf = (poses: { avatarId: string; bones: Record<string, TrackingBone>; expressions: Record<string, number> }[], id = 'performer') => poses.find(pose => pose.avatarId === id)!;

describe('composer', () => {
 it('applies calibration, then mapping, then the stale fade', () => {
  const scene = performers([source('face', 'ifacialmocap', { calibration: { bones: { head: bone(qy(10), 'raw') } }, mapping: mapping({ headIntensity: 2, blendShapeSensitivity: 2 }) })], { bodySourceId: null, faceSourceId: 'face' });
  const composer = createTrackingComposer();
  composer.ingest(update(sample({ head: bone(qy(30), 'raw') }, { jawOpen: .4 }, 'face')), scene);
  const live = poseOf(composer.evaluate(scene, 0).avatarPoses);
  expect(angle(live.bones.head!.rotation)).toBeCloseTo(40, 6);
  expect(live.expressions.jawOpen).toBeCloseTo(.8, 9);
  const stale = poseOf(composer.evaluate(scene, 625).avatarPoses);
  expect(stale.bones.head!.weight).toBeCloseTo(.5, 9);
  expect(angle(stale.bones.head!.rotation)).toBeCloseTo(40, 6);
  expect(stale.expressions.jawOpen).toBeCloseTo(.4, 9);
 });
 it('keeps the MediaPipe head and chest composition with a calibrated chest', () => {
  const shape = (chestPitch: number, faceYaw: number) => ({ chest: bone(qx(chestPitch)), head: bone(multiplyQuat(inverse(qx(chestPitch)), qy(faceYaw))) });
  const calibration = captureCalibration(sample(shape(10, 5)))!;
  const scene = performers([source('body', 'vmc'), source('camera', 'mediapipe', { calibration })], { bodySourceId: 'body', faceSourceId: 'camera' });
  const composer = createTrackingComposer();
  composer.ingest(update(sample({ hips: bone([0, 0, 0, 1]) }, {}, 'body'), sample(shape(10, 35), {}, 'camera')), scene);
  expectSame(poseOf(composer.evaluate(scene, 0).avatarPoses).bones.head!.rotation, qy(30));
 });
 it('takes only finger bones from the finger source, side by side with the body source', () => {
  const scene = performers([source('body', 'vmc'), source('fingers', 'mediapipe')], { bodySourceId: 'body', faceSourceId: null, fingersSourceId: 'fingers' });
  const composer = createTrackingComposer();
  composer.ingest(update(sample({ leftHand: bone(qx(5)), leftIndexProximal: bone(qx(10)), rightIndexProximal: bone(qx(10)) }, {}, 'body'), sample({ leftHand: bone(qz(30)), leftIndexProximal: bone(qz(20)), head: bone(qy(40)) }, {}, 'fingers', 300)), scene);
  const bones = poseOf(composer.evaluate(scene, 300).avatarPoses).bones;
  expect(bones.leftIndexProximal!.rotation).toEqual(qz(20));
  expect(bones.leftHand!.rotation).toEqual(qx(5));
  expect(bones.rightIndexProximal!.rotation).toEqual(qx(10));
  expect(bones.head).toBeUndefined();
  // Past the 750 ms fade the finger source has no live input; the body source's fingers apply.
  composer.ingest(update(sample({ leftIndexProximal: bone(qx(12)) }, {}, 'body', 1200)), scene);
  expect(poseOf(composer.evaluate(scene, 1200).avatarPoses).bones.leftIndexProximal!.rotation).toEqual(qx(12));
 });
 it('keeps two avatars with their own finger sources independent', () => {
  const scene = performers([source('body-a', 'vmc'), source('body-b', 'vmc'), source('fingers-a', 'mediapipe'), source('fingers-b', 'mediapipe')], { bodySourceId: 'body-a', faceSourceId: null, fingersSourceId: 'fingers-a' }, { bodySourceId: 'body-b', faceSourceId: null, fingersSourceId: 'fingers-b' });
  const composer = createTrackingComposer();
  composer.ingest(update(sample({ hips: bone([0, 0, 0, 1]) }, {}, 'body-a'), sample({ hips: bone([0, 0, 0, 1]) }, {}, 'body-b'), sample({ leftThumbProximal: bone(qz(15)) }, {}, 'fingers-a'), sample({ leftThumbProximal: bone(qz(-25)) }, {}, 'fingers-b')), scene);
  const poses = composer.evaluate(scene, 0).avatarPoses;
  expect(poseOf(poses).bones.leftThumbProximal!.rotation).toEqual(qz(15));
  expect(poseOf(poses, 'second').bones.leftThumbProximal!.rotation).toEqual(qz(-25));
 });
});

const patch = (scene: SceneView, operations: ScenePatch['operations']): ScenePatch => ({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations });
const entity = (scene: SceneView, id: string) => scene.entities.find(item => item.id === id) as Extract<SceneEntity, { kind: 'tracking' }>;
const avatar = (scene: SceneView, id: string) => scene.entities.find(item => item.id === id) as Extract<SceneEntity, { kind: 'avatar' }>;
function receiving(sources = [source('face', 'ifacialmocap'), source('camera', 'mediapipe')]) {
 const session = createSession(performers(sources, { bodySourceId: null, faceSourceId: 'face' }), 'b6');
 return { session, send: (rotation: Quat, at: number, sourceId = 'face', generation = 1) => session.ingestTracking(update(sample({ head: bone(rotation, 'raw'), leftEye: bone(qy(2)) }, { jawOpen: .2 }, sourceId, at, generation))) };
}
const calibrate = (session: ReturnType<typeof createSession>, id = 'face', extra: ScenePatch['operations'] = []) => session.applyPatch(patch(session.inspect(), [...extra, { kind: 'calibrateTracking', entityId: id }]));

describe('session calibrateTracking', () => {
 it('writes the captured calibration in one revision and replaces it on a second capture', () => {
  const { session, send } = receiving();
  send(qy(10), 0);
  session.advance(16, 100);
  const before = session.inspect().revision;
  expect(calibrate(session)).toEqual({ ok: true, data: { revision: before + 1 } });
  expect(entity(session.inspect(), 'face').calibration).toEqual({ bones: { head: bone(qy(10), 'raw') } });
  send(qy(20), 200);
  session.advance(32, 250);
  expect(calibrate(session).ok).toBe(true);
  expect(entity(session.inspect(), 'face').calibration).toEqual({ bones: { head: bone(qy(20), 'raw') } });
  const frame = session.advance(48, 260);
  expect(angle(poseOf(frame.avatarPoses!).bones.head!.rotation)).toBeCloseTo(0, 6);
 });
 it('fails with the source ID before the first advance, on a stopped source, and on a stale sample', () => {
  const first = receiving();
  first.send(qy(10), 0);
  expect(calibrate(first.session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  first.session.advance(16, 601);
  expect(calibrate(first.session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  first.session.advance(32, 500);
  expect(calibrate(first.session).ok).toBe(true);
  const stopped = receiving([{ ...source('face', 'ifacialmocap'), config: defaultTrackingConfig('ifacialmocap') } as SceneEntity]);
  stopped.session.advance(16, 0);
  expect(calibrate(stopped.session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
 });
 it('fails on a sample of an old generation and on a sample without calibration bones', () => {
  const { session, send } = receiving([source('face', 'ifacialmocap', { generation: 7 })]);
  send(qy(10), 0, 'face', 7);
  session.advance(16, 10);
  const scene = session.inspect(), face = entity(scene, 'face');
  expect(session.applyPatch(patch(scene, [{ kind: 'setTrackingConfig', entityId: 'face', config: { ...face.config, port: 49984 } as TrackingConfig }])).ok).toBe(true);
  expect(calibrate(session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  const eyes = receiving();
  eyes.session.ingestTracking(update(sample({ leftEye: bone(qy(2)) }, {}, 'face')));
  eyes.session.advance(16, 10);
  expect(calibrate(eyes.session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
 });
 it('fails in a patch that also reconfigures or removes the source', () => {
  const { session, send } = receiving();
  send(qy(10), 0);
  session.advance(16, 10);
  const face = entity(session.inspect(), 'face');
  const before = session.inspect();
  expect(calibrate(session, 'face', [{ kind: 'setTrackingConfig', entityId: 'face', config: face.config }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  expect(calibrate(session, 'face', [{ kind: 'removeEntity', entityId: 'face' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  expect(session.inspect()).toEqual(before);
 });
 it('keeps the calibration on a config change, except a MediaPipe mirror change', () => {
  const calibration = { bones: { head: bone(qy(10)) } };
  const session = createSession(performers([source('face', 'ifacialmocap', { calibration: { bones: { head: bone(qy(10), 'raw') } } }), source('camera', 'mediapipe', { calibration })], { bodySourceId: 'camera', faceSourceId: 'face' }), 'b6');
  const scene = session.inspect(), face = entity(scene, 'face'), camera = entity(scene, 'camera');
  expect(session.applyPatch(patch(scene, [{ kind: 'setTrackingConfig', entityId: 'face', config: { ...face.config, port: 49984 } as TrackingConfig }, { kind: 'setTrackingConfig', entityId: 'camera', config: { ...camera.config, hands: true } as TrackingConfig }])).ok).toBe(true);
  expect(entity(session.inspect(), 'face').calibration).toBeDefined();
  expect(entity(session.inspect(), 'camera').calibration).toEqual(calibration);
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setTrackingConfig', entityId: 'camera', config: { ...camera.config, mirror: true } as TrackingConfig }])).ok).toBe(true);
  expect(entity(session.inspect(), 'camera').calibration).toBeUndefined();
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setTrackingCalibration', entityId: 'face', calibration: null }])).ok).toBe(true);
  expect(entity(session.inspect(), 'face').calibration).toBeUndefined();
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setTrackingMapping', entityId: 'performer', mapping: mapping({}) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 });
});

describe('session finger slot', () => {
 const sources = () => [source('body-a', 'vmc'), source('body-b', 'vmc'), source('fingers', 'mediapipe')];
 it('clears the finger slot when the source is removed', () => {
  const session = createSession(performers(sources(), { bodySourceId: 'body-a', faceSourceId: null, fingersSourceId: 'fingers' }), 'b6');
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'removeEntity', entityId: 'fingers' }])).ok).toBe(true);
  expect(avatar(session.inspect(), 'performer').tracking).toEqual({ bodySourceId: 'body-a', faceSourceId: null });
  expect(SceneViewSchema.safeParse(session.inspect()).success).toBe(true);
 });
 it('rejects giving one avatar the finger source of another, and accepts one source in two slots of one avatar', () => {
  const session = createSession(performers(sources(), { bodySourceId: 'body-a', faceSourceId: null, fingersSourceId: 'fingers' }, { bodySourceId: 'body-b', faceSourceId: null }), 'b6');
  const reply = session.applyPatch(patch(session.inspect(), [{ kind: 'setAvatarTracking', entityId: 'second', tracking: { bodySourceId: 'fingers', faceSourceId: null } }]));
  expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setAvatarTracking', entityId: 'second', tracking: { bodySourceId: 'body-b', faceSourceId: null, fingersSourceId: 'body-b' } }])).ok).toBe(true);
  expect(session.applyPatch(patch(session.inspect(), [{ kind: 'setAvatarTracking', entityId: 'performer', tracking: { bodySourceId: 'body-a', faceSourceId: null, fingersSourceId: null } }])).ok).toBe(true);
  expect(avatar(session.inspect(), 'performer').tracking).toEqual({ bodySourceId: 'body-a', faceSourceId: null });
 });
});
