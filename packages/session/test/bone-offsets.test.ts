import { expect, it } from 'vitest';
import { makeSmokeScene, type AvatarPose, type Quat, type Vec3 } from '@opensekai/contracts';
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
