import { z } from 'zod';
import { ExpressionNameSchema } from '../expressions';
import { HUMANOID_BONES } from '../tracking';
import { defineNode, exit, IdSchema } from './define';
import { transitionFields, transitionSettings } from './transition';

const target = z.strictObject({ entityId: IdSchema, expression: ExpressionNameSchema, ...transitionSettings });
const fields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'expression', label: 'Expression', kind: 'expression' }, ...transitionFields] as const;
const defaults = (refs: { avatarId?: string; expression?: string }) => refs.avatarId && refs.expression ? { entityId: refs.avatarId, expression: refs.expression } : null;
const bone = z.strictObject({ entityId: IdSchema, bone: z.enum(HUMANOID_BONES) });
const boneFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'bone', label: 'Bone', kind: 'bone' }] as const;
const boneDefaults = (name: string) => (refs: { avatarId?: string }) => refs.avatarId ? { entityId: refs.avatarId, bone: name } : null;
const blendShape = z.strictObject({ entityId: IdSchema, blendShape: ExpressionNameSchema, ...transitionSettings });
const lookAt = z.strictObject({ entityId: IdSchema, targetId: IdSchema, ...transitionSettings });
export const CHARACTER_NODES = [
 defineNode({ type: 'character.setExpression', label: 'Set Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape', 'transition', 'fade'], settings: target, ports: () => ({ inputs: { flow: 'flow', active: 'boolean' }, outputs: { ...exit } }), defaults, fields }),
 defineNode({ type: 'character.toggleExpression', label: 'Toggle Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape', 'transition', 'fade'], settings: target, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults, fields }),
 // Euler angles in degrees, order YXZ, in the pose frame: y yaw, x pitch, z roll.
 defineNode({ type: 'character.getBoneRotation', label: 'Get Bone Rotation', category: 'Character', keywords: ['bone', 'rotation', 'head', 'euler', 'pose', 'read'], settings: bone, ports: () => ({ inputs: {}, outputs: { euler: 'vector3' } }), defaults: boneDefaults('head'), fields: boneFields }),
 defineNode({ type: 'character.offsetBoneRotation', label: 'Offset Bone Rotation', category: 'Character', keywords: ['bone', 'rotation', 'chest', 'spine', 'hips', 'euler', 'offset', 'body'], settings: bone, ports: () => ({ inputs: { flow: 'flow', euler: 'vector3' }, outputs: { ...exit } }), defaults: boneDefaults('chest'), fields: boneFields }),
 defineNode({ type: 'character.setBlendShape', label: 'Set BlendShape', category: 'Character', keywords: ['blendshape', 'blend shape', 'morph', 'face', 'weight', 'transition'], settings: blendShape, ports: () => ({ inputs: { flow: 'flow', weight: 'number' }, outputs: { ...exit } }), defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'blink' } : null, fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'BlendShape', kind: 'blendshape' }, ...transitionFields] }),
 defineNode({ type: 'character.lookAt', label: 'Look At', category: 'Character', keywords: ['look', 'gaze', 'head', 'face', 'camera', 'target', 'aim'], settings: lookAt, ports: () => ({ inputs: { flow: 'flow', weight: 'number' }, outputs: { ...exit } }), defaults: refs => refs.avatarId && refs.cameraId ? { entityId: refs.avatarId, targetId: refs.cameraId } : null, fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'targetId', label: 'Target', kind: 'entity' }, ...transitionFields] }),
] as const;
