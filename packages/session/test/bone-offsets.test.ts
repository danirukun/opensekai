import { describe, expect, it } from 'vitest';
import { makeSmokeScene, type AvatarPose, type AvatarTracking, type BlueprintNodeOf, type Quat, type SceneEntity, type SceneView, type Vec3 } from '@opensekai/contracts';
import type { BlueprintEffect } from '../src/blueprint';
import { EVALUATORS, NO_ENV, type FlowContext } from '../src/blueprint-eval';
import { createSession } from '../src/session';
import { offsetBonesSkipped } from '../src/blueprint-eval/character';
import { boneEuler, composeBoneOffsets, EMPTY_BONE_OFFSETS, eulerToQuat, multiplyQuat, quatToEuler, writeBoneOffset } from '../src/bone-offsets';

const yawQuat = (degrees: number): Quat => [0, Math.sin(degrees * Math.PI / 360), 0, Math.cos(degrees * Math.PI / 360)];
const rotate = (q: Quat, v: Vec3): Vec3 => { const r = multiplyQuat(multiplyQuat(q, [...v, 0] as Quat), [-q[0], -q[1], -q[2], q[3]]); return [r[0], r[1], r[2]]; };
const close = (actual: Vec3, expected: Vec3) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
const pose = (extra: Partial<AvatarPose>): AvatarPose => ({ avatarId: 'performer', bones: {}, expressions: {}, ...extra });

it('converts YXZ Euler degrees to a quaternion and back', () => {
 close(quatToEuler(eulerToQuat([10, 20, 30])), [10, 20, 30]);
 close(quatToEuler(eulerToQuat([-45, 170, -5])), [-45, 170, -5]);
 // YXZ: the yaw turns the pitched axis, so Ry·Rx applied to +Z differs from Rx·Ry.
 const q = eulerToQuat([30, 90, 0]);
 close(rotate(q, [0, 0, 1]), [Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6), 0]);
 close(quatToEuler([0, 0, 0, 1]), [0, 0, 0]);
});

it('gives a positive yaw for a head turned to the character left (+X when facing +Z)', () => {
 const left = yawQuat(20);
 expect(rotate(left, [0, 0, 1])[0]).toBeGreaterThan(0);
 expect(quatToEuler(left)[1]).toBeCloseTo(20, 6);
});

it('reads the effective normalized rotation: slerp of base and entry by weight, base, identity, and zero for raw bones', () => {
 expect(boneEuler(null, 'head')).toEqual([0, 0, 0]);
 expect(boneEuler(pose({}), 'head')).toEqual([0, 0, 0]);
 close(boneEuler(pose({ baseBones: { head: { rotation: yawQuat(10), space: 'normalized' } } }), 'head'), [0, 10, 0]);
 close(boneEuler(pose({ baseBones: { head: { rotation: yawQuat(10), space: 'normalized' } }, bones: { head: { rotation: yawQuat(30), space: 'normalized', weight: 0.5 } } }), 'head'), [0, 20, 0]);
 close(boneEuler(pose({ bones: { head: { rotation: yawQuat(30), space: 'normalized' } } }), 'head'), [0, 30, 0]);
 expect(boneEuler(pose({ baseBones: { head: { rotation: yawQuat(10), space: 'normalized' } }, bones: { head: { rotation: yawQuat(30), space: 'raw' } } }), 'head')).toEqual([0, 0, 0]);
});

it('composes two writes to one bone in write order, the later in the parent frame of the earlier', () => {
 const scene = makeSmokeScene();
 const first = writeBoneOffset(EMPTY_BONE_OFFSETS, scene, { kind: 'offsetBone', entityId: 'performer', bone: 'chest', euler: [30, 0, 0] });
 const second = first.ok ? writeBoneOffset(first.data, scene, { kind: 'offsetBone', entityId: 'performer', bone: 'chest', euler: [0, 90, 0] }) : first;
 if (!second.ok) throw new Error(second.error.message);
 const combined = second.data.get('performer')!.get('chest')!;
 const expected = multiplyQuat(eulerToQuat([0, 90, 0]), eulerToQuat([30, 0, 0]));
 combined.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
 expect(EMPTY_BONE_OFFSETS.size).toBe(0);
 expect(first.ok && first.data.get('performer')!.get('chest')).toEqual(eulerToQuat([30, 0, 0]));
});

