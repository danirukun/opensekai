import { expect, it } from 'vitest';
import { z } from 'zod';
import { MaterialGroupSchema, MaterialValuesSchema, ParamSchemas, PatchOpSchema, SceneReplaceInputSchema, savedMaterialValue, withMaterialValue } from '../src/index';

it('accepts a group of values in range and rejects empty, out-of-range, and unknown values (R19)', () => {
 expect(MaterialGroupSchema.safeParse({ Body: { baseColor: '#ff8000', opacity: 0.5 }, Hair: { outlineWidth: 0.05, emissionStrength: 100 } }).success).toBe(true);
 expect(MaterialGroupSchema.safeParse({}).success).toBe(true);
 for (const values of [{}, { baseColor: '#FF8000' }, { baseColor: '#abc' }, { opacity: 1.5 }, { opacity: -0.1 }, { emissionStrength: 101 }, { outlineWidth: 0.06 }, { metallic: 0.5 }, { shadeColor: 1 }, { opacity: '1' }])
  expect(MaterialValuesSchema.safeParse(values).success, JSON.stringify(values)).toBe(false);
 expect(MaterialGroupSchema.safeParse({ '': { opacity: 1 } }).success).toBe(false);
 expect(MaterialGroupSchema.safeParse({ ['x'.repeat(65)]: { opacity: 1 } }).success).toBe(false);
 expect(MaterialGroupSchema.safeParse(Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`M${i}`, { opacity: 1 }]))).success).toBe(true);
 expect(MaterialGroupSchema.safeParse(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`M${i}`, { opacity: 1 }]))).success).toBe(false);
});

it('parses the setMaterialValues op (R20)', () => {
 expect(PatchOpSchema.safeParse({ kind: 'setMaterialValues', entityId: 'performer', materials: {} }).success).toBe(true);
 expect(PatchOpSchema.safeParse({ kind: 'setMaterialValues', entityId: 'performer', materials: { Body: {} } }).success).toBe(false);
 expect(PatchOpSchema.safeParse({ kind: 'setMaterialValues', entityId: 'performer' }).success).toBe(false);
});

it('sets and removes one value and drops empty groups', () => {
 const group = withMaterialValue(undefined, 'Body', 'baseColor', '#ff0000');
 expect(group).toEqual({ Body: { baseColor: '#ff0000' } });
 expect(withMaterialValue(group, 'Body', 'opacity', 0.5)).toEqual({ Body: { baseColor: '#ff0000', opacity: 0.5 } });
 expect(withMaterialValue(group, 'Body', 'baseColor', null)).toEqual({});
 expect(withMaterialValue(group, 'Hair', 'opacity', null)).toEqual(group);
 // A material name can be any text, also an Object prototype key.
 const proto = withMaterialValue(undefined, '__proto__', 'rimColor', '#000000');
 expect(Object.keys(proto)).toEqual(['__proto__']);
 expect(savedMaterialValue(proto, '__proto__', 'rimColor')).toBe('#000000');
 expect(savedMaterialValue(group, 'constructor', 'baseColor')).toBeUndefined();
 expect(group).toEqual({ Body: { baseColor: '#ff0000' } });
});

it('keeps a material named __proto__ as an own key through a parse', () => {
 const parsed = MaterialGroupSchema.parse(JSON.parse('{"__proto__":{"opacity":0.5},"Body":{"baseColor":"#000000"}}'));
 expect(Object.keys(parsed)).toEqual(['__proto__', 'Body']);
 expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
 expect(MaterialGroupSchema.safeParse([]).success).toBe(false);
 expect(MaterialGroupSchema.safeParse(null).success).toBe(false);
});

it('gives the MCP input schemas of scene_patch and scene_replace a JSON Schema for the saved values (R30)', () => {
 // The MCP SDK lists each tool with the JSON Schema of its input; a type that has no JSON Schema breaks tools/list.
 expect(JSON.stringify(z.toJSONSchema(ParamSchemas.scenePatch, { io: 'input' }))).toContain('"setMaterialValues"');
 expect(() => z.toJSONSchema(SceneReplaceInputSchema, { io: 'input' })).not.toThrow();
 const group = z.toJSONSchema(MaterialGroupSchema, { io: 'input' }) as { type?: string; maxProperties?: number; additionalProperties?: { properties?: object } };
 expect(group.type).toBe('object');
 expect(group.maxProperties).toBe(256);
 expect(Object.keys(group.additionalProperties?.properties ?? {})).toContain('baseColor');
});
