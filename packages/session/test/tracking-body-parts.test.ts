import { describe, expect, it } from 'vitest';
import { BODY_PARTS, defaultTrackingConfig, makeSmokeScene, SceneViewSchema, type AvatarBodyTracking, type AvatarTracking, type BodyPart, type Quat, type SceneEntity, type SceneView, type TrackingBone, type TrackingConfig, type TrackingSample } from '@opensekai/contracts';
import { applyBodyTracking, createTrackingComposer } from '../src/tracking';
import { createSession } from '../src/session';

const RAD = Math.PI / 180;
const about = (axis: 0 | 1 | 2, degrees: number): Quat => { const q: Quat = [0, 0, 0, Math.cos(degrees * RAD / 2)]; q[axis] = Math.sin(degrees * RAD / 2); return q; };
const [qx, qy, qz] = [(d: number) => about(0, d), (d: number) => about(1, d), (d: number) => about(2, d)];
const expectSame = (a: Quat, b: Quat) => { const sign = a.reduce((sum, value, i) => sum + value * b[i]!, 0) < 0 ? -1 : 1; a.forEach((value, i) => expect(value * sign).toBeCloseTo(b[i]!, 6)); };
const bone = (rotation: Quat, extra: Partial<TrackingBone> = {}): TrackingBone => ({ rotation, space: 'normalized', ...extra });
const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const source = (id: string, kind: TrackingConfig['kind']): SceneEntity => {
 const config = defaultTrackingConfig(kind); config.enabled = true;
 return { id, kind: 'tracking', name: id, visible: true, transform, config, generation: 1, smoothing: { enabled: false, minCutoff: 5, beta: .5, derivativeCutoff: 1 } } as SceneEntity;
};
const sample = (sourceId: string, bones: Record<string, TrackingBone>, extra: Partial<TrackingSample> = {}): TrackingSample => ({ sourceId, generation: 1, receivedAtMs: 0, bones, expressions: {}, ...extra });
const without = (...parts: BodyPart[]): AvatarBodyTracking => ({ movementIntensity: 1, trackedParts: BODY_PARTS.filter(part => !parts.includes(part)) });
function stage(tracking: AvatarTracking): SceneView {
 const scene = makeSmokeScene();
 scene.entities.push(source('body', 'vmc'), source('face', 'ifacialmocap'), source('fingers', 'mediapipe'));
 const performer = scene.entities.find(entity => entity.id === 'performer')!;
 if (performer.kind !== 'avatar') throw new Error('Avatar');
 performer.tracking = tracking;
 return SceneViewSchema.parse(scene);
}
const samples = () => [
 sample('body', {
  hips: bone(qy(20), { position: [0, 0.9, 0] }), spine: bone(qx(10)), chest: bone(qz(30)), upperChest: bone(qx(-40)),
  neck: bone(qx(5)), head: bone(qy(7)),
  leftShoulder: bone(qz(3)), leftUpperArm: bone(qz(60)), leftHand: bone(qx(8)), rightUpperArm: bone(qz(-60)),
  leftIndexProximal: bone(qx(11)), rightIndexProximal: bone(qx(12)),
  leftUpperLeg: bone(qx(15)), rightFoot: bone(qx(16)),
 }, { root: { position: [1, 0, 2], rotation: qy(90) } }),
 sample('face', { head: bone(qy(25)), neck: bone(qy(4)), leftEye: bone(qx(2)) }, { expressions: { jawOpen: 0.5, eyeBlinkLeft: 1 } }),
 sample('fingers', { leftIndexProximal: bone(qz(21)), rightThumbDistal: bone(qz(22)) }),
];
const ids = { bodySourceId: 'body', faceSourceId: 'face', fingersSourceId: 'fingers' };
function pose(tracking: AvatarTracking) {
 const scene = stage(tracking), composer = createTrackingComposer();
 expect(composer.ingest({ samples: samples(), statuses: [] }, scene).ok).toBe(true);
 return composer.evaluate(scene, 0).avatarPoses.find(p => p.avatarId === 'performer')!;
}

