import { z } from 'zod';
import { ExpressionNameSchema } from '../expressions';
import { NodeMeshesSchema } from '../meshes';
import { HUMANOID_BONES } from '../tracking';
import { defineNode, exit, finite, IdSchema } from './define';
import { transitionFields, transitionSettings } from './transition';
import { materialNodes } from './prop';

const target = z.strictObject({ entityId: IdSchema, expression: ExpressionNameSchema, ...transitionSettings });
const fields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'expression', label: 'Expression', kind: 'expression' }, ...transitionFields] as const;
const defaults = (refs: { avatarId?: string; expression?: string }) => refs.avatarId && refs.expression ? { entityId: refs.avatarId, expression: refs.expression } : null;
const bone = z.strictObject({ entityId: IdSchema, bone: z.enum(HUMANOID_BONES) });
const boneFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'bone', label: 'Bone', kind: 'bone' }] as const;
const boneDefaults = (name: string) => (refs: { avatarId?: string }) => refs.avatarId ? { entityId: refs.avatarId, bone: name } : null;
export const MAX_NODE_BONES = 32;
const offsetBones = z.strictObject({
 entityId: IdSchema,
 bones: z.array(z.enum(HUMANOID_BONES)).min(1).max(MAX_NODE_BONES).refine(list => new Set(list).size === list.length, 'Duplicate bone'),
 axis: z.enum(['x', 'y', 'z']),
 intensity: finite.min(-360).max(360),
 offset: finite.min(-360).max(360),
});
const offsetBonesFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'bones', label: 'Bones', kind: 'bones' }, { key: 'axis', label: 'Axis', kind: 'choice', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] }, { key: 'intensity', label: 'Intensity', kind: 'number', min: -360, max: 360 }, { key: 'offset', label: 'Offset', kind: 'number', min: -360, max: 360 }] as const;
const boneList = z.array(z.enum(HUMANOID_BONES)).min(1).max(MAX_NODE_BONES).refine(list => new Set(list).size === list.length, 'Duplicate bone');
const offsetBoneTranslation = z.strictObject({ entityId: IdSchema, bones: boneList, axis: z.enum(['x', 'y', 'z']), intensity: finite.min(-2).max(2), offset: finite.min(-2).max(2) });
const offsetBoneScale = z.strictObject({ entityId: IdSchema, bones: boneList, intensity: finite.min(-1).max(1), offset: finite.min(-1).max(1) });
const axisField = { key: 'axis', label: 'Axis', kind: 'choice', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' }] } as const;
const bonesField = { key: 'bones', label: 'Bones', kind: 'bones' } as const;
const offsetBoneTranslationFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, bonesField, axisField, { key: 'intensity', label: 'Intensity', kind: 'number', min: -2, max: 2 }, { key: 'offset', label: 'Offset', kind: 'number', min: -2, max: 2 }] as const;
const offsetBoneScaleFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, bonesField, { key: 'intensity', label: 'Intensity', kind: 'number', min: -1, max: 1 }, { key: 'offset', label: 'Offset', kind: 'number', min: -1, max: 1 }] as const;
const blendShape = z.strictObject({ entityId: IdSchema, blendShape: ExpressionNameSchema, ...transitionSettings });
const lookAt = z.strictObject({ entityId: IdSchema, targetId: IdSchema, ...transitionSettings });
const meshes = z.strictObject({ entityId: IdSchema, meshes: NodeMeshesSchema });
const meshFields = [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'meshes', label: 'Meshes', kind: 'meshes' }] as const;
const meshDefaults = (refs: { avatarId?: string; mesh?: string }) => refs.avatarId && refs.mesh ? { entityId: refs.avatarId, meshes: [refs.mesh] } : null;
export const CHARACTER_NODES = [
 defineNode({ type: 'character.setExpression', label: 'Set Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape', 'transition', 'fade'], settings: target, ports: () => ({ inputs: { flow: 'flow', active: 'boolean' }, outputs: { ...exit } }), defaults, fields }),
 defineNode({ type: 'character.toggleExpression', label: 'Toggle Expression', category: 'Character', keywords: ['expression', 'face', 'emote', 'blendshape', 'transition', 'fade'], settings: target, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults, fields }),
 // Euler angles in degrees, order YXZ, in the pose frame: y yaw, x pitch, z roll.
 defineNode({ type: 'character.getBoneRotation', label: 'Get Bone Rotation', category: 'Character', keywords: ['bone', 'rotation', 'head', 'euler', 'pose', 'read'], settings: bone, ports: () => ({ inputs: {}, outputs: { euler: 'vector3' } }), defaults: boneDefaults('head'), fields: boneFields }),
 defineNode({ type: 'character.offsetBoneRotation', label: 'Offset Bone Rotation', category: 'Character', keywords: ['bone', 'rotation', 'chest', 'spine', 'hips', 'euler', 'offset', 'body'], settings: bone, ports: () => ({ inputs: { flow: 'flow', euler: 'vector3' }, outputs: { ...exit } }), defaults: boneDefaults('chest'), fields: boneFields }),
 // The angle in degrees of each bone is clamp(weight * (value * intensity + offset), -360, 360) on the axis.
 defineNode({ type: 'character.offsetBones', label: 'Offset Bones', category: 'Character', keywords: ['bone', 'bones', 'rotation', 'spine', 'chest', 'arm', 'offset', 'body', 'sway', 'pendulum'], settings: offsetBones, ports: () => ({ inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { ...exit } }), inputDefaults: { weight: 1 }, defaults: refs => refs.avatarId ? { entityId: refs.avatarId, bones: ['spine'], axis: 'y' as const, intensity: 1, offset: 0 } : null, fields: offsetBonesFields }),
 // The offset in meters of each bone is clamp(weight * (value * intensity + offset), -2, 2) on the axis.
 defineNode({ type: 'character.offsetBoneTranslation', label: 'Offset Bone Translation', category: 'Character', keywords: ['bone', 'bones', 'translation', 'bounce', 'position', 'hips', 'spine', 'chest', 'offset', 'body'], settings: offsetBoneTranslation, ports: () => ({ inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { ...exit } }), inputDefaults: { weight: 1 }, defaults: refs => refs.avatarId ? { entityId: refs.avatarId, bones: ['spine'], axis: 'y' as const, intensity: 0.01, offset: 0 } : null, fields: offsetBoneTranslationFields }),
 defineNode({ type: 'character.offsetBoneScale', label: 'Offset Bone Scale', category: 'Character', keywords: ['bone', 'bones', 'scale', 'size', 'squash', 'stretch', 'chest', 'offset', 'body'], settings: offsetBoneScale, ports: () => ({ inputs: { flow: 'flow', value: 'number', weight: 'number' }, outputs: { ...exit } }), inputDefaults: { weight: 1 }, defaults: refs => refs.avatarId ? { entityId: refs.avatarId, bones: ['chest'], intensity: 0.01, offset: 0 } : null, fields: offsetBoneScaleFields }),
 defineNode({ type: 'character.setBlendShape', label: 'Set BlendShape', category: 'Character', keywords: ['blendshape', 'blend shape', 'morph', 'face', 'weight', 'transition'], settings: blendShape, ports: () => ({ inputs: { flow: 'flow', weight: 'number' }, outputs: { ...exit } }), inputDefaults: { weight: 1 }, defaults: refs => refs.avatarId ? { entityId: refs.avatarId, blendShape: 'blink' } : null, fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'blendShape', label: 'BlendShape', kind: 'blendshape' }, ...transitionFields] }),
 defineNode({ type: 'character.toggleMeshes', label: 'Toggle Character Meshes', category: 'Character', keywords: ['mesh', 'clothes', 'clothing', 'accessory', 'outfit', 'show', 'hide', 'toggle'], settings: meshes, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: meshDefaults, fields: meshFields }),
 defineNode({ type: 'character.setMeshesVisible', label: 'Set Character Meshes Visible', category: 'Character', keywords: ['mesh', 'clothes', 'clothing', 'accessory', 'outfit', 'show', 'hide', 'visible'], settings: meshes, ports: () => ({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: { ...exit } }), inputDefaults: { visible: true }, defaults: meshDefaults, fields: meshFields }),
 defineNode({ type: 'character.lookAt', label: 'Look At', category: 'Character', keywords: ['look', 'gaze', 'head', 'face', 'camera', 'target', 'aim'], settings: lookAt, ports: () => ({ inputs: { flow: 'flow', weight: 'number' }, outputs: { ...exit } }), inputDefaults: { weight: 1 }, defaults: refs => refs.avatarId && refs.cameraId ? { entityId: refs.avatarId, targetId: refs.cameraId } : null, fields: [{ key: 'entityId', label: 'Character', kind: 'avatar' }, { key: 'targetId', label: 'Target', kind: 'entity' }, ...transitionFields] }),
 ...materialNodes('character', 'avatar', 'Character', 'Character'),
] as const;
