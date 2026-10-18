import { z } from 'zod';
import { MAX_BLUEPRINT_STRING_LENGTH } from '../blueprint-values';
import type { Vec3 } from '../types';
import { defineNode, finite } from './define';

// zod 4 `int()` accepts safe integers only, as the `integer` type does.
export const SafeIntegerSchema = z.number().int();
export const BlueprintStringSchema = z.string().max(MAX_BLUEPRINT_STRING_LENGTH);
const Vector3Schema = z.tuple([finite, finite, finite]);
export const LITERAL_NODES = [
 defineNode({ type: 'value.integer', label: 'Integer', category: 'Values', keywords: ['constant', 'int', 'whole', 'count'], settings: z.strictObject({ value: SafeIntegerSchema }), ports: () => ({ inputs: {}, outputs: { value: 'integer' } }), defaults: () => ({ value: 0 }), fields: [{ key: 'value', label: 'Value', kind: 'integer' }] }),
 defineNode({ type: 'value.string', label: 'String', category: 'Values', keywords: ['constant', 'text', 'word', 'literal'], settings: z.strictObject({ value: BlueprintStringSchema }), ports: () => ({ inputs: {}, outputs: { value: 'string' } }), defaults: () => ({ value: '' }), fields: [{ key: 'value', label: 'Value', kind: 'string', maxLength: MAX_BLUEPRINT_STRING_LENGTH }] }),
 defineNode({ type: 'value.vector3', label: 'Vector3', category: 'Values', keywords: ['constant', 'xyz', 'position', 'vector'], settings: z.strictObject({ value: Vector3Schema }), ports: () => ({ inputs: {}, outputs: { value: 'vector3' } }), defaults: () => ({ value: [0, 0, 0] as Vec3 }), fields: [{ key: 'value', label: 'Value', kind: 'vector3' }] }),
] as const;
