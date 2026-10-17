import { effectiveExpressionSettings, trackingGroup, type AssetRecord, type AvatarPose, type ErrorCode, type ExpressionSettings, type ExpressionState, type Id, type Reply, type SceneEntity, type SceneView, type SuppressGroup } from '@opensekai/contracts';

// Runtime state only: it never changes the scene revision and never goes into a show.
export interface ExpressionEntry { readonly target: 0 | 1; readonly weight: number }
// `assetId` is the model that the entries belong to. A different model clears them.
export interface AvatarExpressions { readonly assetId: Id; readonly entries: ReadonlyMap<string, ExpressionEntry> }
export type ExpressionStates = ReadonlyMap<Id, AvatarExpressions>;
export type RecordLookup = (assetId: Id) => AssetRecord | undefined;
export type ExpressionEffect = { kind: 'setExpression'; entityId: Id; expression: string; active: boolean } | { kind: 'toggleExpression'; entityId: Id; expression: string };
export const EMPTY_EXPRESSIONS: ExpressionStates = new Map();
const POSE_EXPRESSION_LIMIT = 64;

const failure = (code: ErrorCode, message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code, message, ids } });
type Avatar = Extract<SceneEntity, { kind: 'avatar' }>;

function findAvatar(scene: SceneView, avatarId: Id): Reply<Avatar> {
 const entity = scene.entities.find(item => item.id === avatarId);
 if (!entity) return failure('NOT_FOUND', 'Entity not found', [avatarId]);
 if (entity.kind !== 'avatar') return failure('INVALID_INPUT', 'Entity is not an avatar', [avatarId]);
 return { ok: true, data: entity };
}
const settingsOf = (avatar: Avatar, records: RecordLookup) => {
 const record = avatar.assetId === null ? undefined : records(avatar.assetId);
 return record ? effectiveExpressionSettings(record, avatar.expressions) : [];
};
const live = (states: ExpressionStates, avatar: Avatar) => {
 const state = states.get(avatar.id);
 return state && state.assetId === avatar.assetId ? state.entries : undefined;
};

// Drops the state of removed avatars and of avatars whose model changed.
export function reconcileExpressions(states: ExpressionStates, scene: SceneView): ExpressionStates {
 let next: Map<Id, AvatarExpressions> | null = null;
 for (const [avatarId, state] of states) {
  const avatar = scene.entities.find(entity => entity.id === avatarId);
  if (avatar?.kind === 'avatar' && avatar.assetId === state.assetId) continue;
  next ??= new Map(states);
  next.delete(avatarId);
 }
 return next ?? states;
}

export function expressionView(states: ExpressionStates, scene: SceneView, records: RecordLookup, avatarId: Id): Reply<ExpressionState> {
 const avatar = findAvatar(scene, avatarId);
 if (!avatar.ok) return avatar;
 const entries = live(states, avatar.data);
 const expressions = settingsOf(avatar.data, records).map(item => {
  const entry = entries?.get(item.name);
  return { ...item, active: entry?.target === 1, weight: entry?.weight ?? 0 };
 });
 return { ok: true, data: { avatarId, expressions } };
}

// Sets the target of one expression. Activation clears the other expressions on its layer.
export function setExpression(states: ExpressionStates, scene: SceneView, records: RecordLookup, effect: ExpressionEffect): Reply<ExpressionStates> {
 const avatar = findAvatar(scene, effect.entityId);
 if (!avatar.ok) return avatar;
 const settings = settingsOf(avatar.data, records);
 const chosen = settings.find(item => item.name === effect.expression);
 if (!chosen || avatar.data.assetId === null) return failure('INVALID_INPUT', 'Expression not found', [effect.entityId, effect.expression]);
 const entries = new Map(live(states, avatar.data) ?? []);
 const current = entries.get(chosen.name);
 const active = effect.kind === 'toggleExpression' ? current?.target !== 1 : effect.active;
 entries.set(chosen.name, { target: active ? 1 : 0, weight: current?.weight ?? 0 });
 if (active)
  for (const other of settings)
   if (other.name !== chosen.name && other.layer === chosen.layer && entries.has(other.name)) entries.set(other.name, { ...entries.get(other.name)!, target: 0 });
 const next = new Map(states);
 next.set(avatar.data.id, { assetId: avatar.data.assetId, entries });
 return { ok: true, data: next };
}

// Moves each weight toward its target by `elapsedSeconds / fadeSeconds`. Settled inactive entries leave the state.
export function advanceExpressions(states: ExpressionStates, scene: SceneView, records: RecordLookup, elapsedSeconds: number): ExpressionStates {
 const next = new Map<Id, AvatarExpressions>();
 for (const [avatarId, state] of reconcileExpressions(states, scene)) {
  const avatar = scene.entities.find(entity => entity.id === avatarId) as Avatar;
  const fades = new Map(settingsOf(avatar, records).map(item => [item.name, item.fadeSeconds]));
  const entries = new Map<string, ExpressionEntry>();
  for (const [name, entry] of state.entries) {
   const fade = fades.get(name) ?? 0;
   const step = fade === 0 ? 1 : elapsedSeconds / fade;
   const weight = entry.target === 1 ? Math.min(1, entry.weight + step) : Math.max(0, entry.weight - step);
   if (entry.target === 1 || weight > 0) entries.set(name, { target: entry.target, weight });
  }
  if (entries.size) next.set(avatarId, { assetId: state.assetId, entries });
 }
 return next;
}

// Suppresses the tracking groups of active expressions, then merges expression weights with `max`.
export function composeExpressions(poses: readonly AvatarPose[], states: ExpressionStates, scene: SceneView, records: RecordLookup): AvatarPose[] {
 const result = [...poses];
 for (const entity of scene.entities) {
  if (entity.kind !== 'avatar') continue;
  const entries = live(states, entity);
  if (!entries) continue;
  const weighted = settingsOf(entity, records).flatMap(item => {
   const weight = entries.get(item.name)?.weight ?? 0;
   return weight > 0 ? [{ name: item.name, weight, suppress: item.suppress as ExpressionSettings['suppress'] }] : [];
  });
  if (!weighted.length) continue;
  const index = result.findIndex(pose => pose.avatarId === entity.id);
  const base: AvatarPose = index >= 0 ? result[index]! : { avatarId: entity.id, bones: {}, expressions: {} };
  const strength = (group: SuppressGroup) => Math.max(0, ...weighted.filter(item => item.suppress[group]).map(item => item.weight));
  const scale = { blink: 1 - strength('blink'), mouth: 1 - strength('mouth'), brow: 1 - strength('brow') };
  // A Map, not property writes: a model can name an expression `__proto__`.
  const merged = new Map(Object.entries(base.expressions).map(([name, value]) => {
   const group = trackingGroup(name);
   return [name, group ? value * scale[group] : value] as const;
  }));
  for (const item of weighted) {
   if (!merged.has(item.name) && merged.size >= POSE_EXPRESSION_LIMIT) continue;
   merged.set(item.name, Math.max(merged.get(item.name) ?? 0, item.weight));
  }
  const pose = { ...base, expressions: Object.fromEntries(merged) };
  if (index >= 0) result[index] = pose; else result.push(pose);
 }
 return result;
}
