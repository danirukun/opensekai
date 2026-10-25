import { canonicalArkitName, type ArkitName, type AvatarPose, type BlueprintNodeOf, type Id, type TrackingStatus } from '@opensekai/contracts';
import type { EvaluatorTable, RunEnv } from './types';

export const trackedBlendShape = (pose: AvatarPose | null, name: ArkitName): number =>
 Object.entries(pose?.expressions ?? {}).reduce((best, [key, value]) => canonicalArkitName(key) === name ? Math.max(best, value) : best, 0);

declare module './types' {
 interface RunEnv {
  // The latest status of a tracking source; null when the source has none.
  trackingStatus?: (sourceId: Id) => TrackingStatus | null;
 }
}

export type TrackingEdge = { kind: 'threshold'; above: boolean } | { kind: 'presence'; seen: boolean; lost: boolean; notReceivingSinceMs: number | null };
type TrackingNode = BlueprintNodeOf<'tracking.onBlendShapeThreshold' | 'tracking.onLost' | 'tracking.onFound'>;
type StepEnv = Omit<RunEnv, 'deltaSeconds'>;
export const isTrackingTrigger = (node: { type: string }): node is TrackingNode => node.type === 'tracking.onBlendShapeThreshold' || node.type === 'tracking.onLost' || node.type === 'tracking.onFound';

// On Tracking Found has no setting for it: a source counts as lost after this long without receiving, the On Tracking Lost default.
const FOUND_LOST_AFTER_SECONDS = 2;
// One tick of a tracking trigger: the next edge state and the output port that fires, if any.
export function trackingTrigger(node: TrackingNode, edge: TrackingEdge | undefined, env: StepEnv, nowMs: number): { edge: TrackingEdge; port: 'rise' | 'fall' | 'flow' | null } {
 if (node.type === 'tracking.onBlendShapeThreshold') {
  const above = edge?.kind === 'threshold' && edge.above;
  const value = trackedBlendShape(env.previousPose?.(node.settings.entityId) ?? null, node.settings.blendShape);
  if (!above && value >= node.settings.threshold) return { edge: { kind: 'threshold', above: true }, port: 'rise' };
  if (above && value <= node.settings.release) return { edge: { kind: 'threshold', above: false }, port: 'fall' };
  return { edge: { kind: 'threshold', above }, port: null };
 }
 const before = edge?.kind === 'presence' ? edge : { kind: 'presence' as const, seen: false, lost: false, notReceivingSinceMs: null };
 if (env.trackingStatus?.(node.settings.sourceId)?.state === 'receiving')
  return { edge: { kind: 'presence', seen: true, lost: false, notReceivingSinceMs: null }, port: node.type === 'tracking.onFound' && before.lost ? 'flow' : null };
 const since = before.notReceivingSinceMs ?? nowMs;
 const afterMs = (node.type === 'tracking.onLost' ? node.settings.after : FOUND_LOST_AFTER_SECONDS) * 1000;
 const due = before.seen && !before.lost && nowMs - since >= afterMs;
 return { edge: { ...before, lost: before.lost || due, notReceivingSinceMs: since }, port: due && node.type === 'tracking.onLost' ? 'flow' : null };
}

export const TRACKING_EVALUATORS = {
 'tracking.getBlendShape': { data: (node, _o, _r, _s, env) => {
  const avatar = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
  return trackedBlendShape(env.previousPose?.(avatar.id) ?? null, node.settings.blendShape);
 } },
 'tracking.onBlendShapeThreshold': { data: (node, _o, _r, _s, env) => trackedBlendShape(env.previousPose?.(node.settings.entityId) ?? null, node.settings.blendShape) },
 'tracking.onLost': {},
 'tracking.onFound': {},
} satisfies Partial<EvaluatorTable>;
