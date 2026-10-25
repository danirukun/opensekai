import { canonicalArkitName, type ArkitName, type AvatarPose } from '@opensekai/contracts';
import type { EvaluatorTable } from './types';

export const trackedBlendShape = (pose: AvatarPose | null, name: ArkitName): number =>
 Object.entries(pose?.expressions ?? {}).reduce((best, [key, value]) => canonicalArkitName(key) === name ? Math.max(best, value) : best, 0);

export const TRACKING_EVALUATORS = {
 'tracking.getBlendShape': { data: (node, _o, _r, _s, env) => {
  const avatar = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
  return trackedBlendShape(env.previousPose?.(avatar.id) ?? null, node.settings.blendShape);
 } },
} satisfies Partial<EvaluatorTable>;
