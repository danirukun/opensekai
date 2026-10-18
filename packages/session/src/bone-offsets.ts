import type { AvatarPose, Id, Quat, Reply, SceneView, Vec3 } from '@opensekai/contracts';

// Euler angles are degrees in the pose frame (right-handed, +Y up), order YXZ: rotation = Ry · Rx · Rz.
export interface BoneOffsetEffect { kind: 'offsetBone'; entityId: Id; bone: string; euler: Vec3 }
export type BoneOffsets = ReadonlyMap<Id, ReadonlyMap<string, Quat>>;
export const EMPTY_BONE_OFFSETS: BoneOffsets = new Map();
const IDENTITY: Quat = [0, 0, 0, 1];
const RADIANS = Math.PI / 180;

export function multiplyQuat(a: Quat, b: Quat): Quat {
 const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
 return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
}
const normalize = (q: Quat): Quat => { const length = Math.hypot(...q); return length > 0 ? q.map(value => value / length) as Quat : IDENTITY; };
const axis = (index: 0 | 1 | 2, degrees: number): Quat => {
 const half = degrees * RADIANS / 2, q: Quat = [0, 0, 0, Math.cos(half)];
 q[index] = Math.sin(half);
 return q;
};
export const eulerToQuat = ([x, y, z]: Vec3): Quat => normalize(multiplyQuat(multiplyQuat(axis(1, y), axis(0, x)), axis(2, z)));

export function quatToEuler(q: Quat): Vec3 {
 const [x, y, z, w] = normalize(q);
 const m13 = 2 * (x * z + w * y), m23 = 2 * (y * z - w * x), m33 = 1 - 2 * (x * x + y * y);
 const m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z), m31 = 2 * (x * z - w * y), m11 = 1 - 2 * (y * y + z * z);
 const pitch = Math.asin(Math.min(1, Math.max(-1, -m23)));
 const [yaw, roll] = Math.abs(m23) < 0.9999999 ? [Math.atan2(m13, m33), Math.atan2(m21, m22)] : [Math.atan2(-m31, m11), 0];
 // Adding 0 turns -0 into 0.
 return [pitch / RADIANS + 0, yaw / RADIANS + 0, roll / RADIANS + 0];
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
 let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
 const end = dot < 0 ? b.map(value => -value) as Quat : b;
 dot = Math.abs(dot);
 if (dot > 0.9995) return normalize(a.map((value, i) => value + (end[i]! - value) * t) as Quat);
 const angle = Math.acos(Math.min(1, dot)), sin = Math.sin(angle);
 const wa = Math.sin((1 - t) * angle) / sin, wb = Math.sin(t * angle) / sin;
 return normalize(a.map((value, i) => value * wa + end[i]! * wb) as Quat);
}

// The normalized rotation that the renderer shows for a bone, or null for a raw bone (its rest rotation is unknown here).
export function effectiveRotation(pose: AvatarPose | null, bone: string): Quat | null {
 const entry = pose && Object.hasOwn(pose.bones, bone) ? pose.bones[bone] : undefined;
 if (entry?.space === 'raw') return null;
 const base = pose?.baseBones && Object.hasOwn(pose.baseBones, bone) ? pose.baseBones[bone]!.rotation : IDENTITY;
 return entry ? slerpQuat(base, entry.rotation, entry.weight ?? 1) : base;
}
export const boneEuler = (pose: AvatarPose | null, bone: string): Vec3 => {
 const rotation = effectiveRotation(pose, bone);
 return rotation ? quatToEuler(rotation) : [0, 0, 0];
};

const invalid = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
// A later write turns the bone in the parent frame of the earlier one: combined = later × earlier.
export function writeBoneOffset(layer: BoneOffsets, scene: SceneView, effect: BoneOffsetEffect): Reply<BoneOffsets> {
 const entity = scene.entities.find(item => item.id === effect.entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Character not found', ids: [effect.entityId] } };
 if (entity.kind !== 'avatar') return invalid('Entity is not a character', [effect.entityId]);
 if (!effect.euler.every(value => Number.isFinite(value) && Math.abs(value) <= 360)) return invalid('Bone rotation must be from -360 to 360 degrees', [effect.entityId]);
 const bones = new Map(layer.get(effect.entityId) ?? []);
 bones.set(effect.bone, normalize(multiplyQuat(eulerToQuat(effect.euler), bones.get(effect.bone) ?? IDENTITY)));
 return { ok: true, data: new Map([...layer, [effect.entityId, bones]]) };
}

// Adds each non-empty layer to the frame poses; an avatar without a pose gets one with only `boneOffsets`.
export function composeBoneOffsets(poses: readonly AvatarPose[], layer: BoneOffsets): AvatarPose[] {
 const result = [...poses];
 for (const [avatarId, bones] of layer) {
  if (bones.size === 0) continue;
  const boneOffsets = Object.fromEntries(bones);
  const index = result.findIndex(pose => pose.avatarId === avatarId);
  if (index >= 0) result[index] = { ...result[index]!, boneOffsets };
  else result.push({ avatarId, bones: {}, expressions: {}, boneOffsets });
 }
 return result;
}
