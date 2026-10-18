import type { Vec3 } from '@opensekai/contracts';
import { boneEuler } from '../bone-offsets';
import type { EvaluatorTable } from './types';

export const CHARACTER_EVALUATORS = {
 'character.setExpression': { flow: (node, c) => c.emit({ kind: 'setExpression', entityId: node.settings.entityId, expression: node.settings.expression, active: Boolean(c.read('active')) }) },
 'character.toggleExpression': { flow: (node, c) => c.emit({ kind: 'toggleExpression', entityId: node.settings.entityId, expression: node.settings.expression }) },
 'character.getBoneRotation': { data: (node, _o, _r, _s, env) => {
  const avatar = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
  return boneEuler(env.previousPose?.(avatar.id) ?? null, node.settings.bone);
 } },
 'character.offsetBoneRotation': { flow: (node, c) => c.emit({ kind: 'offsetBone', entityId: node.settings.entityId, bone: node.settings.bone, euler: c.read('euler') as Vec3 }) },
} satisfies Partial<EvaluatorTable>;
