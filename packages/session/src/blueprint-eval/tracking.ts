import { canonicalArkitName, type ArkitName, type AvatarPose, type BlueprintNodeOf, type Id, type TrackingStatus, TRACKING_LOST_AFTER_SECONDS } from '@opensekai/contracts';
import { boneEuler } from '../bone-offsets';
import type { StepEnv } from '../blueprint-runtime';
import { initialPendulumState, mixPendulumInputs, pendulumOutput, stepPendulum, type PendulumReading, type PendulumState } from '../pendulum';
import { getNodeState, setNodeState, type EvaluatorTable, type NodeState, type RunEnv, type RunState } from './types';

export const trackedBlendShape = (pose: AvatarPose | null, name: ArkitName): number =>
 Object.entries(pose?.expressions ?? {}).reduce((best, [key, value]) => canonicalArkitName(key) === name ? Math.max(best, value) : best, 0);

declare module './types' {
 interface RunEnv {
  // The status of a tracking source at the end of the previous tick; null when the source has none.
  trackingStatus?: (sourceId: Id) => TrackingStatus | null;
 }
}

export type TrackingEdge = { kind: 'threshold'; above: boolean } | { kind: 'presence'; seen: boolean; lost: boolean; notReceivingSinceMs: number | null };
type TrackingNode = BlueprintNodeOf<'tracking.onBlendShapeThreshold' | 'tracking.onLost' | 'tracking.onFound'>;
export const isTrackingTrigger = (node: { type: string }): node is TrackingNode => node.type === 'tracking.onBlendShapeThreshold' || node.type === 'tracking.onLost' || node.type === 'tracking.onFound';

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
 const afterMs = (node.type === 'tracking.onLost' ? node.settings.after : TRACKING_LOST_AFTER_SECONDS) * 1000;
 const due = before.seen && !before.lost && nowMs - since >= afterMs;
 return { edge: { ...before, lost: before.lost || due, notReceivingSinceMs: since }, port: due && node.type === 'tracking.onLost' ? 'flow' : null };
}

const characterPose = (entityId: Id, env: RunEnv): AvatarPose | null => {
 const avatar = env.scene()?.entities.find(item => item.id === entityId);
 if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
 return env.previousPose?.(avatar.id) ?? null;
};

// `stepMs` is the tick of the last step, or null when the env has no tick time.
type PendulumNodeState = PendulumState & { stepMs: number | null };
// The due rule of `damped()`: the first read starts at the input mix, then the node steps once per session tick with a time delta.
function pendulum(node: BlueprintNodeOf<'tracking.pendulum'>, state: RunState, env: RunEnv): number {
 const pose = characterPose(node.settings.entityId, env);
 const { inputs, arms, inputSmoothing } = node.settings;
 const mix = () => {
  const reading: PendulumReading = { rotation: boneEuler(pose, 'head'), position: pose?.headPosition ? [...pose.headPosition] : [0, 0, 0], blendShape: name => trackedBlendShape(pose, name as ArkitName) };
  const value = mixPendulumInputs(inputs, reading);
  return Number.isFinite(value) ? value : 0;
 };
 const stored = getNodeState<PendulumNodeState & NodeState>(state, node.id);
 const moving = env.deltaSeconds > 0, stepMs = moving ? env.tickMs ?? null : null;
 const store = (next: PendulumState) => { setNodeState(state, node.id, { ...next, stepMs } as unknown as NodeState); return pendulumOutput(next); };
 // A changed arm count starts again.
 if (!stored || stored.angles.length !== arms.length) return store(initialPendulumState(arms.length, mix()));
 const due = moving && (env.tickMs === undefined || stored.stepMs === null || env.tickMs > stored.stepMs);
 // The 1 s limit keeps a long pause (a hidden window) to one bounded step.
 return due ? store(stepPendulum(stored, arms, mix(), inputSmoothing, Math.min(env.deltaSeconds, 1))) : pendulumOutput(stored);
}

export const TRACKING_EVALUATORS = {
 'tracking.getBlendShape': { data: (node, _o, _r, _s, env) => trackedBlendShape(characterPose(node.settings.entityId, env), node.settings.blendShape) },
 'tracking.getHeadPose': { data: (node, output, _r, _s, env) => {
  const pose = characterPose(node.settings.entityId, env);
  if (output === 'rotation') return boneEuler(pose, 'head');
  if (output === 'position') return pose?.headPosition ? [...pose.headPosition] : [0, 0, 0];
  const head = pose && Object.hasOwn(pose.bones, 'head') ? pose.bones.head : undefined;
  return head ? head.weight ?? 1 : 0;
 } },
 'tracking.pendulum': { data: (node, _o, _r, state, env) => pendulum(node, state, env) },
 'tracking.onBlendShapeThreshold': { data: (node, _o, _r, _s, env) => trackedBlendShape(env.previousPose?.(node.settings.entityId) ?? null, node.settings.blendShape) },
 'tracking.onLost': {},
 'tracking.onFound': {},
} satisfies Partial<EvaluatorTable>;
