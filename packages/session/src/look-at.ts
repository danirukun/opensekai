import { rotateByQuaternion, type Id, type Quat, type Reply, type SceneView, type Vec3 } from '@opensekai/contracts';
import { eulerToQuat, multiplyQuat, slerpQuat, type BoneOffsets } from './bone-offsets';
import { eased, progress, timing, unit, type Timing, type Transition } from './tweens';

// Runtime state only. `fade.from` is the head rotation when the effect ran, so a new target or weight turns smoothly.
export interface LookAtEntry { readonly targetId: Id; readonly weight: number; readonly fade?: Timing & { readonly from: Quat } }
export type LookAtStates = ReadonlyMap<Id, LookAtEntry>;
export interface LookAtEffect { kind: 'lookAt'; entityId: Id; targetId: Id; weight: number; transition?: Transition }
export const EMPTY_LOOK_AT: LookAtStates = new Map();
// The session has no skeleton: the head point is an estimate in the character frame, scaled by the character.
export const HEAD_HEIGHT = 1.4, MAX_YAW = 70, MAX_PITCH = 45;
const IDENTITY: Quat = [0, 0, 0, 1];
const DEGREES = 180 / Math.PI;

const clamp = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit);
const conjugate = ([x, y, z, w]: readonly number[]): Quat => [-(x ?? 0), -(y ?? 0), -(z ?? 0), w ?? 1];

// The full look rotation in the pose frame (+Y up, the character faces +Z), or null when the character or target is gone.
export function lookRotation(scene: SceneView, avatarId: Id, targetId: Id): Quat | null {
 const avatar = scene.entities.find(item => item.id === avatarId), target = scene.entities.find(item => item.id === targetId);
 if (avatar?.kind !== 'avatar' || !target || target.kind === 'tracking') return null;
 const { position, rotation, scale } = avatar.transform;
 const lift = rotateByQuaternion([0, HEAD_HEIGHT * scale[1], 0], rotation);
 const head: Vec3 = [position[0] + lift[0], position[1] + lift[1], position[2] + lift[2]];
 const world: Vec3 = [target.transform.position[0] - head[0], target.transform.position[1] - head[1], target.transform.position[2] - head[2]];
 const [x, y, z] = rotateByQuaternion(world, conjugate(rotation));
 if (Math.hypot(x, y, z) < 1e-6) return IDENTITY;
 const yaw = clamp(Math.atan2(x, z) * DEGREES, MAX_YAW), pitch = clamp(-Math.atan2(y, Math.hypot(x, z)) * DEGREES, MAX_PITCH);
 return eulerToQuat([pitch, yaw, 0]);
}
const goal = (scene: SceneView, avatarId: Id, entry: LookAtEntry): Quat | null => {
 const look = lookRotation(scene, avatarId, entry.targetId);
 return look && slerpQuat(IDENTITY, look, entry.weight);
};
// The head rotation that the entry gives at `nowMs`.
export function lookOutput(scene: SceneView, avatarId: Id, entry: LookAtEntry, nowMs: number): Quat | null {
 const live = goal(scene, avatarId, entry);
 if (!live || !entry.fade || progress(entry.fade, nowMs) >= 1) return live;
 return slerpQuat(entry.fade.from, live, eased(entry.fade, nowMs));
}

const invalid = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const missing = (id: Id): Reply<never> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [id] } });
export function setLookAt(states: LookAtStates, scene: SceneView, effect: LookAtEffect, nowMs: number): Reply<LookAtStates> {
 const avatar = scene.entities.find(item => item.id === effect.entityId);
 if (!avatar) return missing(effect.entityId);
 if (avatar.kind !== 'avatar') return invalid('Entity is not a character', [effect.entityId]);
 if (effect.targetId === effect.entityId) return invalid('Look At target is the character', [effect.entityId]);
 const target = scene.entities.find(item => item.id === effect.targetId);
 if (!target || target.kind === 'tracking') return missing(effect.targetId);
 if (!Number.isFinite(effect.weight)) return invalid('Look At weight is not finite', [effect.entityId]);
 const current = states.get(avatar.id), weight = unit(effect.weight);
 const from = current ? lookOutput(scene, avatar.id, current, nowMs) ?? IDENTITY : IDENTITY;
 const entry: LookAtEntry = effect.transition && effect.transition.seconds > 0 ? { targetId: effect.targetId, weight, fade: { ...timing(effect.transition, nowMs), from } } : { targetId: effect.targetId, weight };
 const next = new Map(states);
 if (weight === 0 && !entry.fade) next.delete(avatar.id); else next.set(avatar.id, entry);
 return { ok: true, data: next };
}

// Drops settled entries with weight 0 and entries whose character or target is gone.
export function advanceLookAt(states: LookAtStates, scene: SceneView, nowMs: number): LookAtStates {
 if (states.size === 0) return states;
 const next = new Map<Id, LookAtEntry>();
 for (const [avatarId, entry] of states) {
  if (!lookRotation(scene, avatarId, entry.targetId)) continue;
  const settled = !entry.fade || progress(entry.fade, nowMs) >= 1;
  if (settled && entry.weight === 0) continue;
  next.set(avatarId, settled && entry.fade ? { targetId: entry.targetId, weight: entry.weight } : entry);
 }
 return next;
}

// Adds each look-at rotation to the `head` offset, in the parent frame of the earlier offsets: combined = lookAt × earlier.
export function composeLookAt(offsets: BoneOffsets, states: LookAtStates, scene: SceneView, nowMs: number): BoneOffsets {
 if (states.size === 0) return offsets;
 const next = new Map(offsets);
 for (const [avatarId, entry] of states) {
  const look = lookOutput(scene, avatarId, entry, nowMs);
  if (!look) continue;
  const bones = new Map(next.get(avatarId) ?? []);
  bones.set('head', multiplyQuat(look, bones.get('head') ?? IDENTITY));
  next.set(avatarId, bones);
 }
 return next;
}
