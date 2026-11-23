import {
  DEFAULT_OVERLAY_MASK,
  bodyPartOf,
  type AssetRecord,
  type BodyPart,
  type ErrorCode,
  type Id,
  type Reply,
  type SceneView,
} from '@opensekai/contracts';
import {evaluateAvatarClipOnce} from './idle';
import {maskOverlayBones, type OverlayBone} from './overlay-poses';

export type PlayOneShotOverlayEffect = {
  kind: 'playOneShotOverlay';
  entityId: Id;
  assetId: string;
  maskedBodyParts: readonly BodyPart[];
  weight: number;
  speed: number;
  blendInSeconds: number;
  blendOutSeconds: number;
};

export type OneShotEntry = {
  assetId: Id;
  maskedBodyParts: readonly BodyPart[];
  weight: number;
  speed: number;
  blendInMs: number;
  blendOutMs: number;
  startedAtMs: number;
};

export type OneShotStates = ReadonlyMap<Id, OneShotEntry>;
export const EMPTY_ONE_SHOTS: OneShotStates = new Map();

type RecordLookup = (assetId: Id) => AssetRecord | undefined;

const failure = (code: ErrorCode, message: string, ids: Id[]): Reply<never> =>
  ({ok: false, error: {code, message, ids}});

/** Linear blend-in, hold, blend-out. When in+out ≥ length, share the length by requested ratio. */
export function oneShotEnvelope(
  localMs: number,
  lengthMs: number,
  blendInMs: number,
  blendOutMs: number,
): number {
  if (!(lengthMs > 0) || localMs < 0) return 0;
  if (localMs >= lengthMs) return 0;
  let inMs = Math.max(0, blendInMs);
  let outMs = Math.max(0, blendOutMs);
  if (inMs + outMs > lengthMs) {
    const sum = inMs + outMs;
    if (sum <= 0) {
      inMs = 0;
      outMs = 0;
    } else {
      inMs = (inMs / sum) * lengthMs;
      outMs = lengthMs - inMs;
    }
  }
  if (inMs > 0 && localMs < inMs) return localMs / inMs;
  if (outMs > 0 && localMs > lengthMs - outMs) return (lengthMs - localMs) / outMs;
  return 1;
}

export function oneShotPlayLengthMs(durationMs: number, speed: number): number {
  if (!(speed > 0) || !(durationMs > 0)) return 0;
  return durationMs / speed;
}

export function reconcileOneShots(states: OneShotStates, scene: SceneView): OneShotStates {
  let next: Map<Id, OneShotEntry> | null = null;
  for (const [avatarId] of states) {
    const avatar = scene.entities.find(entity => entity.id === avatarId);
    if (avatar?.kind === 'avatar') continue;
    next ??= new Map(states);
    next.delete(avatarId);
  }
  return next ?? states;
}

export function startOneShot(
  states: OneShotStates,
  scene: SceneView,
  records: RecordLookup,
  effect: PlayOneShotOverlayEffect,
  startedAtMs: number,
): Reply<OneShotStates> {
  const avatar = scene.entities.find(entity => entity.id === effect.entityId);
  if (!avatar) return failure('NOT_FOUND', 'Entity not found', [effect.entityId]);
  if (avatar.kind !== 'avatar') return failure('INVALID_INPUT', 'Entity is not an avatar', [effect.entityId]);
  const assetId = effect.assetId.trim();
  if (!assetId) return failure('INVALID_INPUT', 'Animation asset is required', [effect.entityId]);
  const asset = records(assetId);
  if (!asset || asset.format !== 'vrma' || !asset.animation) {
    return failure('INVALID_INPUT', 'Animation asset not found', [effect.entityId, assetId]);
  }
  if (!(effect.speed > 0) || effect.speed > 4) {
    return failure('INVALID_INPUT', 'One-shot speed must be in (0, 4]', [effect.entityId]);
  }
  if (effect.weight < 0 || effect.weight > 1) {
    return failure('INVALID_INPUT', 'One-shot weight must be in [0, 1]', [effect.entityId]);
  }
  const mask = effect.maskedBodyParts.length ? [...effect.maskedBodyParts] : [...DEFAULT_OVERLAY_MASK];
  const entry: OneShotEntry = {
    assetId,
    maskedBodyParts: mask,
    weight: effect.weight,
    speed: effect.speed,
    blendInMs: Math.max(0, effect.blendInSeconds) * 1000,
    blendOutMs: Math.max(0, effect.blendOutSeconds) * 1000,
    startedAtMs,
  };
  const next = new Map(reconcileOneShots(states, scene));
  next.set(avatar.id, entry);
  return {ok: true, data: next};
}

export function evaluateOneShotBones(
  entry: OneShotEntry,
  elapsedMs: number,
  records: RecordLookup,
): {bones: Record<string, OverlayBone>; contribution: number; done: boolean} | null {
  const asset = records(entry.assetId);
  const animation = asset?.animation;
  if (!animation || asset.format !== 'vrma') return null;
  const lengthMs = oneShotPlayLengthMs(animation.durationMs, entry.speed);
  const wallMs = Math.max(0, elapsedMs - entry.startedAtMs);
  if (!(lengthMs > 0)) return {bones: {}, contribution: 0, done: true};
  if (wallMs >= lengthMs) return {bones: {}, contribution: 0, done: true};
  const envelope = oneShotEnvelope(wallMs, lengthMs, entry.blendInMs, entry.blendOutMs);
  const contribution = entry.weight * envelope;
  if (contribution <= 0) return {bones: {}, contribution: 0, done: false};
  const sampled = evaluateAvatarClipOnce(animation, wallMs * entry.speed);
  const asOverlay: Record<string, OverlayBone> = Object.fromEntries(
    Object.entries(sampled).map(([name, bone]) => [name, {space: 'normalized' as const, rotation: bone.rotation}]),
  );
  const mask = entry.maskedBodyParts.length ? entry.maskedBodyParts : [...DEFAULT_OVERLAY_MASK];
  return {bones: maskOverlayBones(asOverlay, mask), contribution, done: false};
}

export function advanceOneShots(
  states: OneShotStates,
  scene: SceneView,
  records: RecordLookup,
  elapsedMs: number,
): OneShotStates {
  const reconciled = reconcileOneShots(states, scene);
  const next = new Map<Id, OneShotEntry>();
  for (const [avatarId, entry] of reconciled) {
    const evaluated = evaluateOneShotBones(entry, elapsedMs, records);
    if (!evaluated || evaluated.done) continue;
    next.set(avatarId, entry);
  }
  return next;
}

export function oneShotMaskedBones(
  entry: OneShotEntry | undefined,
  elapsedMs: number,
  records: RecordLookup,
): Set<string> {
  const out = new Set<string>();
  if (!entry) return out;
  const evaluated = evaluateOneShotBones(entry, elapsedMs, records);
  if (!evaluated || evaluated.contribution <= 0) return out;
  const parts = new Set(entry.maskedBodyParts.length ? entry.maskedBodyParts : DEFAULT_OVERLAY_MASK);
  for (const bone of Object.keys(evaluated.bones)) {
    const part = bodyPartOf(bone);
    if (part && parts.has(part)) out.add(bone);
  }
  return out;
}
