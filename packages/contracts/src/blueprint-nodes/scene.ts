import { z } from 'zod';
import { defineNode, exit, IdSchema } from './define';
import { transitionFields, transitionSettings } from './transition';

const entity = z.strictObject({ entityId: IdSchema });
export const SCENE_NODES = [
 defineNode({ type: 'scene.setVisibility', label: 'Set Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'scene.toggleVisibility', label: 'Toggle Visibility', category: 'Scene', keywords: ['show', 'hide', 'visible'], settings: entity, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }] }),
 defineNode({ type: 'camera.switch', label: 'Switch Camera', category: 'Scene', keywords: ['camera', 'cut', 'view', 'output'], settings: z.strictObject({ outputId: IdSchema, cameraId: IdSchema }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: refs => refs.outputId && refs.cameraId ? { outputId: refs.outputId, cameraId: refs.cameraId } : null, fields: [{ key: 'outputId', label: 'Output', kind: 'output' }, { key: 'cameraId', label: 'Camera', kind: 'camera' }] }),
 // Moves an Orbit Character camera around its pivot (B32 R1). Yaw, Pitch, and Distance are data inputs, so a graph can compute them.
 defineNode({ type: 'camera.orbitCharacter', label: 'Camera Orbit Character', category: 'Scene', keywords: ['camera', 'orbit', 'yaw', 'pitch', 'distance', 'transition', 'animate'], settings: z.strictObject({ cameraId: IdSchema, ...transitionSettings }), ports: () => ({ inputs: { flow: 'flow', yaw: 'number', pitch: 'number', distance: 'number' }, outputs: { ...exit, transitionEnd: 'flow' } }), inputDefaults: { yaw: 0, pitch: 10, distance: 2.5 }, defaults: refs => refs.cameraId ? { cameraId: refs.cameraId } : null, fields: [{ key: 'cameraId', label: 'Camera', kind: 'camera' }, ...transitionFields] }),
] as const;
