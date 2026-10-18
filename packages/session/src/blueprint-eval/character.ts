import type { Vec3 } from '@opensekai/contracts';
import { boneEuler } from '../bone-offsets';
import { withTransition } from '../tweens';
import type { EvaluatorTable } from './types';

export const CHARACTER_EVALUATORS = {
 'character.setExpression': { flow: (node, c) => c.emit({ kind: 'setExpression', entityId: node.settings.entityId, expression: node.settings.expression, active: Boolean(c.read('active')), ...withTransition(node.settings) }) },
 'character.toggleExpression': { flow: (node, c) => c.emit({ kind: 'toggleExpression', entityId: node.settings.entityId, expression: node.settings.expression, ...withTransition(node.settings) }) },
 'character.getBoneRotation': { data: (node, _o, _r, _s, env) => {
  const avatar = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
  return boneEuler(env.previousPose?.(avatar.id) ?? null, node.settings.bone);
 } },
 'character.offsetBoneRotation': { flow: (node, c) => c.emit({ kind: 'offsetBone', entityId: node.settings.entityId, bone: node.settings.bone, euler: c.read('euler') as Vec3 }) },
 'character.setBlendShape': { flow: (node, c) => c.emit({ kind: 'setBlendShape', entityId: node.settings.entityId, blendShape: node.settings.blendShape, weight: Number(c.read('weight')), ...withTransition(node.settings) }) },
 'character.lookAt': { flow: (node, c) => c.emit({ kind: 'lookAt', entityId: node.settings.entityId, targetId: node.settings.targetId, weight: Number(c.read('weight')), ...withTransition(node.settings) }) },
} satisfies Partial<EvaluatorTable>;
