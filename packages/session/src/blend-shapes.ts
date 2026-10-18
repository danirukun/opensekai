import { blendShapeNames, type AvatarPose, type Id, type Reply, type SceneView } from '@opensekai/contracts';
import type { RecordLookup } from './expressions';
import { eased, lerp, progress, timing, unit, type Timing, type Transition } from './tweens';

// Runtime state only, like expressions: never committed, saved, or counted in the scene revision.
export interface BlendShapeEntry { readonly weight: number; readonly fade?: Timing & { readonly from: number; readonly to: number } }
export interface AvatarBlendShapes { readonly assetId: Id; readonly entries: ReadonlyMap<string, BlendShapeEntry> }
export type BlendShapeStates = ReadonlyMap<Id, AvatarBlendShapes>;
export interface BlendShapeEffect { kind: 'setBlendShape'; entityId: Id; blendShape: string; weight: number; transition?: Transition }
export const EMPTY_BLEND_SHAPES: BlendShapeStates = new Map();
export const MAX_BLEND_SHAPES = 64;
const POSE_EXPRESSION_LIMIT = 64;

const invalid = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });

export function setBlendShape(states: BlendShapeStates, scene: SceneView, records: RecordLookup, effect: BlendShapeEffect, nowMs: number): Reply<BlendShapeStates> {
 const avatar = scene.entities.find(item => item.id === effect.entityId);
 if (!avatar) return { ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: [effect.entityId] } };
 if (avatar.kind !== 'avatar') return invalid('Entity is not an avatar', [effect.entityId]);
 const record = avatar.assetId === null ? undefined : records(avatar.assetId);
 if (!record || !blendShapeNames(record).includes(effect.blendShape)) return invalid('BlendShape not found', [effect.entityId, effect.blendShape]);
 if (!Number.isFinite(effect.weight)) return invalid('BlendShape weight is not finite', [effect.entityId]);
 const own = states.get(avatar.id);
 const entries = new Map(own?.assetId === record.id ? own.entries : []);
 const current = entries.get(effect.blendShape);
 if (!current && entries.size >= MAX_BLEND_SHAPES) return invalid('BlendShape limit reached', [effect.entityId]);
 const weight = unit(effect.weight), from = current?.weight ?? 0;
 const entry: BlendShapeEntry = effect.transition && effect.transition.seconds > 0 ? { weight: from, fade: { ...timing(effect.transition, nowMs), from, to: weight } } : { weight };
 if (entry.weight === 0 && !entry.fade) entries.delete(effect.blendShape); else entries.set(effect.blendShape, entry);
 const next = new Map(states);
 if (entries.size) next.set(avatar.id, { assetId: record.id, entries }); else next.delete(avatar.id);
 return { ok: true, data: next };
}

// Samples each fade at `nowMs`. A model change or removal clears the character; a settled zero weight leaves.
export function advanceBlendShapes(states: BlendShapeStates, scene: SceneView, nowMs: number): BlendShapeStates {
 if (states.size === 0) return states;
 const next = new Map<Id, AvatarBlendShapes>();
 for (const [avatarId, state] of states) {
  const avatar = scene.entities.find(entity => entity.id === avatarId);
  if (avatar?.kind !== 'avatar' || avatar.assetId !== state.assetId) continue;
  const entries = new Map<string, BlendShapeEntry>();
  for (const [name, entry] of state.entries) {
   if (!entry.fade) { entries.set(name, entry); continue; }
   const weight = unit(lerp(entry.fade.from, entry.fade.to, eased(entry.fade, nowMs)));
   if (progress(entry.fade, nowMs) < 1) entries.set(name, { ...entry, weight });
   else if (entry.fade.to > 0) entries.set(name, { weight: entry.fade.to });
  }
  if (entries.size) next.set(avatarId, { assetId: state.assetId, entries });
 }
 return next;
}

// Merges each weight above 0 into the pose expressions with `max`, after the expressions. A character without a pose gets one.
export function composeBlendShapes(poses: readonly AvatarPose[], states: BlendShapeStates): AvatarPose[] {
 const result = [...poses];
 for (const [avatarId, state] of states) {
  const weighted = [...state.entries].filter(([, entry]) => entry.weight > 0);
  if (!weighted.length) continue;
  const index = result.findIndex(pose => pose.avatarId === avatarId);
  const base: AvatarPose = index >= 0 ? result[index]! : { avatarId, bones: {}, expressions: {} };
  // A Map, not property writes: a name can be `__proto__`.
  const merged = new Map(Object.entries(base.expressions));
  for (const [name, entry] of weighted) {
   if (!merged.has(name) && merged.size >= POSE_EXPRESSION_LIMIT) continue;
   merged.set(name, Math.max(merged.get(name) ?? 0, entry.weight));
  }
  const pose = { ...base, expressions: Object.fromEntries(merged) };
  if (index >= 0) result[index] = pose; else result.push(pose);
 }
 return result;
}
