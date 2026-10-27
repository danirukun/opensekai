import { z } from 'zod';
import { assetProperty, PROPERTY_KEYS } from '../property-registry';
import { defineNode, exit, IdSchema } from './define';
import { transitionFields, transitionSettings } from './transition';

const target = z.strictObject({ entityId: IdSchema, property: z.enum(PROPERTY_KEYS) });
const fields = [{ key: 'entityId', label: 'Entity', kind: 'entity' }, { key: 'property', label: 'Property', kind: 'property' }] as const;
export const PROPERTY_NODES = [
 defineNode({ type: 'property.get', label: 'Get Asset Property', category: 'Scene', keywords: ['read', 'position', 'rotation', 'scale', 'property'], settings: target, ports: s => ({ inputs: {}, outputs: { value: assetProperty(s.property).type } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, property: 'position' as const } : null, fields, dynamicPorts: true }),
 defineNode({ type: 'property.set', label: 'Set Asset Property', category: 'Scene', keywords: ['write', 'position', 'rotation', 'scale', 'property', 'transform', 'transition', 'tween', 'ease', 'animate'], settings: target.extend(transitionSettings), ports: s => ({ inputs: { flow: 'flow', value: assetProperty(s.property).type }, outputs: { ...exit, transitionEnd: 'flow' } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, property: 'position' as const } : null, fields: [...fields, ...transitionFields], dynamicPorts: true }),
 defineNode({ type: 'entity.move', label: 'Move Entity', category: 'Scene', keywords: ['translate', 'walk', 'wasd', 'offset', 'position'], settings: z.strictObject({ entityId: IdSchema, space: z.enum(['world', 'local']) }), ports: () => ({ inputs: { flow: 'flow', delta: 'vector3' }, outputs: { ...exit } }), defaults: refs => refs.entityId ? { entityId: refs.entityId, space: 'local' as const } : null, fields: [{ key: 'entityId', label: 'Entity', kind: 'entity' }, { key: 'space', label: 'Space', kind: 'space' }] }),
] as const;
