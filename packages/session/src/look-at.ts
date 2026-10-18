import { rotateByQuaternion, type Id, type Quat, type Reply, type SceneEntity, type SceneView, type Vec3 } from '@opensekai/contracts';
import { eulerToQuat, IDENTITY, multiplyQuat, slerpQuat, type BoneOffsets } from './bone-offsets';
import { eased, running, timing, unit, type Timing, type Transition } from './tweens';

// Runtime state only. `fade.from` is the head rotation when the effect ran, so a new target or weight turns smoothly.
// `graphId` is the graph that set the entry.
export interface LookAtEntry { readonly targetId: Id; readonly weight: number; readonly graphId: Id; readonly fade?: Timing & { readonly from: Quat } }
export type LookAtStates = ReadonlyMap<Id, LookAtEntry>;
export interface LookAtEffect { kind: 'lookAt'; entityId: Id; targetId: Id; weight: number; transition?: Transition }
// Reads one evaluated entity; Look At needs only the character and its target.
export type EntityLookup = (entityId: Id) => SceneEntity | undefined;
export const EMPTY_LOOK_AT: LookAtStates = new Map();
// The session has no skeleton: the head point is an estimate in the character frame, scaled by the character.
export const HEAD_HEIGHT = 1.4, MAX_YAW = 70, MAX_PITCH = 45;
const DEGREES = 180 / Math.PI;

export const sceneLookup = (scene: SceneView): EntityLookup => {
 const byId = new Map(scene.entities.map(entity => [entity.id, entity]));
 return entityId => byId.get(entityId);
};
const clamp = (value: number, limit: number) => Math.min(Math.max(value, -limit), limit);
const conjugate = ([x, y, z, w]: readonly number[]): Quat => [-(x ?? 0), -(y ?? 0), -(z ?? 0), w ?? 1];

// The full look rotation in the pose frame (+Y up, the character faces +Z), or null when the character or target is gone.
export function lookRotation(find: EntityLookup, avatarId: Id, targetId: Id): Quat | null {
 const avatar = find(avatarId), target = find(targetId);
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
// The head rotation of an entry at `nowMs`, from one look rotation.
const output = (entry: LookAtEntry, look: Quat, nowMs: number): Quat => {
 const live = slerpQuat(IDENTITY, look, entry.weight);
 return entry.fade && running(entry.fade, nowMs) ? slerpQuat(entry.fade.from, live, eased(entry.fade, nowMs)) : live;
};

const invalid = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const missing = (id: Id): Reply<never> => ({ ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [id] } });
// An entry that already goes to the same target and weight keeps its fade.
export function setLookAt(states: LookAtStates, find: EntityLookup, effect: LookAtEffect, startMs: number, graphId: Id): Reply<LookAtStates> {
 const avatar = find(effect.entityId);
 if (!avatar) return missing(effect.entityId);
 if (avatar.kind !== 'avatar') return invalid('Entity is not a character', [effect.entityId]);
 if (effect.targetId === effect.entityId) return invalid('Look At target is the character', [effect.entityId]);
 const target = find(effect.targetId);
 if (!target || target.kind === 'tracking') return missing(effect.targetId);
 if (!Number.isFinite(effect.weight)) return invalid('Look At weight is not finite', [effect.entityId]);
 const current = states.get(avatar.id), weight = unit(effect.weight);
 if (current && current.targetId === effect.targetId && current.weight === weight) return { ok: true, data: states };
 const look = current && lookRotation(find, avatar.id, current.targetId);
 const from = current && look ? output(current, look, startMs) : IDENTITY;
 const entry: LookAtEntry = effect.transition && effect.transition.seconds > 0
  ? { targetId: effect.targetId, weight, graphId, fade: { ...timing(effect.transition, startMs), from } }
  : { targetId: effect.targetId, weight, graphId };
 const next = new Map(states);
 if (weight === 0 && !entry.fade) next.delete(avatar.id); else next.set(avatar.id, entry);
 return { ok: true, data: next };
}

// One pass per tick: drops settled entries with weight 0 and entries whose character or target is gone, and adds each
// head rotation to the `head` offset in the parent frame of the earlier offsets (combined = lookAt × earlier).
export function stepLookAt(states: LookAtStates, find: EntityLookup, nowMs: number, offsets: BoneOffsets): { states: LookAtStates; offsets: BoneOffsets } {
 if (states.size === 0) return { states, offsets };
 const next = new Map<Id, LookAtEntry>(), combined = new Map(offsets);
 for (const [avatarId, entry] of states) {
  const look = lookRotation(find, avatarId, entry.targetId);
  if (!look) continue;
  const moving = running(entry.fade, nowMs);
  if (!moving && entry.weight === 0) continue;
  next.set(avatarId, moving || !entry.fade ? entry : { targetId: entry.targetId, weight: entry.weight, graphId: entry.graphId });
  const bones = new Map(combined.get(avatarId) ?? []);
  bones.set('head', multiplyQuat(output(entry, look, nowMs), bones.get('head') ?? IDENTITY));
  combined.set(avatarId, bones);
 }
 return { states: next, offsets: combined };
}

export const lookAtOwners = (states: LookAtStates): Id[] => [...states.values()].map(entry => entry.graphId);
export function dropGraphLookAts(states: LookAtStates, graphIds: ReadonlySet<Id>): LookAtStates {
 if (!lookAtOwners(states).some(id => graphIds.has(id))) return states;
 return new Map([...states].filter(([, entry]) => !graphIds.has(entry.graphId)));
}
