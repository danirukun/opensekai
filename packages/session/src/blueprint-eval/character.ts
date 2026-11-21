import { bodyPartOf, type Id, type SceneView, type Vec3 } from '@opensekai/contracts';
import { boneEuler } from '../bone-offsets';
import { withTransition } from '../tweens';
import type { EvaluatorTable } from './types';

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const;
const isFinger = (bone: string) => { const part = bodyPartOf(bone); return part === 'leftFingers' || part === 'rightFingers'; };
// Tracking drives a bone that a body source tracks (no body group counts as all parts) and a finger bone that a fingers source or a body source gives.
export function offsetBonesSkipped(scene: SceneView, entityId: Id, bone: string): boolean {
 const avatar = scene.entities.find(item => item.id === entityId);
 if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
 const tracking = avatar.tracking;
 if (!tracking) return false;
 const part = bodyPartOf(bone);
 if (isFinger(bone) && (tracking.fingersSourceId != null || tracking.bodySourceId !== null)) return true;
 return tracking.bodySourceId !== null && part !== null && (tracking.body?.trackedParts.includes(part) ?? true);
}

export const CHARACTER_EVALUATORS = {
 'character.setExpression': { flow: (node, c) => c.emit({ kind: 'setExpression', entityId: node.settings.entityId, expression: node.settings.expression, active: Boolean(c.read('active')), ...withTransition(node.settings) }) },
 'character.toggleExpression': { flow: (node, c) => c.emit({ kind: 'toggleExpression', entityId: node.settings.entityId, expression: node.settings.expression, ...withTransition(node.settings) }) },
 'character.getBoneRotation': { data: (node, _o, _r, _s, env) => {
  const avatar = env.scene()?.entities.find(item => item.id === node.settings.entityId);
  if (avatar?.kind !== 'avatar') throw new RangeError('Character is unavailable');
  return boneEuler(env.previousPose?.(avatar.id) ?? null, node.settings.bone);
 } },
 'character.offsetBoneRotation': { flow: (node, c) => c.emit({ kind: 'offsetBone', entityId: node.settings.entityId, bone: node.settings.bone, euler: c.read('euler') as Vec3 }) },
 'character.offsetBones': { flow: (node, c) => {
  const scene = c.env.scene();
  if (!scene) throw new RangeError('Character is unavailable');
  const { entityId, bones, axis, intensity, offset } = node.settings;
  const angle = Math.min(360, Math.max(-360, Number(c.read('weight')) * (Number(c.read('value')) * intensity + offset)));
  const euler = (): Vec3 => [0, 1, 2].map(index => index === AXIS_INDEX[axis] ? angle : 0) as Vec3;
  c.emitEach(bones.filter(bone => !offsetBonesSkipped(scene, entityId, bone)).map(bone => ({ kind: 'offsetBone', entityId, bone, euler: euler() })));
 } },
 // The offset in meters of each bone is weight * (value * intensity + offset) on the axis, like Offset Bones.
 'character.offsetBoneTranslation': { flow: (node, c) => {
  const scene = c.env.scene();
  if (!scene) throw new RangeError('Character is unavailable');
  const { entityId, bones, axis, intensity, offset } = node.settings;
  const delta = Number(c.read('weight')) * (Number(c.read('value')) * intensity + offset);
  const translation = (): Vec3 => [0, 1, 2].map(index => index === AXIS_INDEX[axis] ? delta : 0) as Vec3;
  c.emitEach(bones.filter(bone => !offsetBonesSkipped(scene, entityId, bone)).map(bone => ({ kind: 'offsetBoneTranslation', entityId, bone, translation: translation() })));
 } },
 // The absolute scale of each bone is 1 + weight * (value * intensity + offset), clamped to [0.5, 1.5].
 'character.offsetBoneScale': { flow: (node, c) => {
  const scene = c.env.scene();
  if (!scene) throw new RangeError('Character is unavailable');
  const { entityId, bones, intensity, offset } = node.settings;
  const scale = Math.min(1.5, Math.max(0.5, 1 + Number(c.read('weight')) * (Number(c.read('value')) * intensity + offset)));
  c.emitEach(bones.filter(bone => !offsetBonesSkipped(scene, entityId, bone)).map(bone => ({ kind: 'offsetBoneScale', entityId, bone, scale })));
 } },
 'character.setBlendShape': { flow: (node, c) => c.emit({ kind: 'setBlendShape', entityId: node.settings.entityId, blendShape: node.settings.blendShape, weight: Number(c.read('weight')), ...withTransition(node.settings) }) },
 'character.toggleMeshes': { flow: (node, c) => c.emit({ kind: 'toggleMeshes', entityId: node.settings.entityId, names: [...node.settings.meshes] }) },
 'character.setMeshesVisible': { flow: (node, c) => c.emit({ kind: 'setMeshesVisible', entityId: node.settings.entityId, names: [...node.settings.meshes], visible: Boolean(c.read('visible')) }) },
 'character.lookAt': { flow: (node, c) => c.emit({ kind: 'lookAt', entityId: node.settings.entityId, targetId: node.settings.targetId, weight: Number(c.read('weight')), ...withTransition(node.settings) }) },
} satisfies Partial<EvaluatorTable>;
