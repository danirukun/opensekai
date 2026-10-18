import { z } from 'zod';
import type { Vec3 } from './types';
import type { PortType } from './blueprint-nodes/define';

export const SCALAR_TYPES = ['number', 'integer', 'boolean', 'string', 'vector3'] as const;
export type ScalarType = (typeof SCALAR_TYPES)[number];
export type ListType = `${ScalarType}[]`;
export type DataType = ScalarType | ListType;
export const listOf = (type: ScalarType): ListType => `${type}[]`;
export const itemType = (type: ListType): ScalarType => type.slice(0, -2) as ScalarType;
export const DATA_TYPES: readonly DataType[] = [...SCALAR_TYPES, ...SCALAR_TYPES.map(listOf)];
export const isScalarType = (type: string): type is ScalarType => (SCALAR_TYPES as readonly string[]).includes(type);
export const isListType = (type: string): type is ListType => type.endsWith('[]') && isScalarType(type.slice(0, -2));
const SCALAR_LABELS: Record<ScalarType, string> = { number: 'Number', integer: 'Integer', boolean: 'Boolean', string: 'String', vector3: 'Vector3' };
export const DATA_TYPE_LABELS = Object.fromEntries(DATA_TYPES.map(type =>
 [type, isListType(type) ? `${SCALAR_LABELS[itemType(type)]} List` : SCALAR_LABELS[type as ScalarType]])) as Record<DataType, string>;

export const MAX_BLUEPRINT_STRING_LENGTH = 1024;
export const MAX_BLUEPRINT_LIST_LENGTH = 256;
export const MAX_INLINE_INPUTS = 16;

export type ScalarValue = number | boolean | string | Vec3;
export type BlueprintValue = ScalarValue | readonly number[] | readonly boolean[] | readonly string[] | readonly Vec3[];
type ScalarValueOf<T extends ScalarType> = T extends 'number' | 'integer' ? number : T extends 'boolean' ? boolean : T extends 'string' ? string : Vec3;
export type ValueOf<T extends DataType> = T extends `${infer S extends ScalarType}[]` ? readonly ScalarValueOf<S>[] : T extends ScalarType ? ScalarValueOf<T> : never;

const finite = z.number().finite();
const SCALAR_SCHEMAS: Record<ScalarType, z.ZodType<ScalarValue>> = {
 number: finite,
 integer: z.number().refine(Number.isSafeInteger, 'Not a safe integer'),
 boolean: z.boolean(),
 string: z.string().max(MAX_BLUEPRINT_STRING_LENGTH),
 vector3: z.tuple([finite, finite, finite]) as z.ZodType<Vec3>,
};
const SCHEMAS = Object.fromEntries(DATA_TYPES.map(type => [type, isListType(type)
 ? z.array(SCALAR_SCHEMAS[itemType(type)]).max(MAX_BLUEPRINT_LIST_LENGTH)
 : SCALAR_SCHEMAS[type as ScalarType]])) as Record<DataType, z.ZodType<BlueprintValue>>;
export const blueprintValueSchema = (type: DataType): z.ZodType<BlueprintValue> => SCHEMAS[type];
export const ScalarValueSchema: z.ZodType<ScalarValue> = z.union([finite, z.boolean(), SCALAR_SCHEMAS.string, SCALAR_SCHEMAS.vector3]);

const SCALAR_DEFAULTS: { [T in ScalarType]: () => ScalarValueOf<T> } = { number: () => 0, integer: () => 0, boolean: () => false, string: () => '', vector3: () => [0, 0, 0] };
export const defaultBlueprintValue = <T extends DataType>(type: T): ValueOf<T> =>
 (isListType(type) ? [] : SCALAR_DEFAULTS[type as ScalarType]()) as ValueOf<T>;

const tooLong = (value: unknown) => (typeof value === 'string' && value.length > MAX_BLUEPRINT_STRING_LENGTH) || (Array.isArray(value) && value.length > MAX_BLUEPRINT_LIST_LENGTH);
export function blueprintValueProblem(type: DataType, value: unknown): 'type' | 'limit' | null {
 if (SCHEMAS[type].safeParse(value).success) return null;
 const items = isListType(type) && Array.isArray(value) ? value : [];
 return tooLong(value) || items.some(tooLong) ? 'limit' : 'type';
}
export const isBlueprintValue = (type: DataType, value: unknown): boolean => SCHEMAS[type].safeParse(value).success;

// The one connection rule: equal types, or an integer output into a number (float) input.
export const canConnect = (output: PortType, input: PortType): boolean => output === input || (output === 'integer' && input === 'number');
