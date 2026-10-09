import { z } from 'zod';
import { defineNode, exit, IdSchema } from './define';

const entity = z.strictObject({ entityId: IdSchema });
export const SCENE_NODES = [
 defineNode({ type: 'scene.setVisibility', label: 'Set Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'scene.toggleVisibility', label: 'Toggle Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'camera.switch', label: 'Switch Camera', category: 'Scene', keywords: ['camera', 'cut', 'view', 'output'], settings: z.strictObject({ outputId: IdSchema, cameraId: IdSchema }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.outputId && refs.cameraId ? { outputId: refs.outputId, cameraId: refs.cameraId } : null, fields: [{ key: 'outputId', label: 'Output', kind: 'output' }, { key: 'cameraId', label: 'Camera', kind: 'camera' }] }),
] as const;
