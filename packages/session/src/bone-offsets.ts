import type { AvatarPose, Id, Quat, Reply, SceneEntity, SceneView, Vec3 } from '@opensekai/contracts';

// Euler angles are degrees in the pose frame (right-handed, +Y up), order YXZ: rotation = Ry · Rx · Rz.
export interface BoneOffsetEffect { kind: 'offsetBone'; entityId: Id; bone: string; euler: Vec3 }
export interface BoneTranslationEffect { kind: 'offsetBoneTranslation'; entityId: Id; bone: string; translation: Vec3 }
export interface BoneScaleEffect { kind: 'offsetBoneScale'; entityId: Id; bone: string; scale: number }
export type BoneLayerEffect = BoneOffsetEffect | BoneTranslationEffect | BoneScaleEffect;
// One bone's write layer: a rotation (as a quaternion), an added translation, and an assigned absolute scale.
export interface BoneLayerEntry { rotation: Quat; translation: Vec3; scale: number }
export type BoneOffsets = ReadonlyMap<Id, ReadonlyMap<string, BoneLayerEntry>>;
export const EMPTY_BONE_OFFSETS: BoneOffsets = new Map();
export const IDENTITY: Quat = [0, 0, 0, 1];
// The untouched layer entry. Its `rotation` is the `IDENTITY` object itself, so `composeBoneOffsets` can tell an
// untouched rotation (same object) from a rotation explicitly written to identity (a new, equal-by-value object).
export const DEFAULT_BONE_ENTRY: BoneLayerEntry = { rotation: IDENTITY, translation: [0, 0, 0], scale: 1 };
const RADIANS = Math.PI / 180;

export function multiplyQuat(a: Quat, b: Quat): Quat {
 const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
 return [ax * bw + aw * bx + ay * bz - az * by, ay * bw + aw * by + az * bx - ax * bz, az * bw + aw * bz + ax * by - ay * bx, aw * bw - ax * bx - ay * by - az * bz];
}
export const normalize = (q: Quat): Quat => { const length = Math.hypot(...q); return length > 0 ? q.map(value => value / length) as Quat : IDENTITY; };
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
// The character every bone-layer writer targets, shared by `writeBoneOffset`, `writeBoneTranslation`, and `writeBoneScale`.
function findCharacter(scene: SceneView, entityId: Id): Reply<SceneEntity> {
 const entity = scene.entities.find(item => item.id === entityId);
 if (!entity) return { ok: false, error: { code: 'NOT_FOUND', message: 'Character not found', ids: [entityId] } };
 if (entity.kind !== 'avatar') return invalid('Entity is not a character', [entityId]);
 return { ok: true, data: entity };
}
const entryMap = (layer: BoneOffsets, entityId: Id): Map<string, BoneLayerEntry> => new Map(layer.get(entityId) ?? []);
const withEntity = (layer: BoneOffsets, entityId: Id, bones: Map<string, BoneLayerEntry>): BoneOffsets => new Map([...layer, [entityId, bones]]);

// A later write turns the bone in the parent frame of the earlier one: combined = later × earlier.
export function writeBoneOffset(layer: BoneOffsets, scene: SceneView, effect: BoneOffsetEffect): Reply<BoneOffsets> {
 const character = findCharacter(scene, effect.entityId);
 if (!character.ok) return character;
 if (!effect.euler.every(value => Number.isFinite(value) && Math.abs(value) <= 360)) return invalid('Bone rotation must be from -360 to 360 degrees', [effect.entityId]);
 const bones = entryMap(layer, effect.entityId);
 const entry = bones.get(effect.bone) ?? DEFAULT_BONE_ENTRY;
 bones.set(effect.bone, { ...entry, rotation: normalize(multiplyQuat(eulerToQuat(effect.euler), entry.rotation)) });
 return { ok: true, data: withEntity(layer, effect.entityId, bones) };
}

// Adds the translation component-wise. A component must be finite and at most 2 m from the rest pose.
export function writeBoneTranslation(layer: BoneOffsets, scene: SceneView, effect: BoneTranslationEffect): Reply<BoneOffsets> {
 const character = findCharacter(scene, effect.entityId);
 if (!character.ok) return character;
 if (!effect.translation.every(value => Number.isFinite(value) && Math.abs(value) <= 2)) return invalid('Bone translation must be finite and at most 2 m on each axis', [effect.entityId]);
 const bones = entryMap(layer, effect.entityId);
 const entry = bones.get(effect.bone) ?? DEFAULT_BONE_ENTRY;
 bones.set(effect.bone, { ...entry, translation: entry.translation.map((value, index) => value + effect.translation[index]!) as Vec3 });
 return { ok: true, data: withEntity(layer, effect.entityId, bones) };
}

// Assigns the evaluator's absolute scale (it already carries the 1 + weight·(value·intensity+offset) result): a
// later write to the same bone in one tick replaces an earlier one. The pose schema accepts only 0.5 to 1.5.
export function writeBoneScale(layer: BoneOffsets, scene: SceneView, effect: BoneScaleEffect): Reply<BoneOffsets> {
 const character = findCharacter(scene, effect.entityId);
 if (!character.ok) return character;
 if (!(effect.scale >= 0.5 && effect.scale <= 1.5)) return invalid('Bone scale must be from 0.5 to 1.5', [effect.entityId]);
 const bones = entryMap(layer, effect.entityId);
 const entry = bones.get(effect.bone) ?? DEFAULT_BONE_ENTRY;
 bones.set(effect.bone, { ...entry, scale: effect.scale });
 return { ok: true, data: withEntity(layer, effect.entityId, bones) };
}

const isZeroVec = (v: Vec3): boolean => v.every(value => value === 0);
// Adds each non-default field to the frame poses; an avatar without a pose gets one with only the layer fields. A
// bone touched only by translation or scale keeps `rotation` as the shared `IDENTITY` object, so it never enters
// `boneOffsets` (checked by identity, not value: an explicit write to identity stays, as it is a distinct object).
export function composeBoneOffsets(poses: readonly AvatarPose[], layer: BoneOffsets): AvatarPose[] {
 const result = [...poses];
 for (const [avatarId, bones] of layer) {
  if (bones.size === 0) continue;
  const entries = [...bones];
  const boneOffsets = Object.fromEntries(entries.filter(([, entry]) => entry.rotation !== IDENTITY).map(([bone, entry]) => [bone, entry.rotation]));
  const boneTranslations = Object.fromEntries(entries.filter(([, entry]) => !isZeroVec(entry.translation)).map(([bone, entry]) => [bone, entry.translation]));
  const boneScales = Object.fromEntries(entries.filter(([, entry]) => entry.scale !== 1).map(([bone, entry]) => [bone, entry.scale]));
  const extra = {
   ...(Object.keys(boneOffsets).length ? { boneOffsets } : {}),
   ...(Object.keys(boneTranslations).length ? { boneTranslations } : {}),
   ...(Object.keys(boneScales).length ? { boneScales } : {}),
  };
  if (Object.keys(extra).length === 0) continue;
  const index = result.findIndex(pose => pose.avatarId === avatarId);
  if (index >= 0) result[index] = { ...result[index]!, ...extra };
  else result.push({ avatarId, bones: {}, expressions: {}, ...extra });
 }
 return result;
}
