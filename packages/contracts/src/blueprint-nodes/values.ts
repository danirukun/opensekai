import { z } from 'zod';
import { defineNode, finite } from './define';

export const VALUE_NODES = [
 defineNode({ type: 'value.number', label: 'Number', category: 'Values', keywords: ['constant', 'float', 'integer'], settings: z.strictObject({ value: finite }), ports: () => ({ inputs: {}, outputs: { value: 'number' } }), defaults: () => ({ value: 0 }), fields: [{ key: 'value', label: 'Value', kind: 'number' }] }),
 defineNode({ type: 'value.boolean', label: 'Boolean', category: 'Values', keywords: ['true', 'false', 'constant'], settings: z.strictObject({ value: z.boolean() }), ports: () => ({ inputs: {}, outputs: { value: 'boolean' } }), defaults: () => ({ value: true }), fields: [{ key: 'value', label: 'Value', kind: 'boolean' }] }),
] as const;