it('rejects a non-finite or out-of-range angle and a target that is not a character', () => {
 const scene = makeSmokeScene();
 for (const euler of [[0, 360.5, 0], [-361, 0, 0], [0, 0, Number.NaN], [Number.POSITIVE_INFINITY, 0, 0]] as Vec3[])
  expect(writeBoneOffset(EMPTY_BONE_OFFSETS, scene, { kind: 'offsetBone', entityId: 'performer', bone: 'chest', euler })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(writeBoneOffset(EMPTY_BONE_OFFSETS, scene, { kind: 'offsetBone', entityId: 'performer', bone: 'chest', euler: [360, -360, 0] }).ok).toBe(true);
 expect(writeBoneOffset(EMPTY_BONE_OFFSETS, scene, { kind: 'offsetBone', entityId: 'marker', bone: 'chest', euler: [0, 0, 0] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(writeBoneOffset(EMPTY_BONE_OFFSETS, scene, { kind: 'offsetBone', entityId: 'nobody', bone: 'chest', euler: [0, 0, 0] })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('adds offsets to an existing pose or a pose with only boneOffsets, and skips empty layers', () => {
 const layer = new Map([['performer', new Map([['chest', yawQuat(12)]])], ['other', new Map()]]);
 const tracked = pose({ bones: { head: { rotation: yawQuat(20), space: 'normalized' } } });
 expect(composeBoneOffsets([tracked], layer)).toEqual([{ ...tracked, boneOffsets: { chest: yawQuat(12) } }]);
 expect(composeBoneOffsets([], layer)).toEqual([{ avatarId: 'performer', bones: {}, expressions: {}, boneOffsets: { chest: yawQuat(12) } }]);
 expect(tracked).not.toHaveProperty('boneOffsets');
});

describe('Offset Bones', () => {
 const base = makeSmokeScene();
 const sceneWith = (tracking?: AvatarTracking): SceneView => ({ ...base, entities: base.entities.map(entity => entity.kind === 'avatar' && entity.id === 'performer' ? { ...entity, tracking } : entity) });
 const settings = (over: Partial<BlueprintNodeOf<'character.offsetBones'>['settings']> = {}) => ({ entityId: 'performer', bones: ['leftUpperArm', 'rightUpperArm'], axis: 'z' as const, intensity: 2, offset: 5, ...over });
 const run = (scene: SceneView, over: Partial<BlueprintNodeOf<'character.offsetBones'>['settings']> = {}, inputs: Record<string, number> = { value: 3, weight: 0.5 }) => {
  const emitted: BlueprintEffect[] = [];
  const context = { port: 'flow', read: (port: string) => inputs[port] ?? 0, follow: () => {}, emit: (effect: BlueprintEffect) => { emitted.push(effect); }, emitEach: (effects: BlueprintEffect[]) => { emitted.push(...effects); }, env: { ...NO_ENV, scene: () => scene } } as unknown as FlowContext;
  const node = { id: 'n', version: 1, position: { x: 0, y: 0 }, type: 'character.offsetBones', settings: settings(over) } as BlueprintNodeOf<'character.offsetBones'>;
  (EVALUATORS['character.offsetBones'] as unknown as { flow: (n: unknown, c: FlowContext) => void }).flow(node, context);
  return emitted;
 };
 const body = (extra: Partial<AvatarTracking> = {}): AvatarTracking => ({ bodySourceId: 'body', faceSourceId: 'face', ...extra });

 it('emits one offset for each bone with the angle on the axis', () => {
  expect(run(sceneWith())).toEqual([
   { kind: 'offsetBone', entityId: 'performer', bone: 'leftUpperArm', euler: [0, 0, 5.5] },
   { kind: 'offsetBone', entityId: 'performer', bone: 'rightUpperArm', euler: [0, 0, 5.5] },
  ]);
  expect(run(sceneWith(), { axis: 'x', bones: ['spine'] })).toEqual([{ kind: 'offsetBone', entityId: 'performer', bone: 'spine', euler: [5.5, 0, 0] }]);
 });

 it('clamps the angle to 360 degrees', () => {
  expect(run(sceneWith(), { bones: ['spine'], intensity: 360, offset: 0 }, { value: 1000, weight: 1 })[0]).toMatchObject({ euler: [0, 0, 360] });
  expect(run(sceneWith(), { bones: ['spine'], intensity: 360, offset: 0 }, { value: -1000, weight: 1 })[0]).toMatchObject({ euler: [0, 0, -360] });
 });

 it('skips every body bone for a body source without a body group', () => {
  expect(run(sceneWith(body()))).toEqual([]);
  expect(run(sceneWith(body()), { bones: ['spine', 'head', 'leftUpperLeg'] })).toEqual([]);
 });

 it('skips only the tracked parts', () => {
  const scene = sceneWith(body({ body: { movementIntensity: 1, trackedParts: ['head'] } }));
  expect(run(scene, { bones: ['head', 'neck', 'leftUpperArm'] }).map(effect => (effect as { bone: string }).bone)).toEqual(['leftUpperArm']);
 });

 it('skips the finger bones for a body source or a fingers source', () => {
  const fingers = ['leftIndexProximal', 'rightThumbDistal', 'leftUpperArm'];
  expect(run(sceneWith(body({ body: { movementIntensity: 1, trackedParts: ['head'] } })), { bones: fingers }).map(effect => (effect as { bone: string }).bone)).toEqual(['leftUpperArm']);
  expect(run(sceneWith({ bodySourceId: null, faceSourceId: 'face', fingersSourceId: 'hands' }), { bones: fingers }).map(effect => (effect as { bone: string }).bone)).toEqual(['leftUpperArm']);
 });

 it('skips nothing for a face source only, or without a tracking assignment', () => {
  expect(run(sceneWith({ bodySourceId: null, faceSourceId: 'face' }))).toHaveLength(2);
  expect(run(sceneWith(undefined), { bones: ['head', 'leftIndexProximal'] })).toHaveLength(2);
 });

 it('reports the skip for one bone', () => {
  const scene = sceneWith(body({ body: { movementIntensity: 1, trackedParts: ['leftArm'] } }));
  expect(offsetBonesSkipped(scene, 'performer', 'leftHand')).toBe(true);
  expect(offsetBonesSkipped(scene, 'performer', 'rightHand')).toBe(false);
  expect(offsetBonesSkipped(scene, 'performer', 'leftEye')).toBe(false);
  expect(offsetBonesSkipped(scene, 'performer', 'leftIndexProximal')).toBe(true);
  expect(offsetBonesSkipped(sceneWith(), 'performer', 'leftIndexProximal')).toBe(false);
 });

 it('throws when the character is not in the scene', () => {
  expect(() => run({ ...base, entities: [] })).toThrow('Character is unavailable');
 });
});

describe('Offset Bones in a graph', () => {
 const source = (id: string) => ({ id, name: id, visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'tracking', generation: 0, config: { kind: 'vmc', enabled: true, bindAddress: '0.0.0.0', port: 39539, senderAddress: null }, smoothing: { enabled: false, minCutoff: 5, beta: 0.5, derivativeCutoff: 1 } } as SceneEntity);
 const at = { x: 0, y: 0 };
 const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: at });
 const wire = (id: string, from: string, fromPort: string, to: string, toPort: string) => ({ id, sourceNodeId: from, sourcePort: fromPort, targetNodeId: to, targetPort: toPort });
 const offsets = (bones: string[], tracking?: AvatarTracking) => {
  const scene = makeSmokeScene();
  scene.entities = [...scene.entities.map(entity => entity.kind === 'avatar' && entity.id === 'performer' ? { ...entity, tracking } : entity), ...(tracking ? [source('body')] : [])];
  const s = createSession(scene, 's');
  const graph = { schemaVersion: 1, id: 'g', name: 'g', enabled: true, variables: [],
   nodes: [node('start', 'event.update'), node('ten', 'value.number', { value: 10 }), node('first', 'character.offsetBones', { entityId: 'performer', bones, axis: 'y', intensity: 1, offset: 0 }), node('second', 'character.offsetBones', { entityId: 'performer', bones: ['leftUpperArm'], axis: 'y', intensity: 1, offset: 0 })],
   connections: [wire('w1', 'start', 'flow', 'first', 'flow'), wire('w2', 'first', 'exit', 'second', 'flow'), wire('w3', 'ten', 'value', 'first', 'value'), wire('w4', 'ten', 'value', 'second', 'value')] };
  const reply = s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs: [graph] }] });
  if (!reply.ok) throw new Error(reply.error.message);
  const pose = s.advance(16).avatarPoses?.find(item => item.avatarId === 'performer');
  return { errors: s.inspectBlueprints().errors, offsets: pose?.boneOffsets };
 };

 it('writes each bone once and runs the next node once', () => {
  const result = offsets(['spine', 'chest']);
  expect(result.errors).toEqual([]);
  expect(Object.keys(result.offsets ?? {}).sort()).toEqual(['chest', 'leftUpperArm', 'spine']);
  expect(quatToEuler(result.offsets!.leftUpperArm!)[1]).toBeCloseTo(10, 4);
 });

 it('continues at the exit when every bone is skipped', () => {
  const result = offsets(['spine', 'chest'], { bodySourceId: 'body', faceSourceId: null, body: { movementIntensity: 1, trackedParts: ['body'] } });
  expect(result.errors).toEqual([]);
  expect(Object.keys(result.offsets ?? {})).toEqual(['leftUpperArm']);
 });
});