describe('tracked body parts', () => {
 it('gives the same pose without the group and with all parts at intensity 1 (R7)', () => {
  const plain = pose(ids);
  expect(pose({ ...ids, body: { movementIntensity: 1, trackedParts: [...BODY_PARTS] } })).toEqual(plain);
  expect(Object.keys(plain.bones).sort()).toEqual(['chest', 'head', 'hips', 'leftEye', 'leftHand', 'leftIndexProximal', 'leftShoulder', 'leftUpperArm', 'leftUpperLeg', 'neck', 'rightFoot', 'rightIndexProximal', 'rightThumbDistal', 'rightUpperArm', 'spine', 'upperChest']);
  expect(plain.root).toBeDefined();
 });
 it('drops the bones of a part that is not tracked, from each source, and keeps the others (R5)', () => {
  const plain = pose(ids);
  const cases: [BodyPart, string[]][] = [
   ['head', ['neck', 'head', 'leftEye']], ['body', ['hips', 'spine', 'chest', 'upperChest']],
   ['leftArm', ['leftShoulder', 'leftUpperArm', 'leftHand']], ['rightArm', ['rightUpperArm']],
   ['leftFingers', ['leftIndexProximal']], ['rightFingers', ['rightIndexProximal', 'rightThumbDistal']],
   ['leftLeg', ['leftUpperLeg']], ['rightLeg', ['rightFoot']],
  ];
  for (const [part, dropped] of cases) {
   const result = pose({ ...ids, body: without(part) });
   const expected = Object.fromEntries(Object.entries(plain.bones).filter(([name]) => !dropped.includes(name)));
   expect(result.bones, part).toEqual(expected);
   expect(result.expressions, part).toEqual(plain.expressions);
  }
 });
 it('drops the root motion only when the body part is not tracked (R5)', () => {
  expect(pose({ ...ids, body: without('body') }).root).toBeUndefined();
  expect(pose({ ...ids, body: without('head', 'leftLeg', 'rightLeg') }).root).toEqual(pose(ids).root);
 });
 it('keeps the face expressions when no part is tracked (R5)', () => {
  const result = pose({ ...ids, body: { movementIntensity: 1, trackedParts: [] } });
  expect(result.bones).toEqual({});
  expect(result.expressions).toEqual({ jawOpen: 0.5, eyeBlinkLeft: 1 });
 });
});

describe('body movement intensity', () => {
 const all = (movementIntensity: number): AvatarBodyTracking => ({ movementIntensity, trackedParts: [...BODY_PARTS] });
 it('scales the rotations of the body part about the identity and no other bone (R6)', () => {
  const plain = pose(ids), half = pose({ ...ids, body: all(0.5) }), twice = pose({ ...ids, body: all(2) }), none = pose({ ...ids, body: all(0) });
  expectSame(half.bones.hips!.rotation, qy(10)); expectSame(half.bones.spine!.rotation, qx(5)); expectSame(half.bones.chest!.rotation, qz(15)); expectSame(half.bones.upperChest!.rotation, qx(-20));
  expectSame(twice.bones.hips!.rotation, qy(40)); expectSame(twice.bones.chest!.rotation, qz(60)); expectSame(twice.bones.upperChest!.rotation, qx(-80));
  for (const name of ['hips', 'spine', 'chest', 'upperChest']) expectSame(none.bones[name]!.rotation, [0, 0, 0, 1]);
  for (const result of [half, twice, none]) {
   for (const [name, value] of Object.entries(plain.bones)) if (!['hips', 'spine', 'chest', 'upperChest'].includes(name)) expect(result.bones[name], name).toEqual(value);
   expect(result.bones.hips!.position).toEqual([0, 0.9, 0]);
   expect(result.bones.hips!.weight).toBe(plain.bones.hips!.weight);
   expect(result.root).toEqual(plain.root);
   expect(result.expressions).toEqual(plain.expressions);
  }
 });
 it('does not copy or change the entries without a group', () => {
  const entries: [string, TrackingBone][] = [['hips', bone(qy(20))]];
  expect(applyBodyTracking(entries, undefined)).toBe(entries);
  const kept = applyBodyTracking(entries, { movementIntensity: 1, trackedParts: ['body'] });
  expect(kept[0]![1]).toBe(entries[0]![1]);
  expect(applyBodyTracking([['tail' as string, bone(qy(1))]], { movementIntensity: 2, trackedParts: [] })).toHaveLength(1);
 });
});

describe('stored form', () => {
 const patch = (revision: number, tracking: unknown) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations: [{ kind: 'setAvatarTracking', entityId: 'performer', tracking }] } as never);
 const tracking = (session: ReturnType<typeof createSession>) => { const e = session.inspect().entities.find(x => x.id === 'performer'); return e?.kind === 'avatar' ? e.tracking : undefined; };
 it('stores the parts in the fixed order and no group for the default (R4)', () => {
  const session = createSession(makeSmokeScene(), 'body-parts');
  const none = { bodySourceId: null, faceSourceId: null };
  expect(session.applyPatch(patch(0, { ...none, body: { movementIntensity: 1.5, trackedParts: ['rightLeg', 'head'] } })).ok).toBe(true);
  expect(tracking(session)).toEqual({ ...none, body: { movementIntensity: 1.5, trackedParts: ['head', 'rightLeg'] } });
  expect(session.applyPatch(patch(1, { ...none, body: { movementIntensity: 1, trackedParts: [...BODY_PARTS].reverse() } })).ok).toBe(true);
  expect(tracking(session)).toEqual(none);
  expect(session.applyPatch(patch(2, { ...none, body: { movementIntensity: 3, trackedParts: [] } }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(session.applyPatch(patch(2, { ...none, body: { movementIntensity: 1, trackedParts: ['head', 'head'] } }))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(tracking(session)).toEqual(none);
 });
});
