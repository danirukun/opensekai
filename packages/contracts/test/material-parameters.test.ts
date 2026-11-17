import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/material-names.json';
import { AssetMaterialsSchema, AssetRecordSchema, MATERIAL_PARAMETERS, appliedParameters, linearHex, materialEntries, type MaterialShape } from '../src';

for (const vector of vectors.cases)
 it(`material vector: ${vector.name}`, () => {
  const entries = materialEntries(vector.json);
  expect(entries).toEqual(vector.expected);
  expect(AssetMaterialsSchema.safeParse(entries).success).toBe(true);
 });

it('reads no materials from a document that is not an object', () => {
 expect(materialEntries(null)).toEqual([]);
 expect(materialEntries({ materials: 'x' })).toEqual([]);
});

it('converts a linear factor with the three.js sRGB transfer and byte rounding', () => {
 expect(linearHex([0, 1, 0.5])).toBe('#00ffbc');
 expect(linearHex([-1, 2, Number.NaN])).toBe('#00ff00');
 // Both sides of the 0.0031308 knee (expected values from three.js Color.getHexString).
 expect(linearHex([0.002, 0.0031308, 0.214])).toBe('#070a7f');
});

const keys = (shape: MaterialShape) => appliedParameters(shape).map(spec => spec.key);
it('applies each parameter by profile, blend, and outline, in R14 order', () => {
 expect(MATERIAL_PARAMETERS.map(spec => spec.label)).toEqual(['Base Color', 'Opacity', 'Emission Color', 'Emission Strength', 'Shade Color', 'Rim Color', 'Outline Color', 'Outline Width']);
 expect(keys({ profile: 'unlit', blend: false, outline: false })).toEqual(['baseColor']);
 expect(keys({ profile: 'unlit', blend: true, outline: false })).toEqual(['baseColor', 'opacity']);
 expect(keys({ profile: 'pbr', blend: false, outline: false })).toEqual(['baseColor', 'emissionColor', 'emissionStrength']);
 expect(keys({ profile: 'pbr', blend: true, outline: false })).toEqual(['baseColor', 'opacity', 'emissionColor', 'emissionStrength']);
 expect(keys({ profile: 'mtoon', blend: false, outline: false })).toEqual(['baseColor', 'emissionColor', 'emissionStrength', 'shadeColor', 'rimColor']);
 expect(keys({ profile: 'mtoon', blend: true, outline: true })).toEqual(['baseColor', 'opacity', 'emissionColor', 'emissionStrength', 'shadeColor', 'rimColor', 'outlineColor', 'outlineWidth']);
 expect(MATERIAL_PARAMETERS.map(spec => spec.defaultValue)).toEqual(['#ffffff', 1, '#000000', 1, '#ffffff', '#000000', '#000000', 0]);
});

const material = { index: 0, name: 'Body', profile: 'pbr', blend: false, outline: false, model: { baseColor: '#ffffff' } };
const record = { id: 'avatar_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'x', importerVersion: 1, name: 'A', expressions: [] };
it('checks the material list of a record', () => {
 const ok = (materials: unknown) => AssetMaterialsSchema.safeParse(materials).success;
 expect(ok([material])).toBe(true);
 expect(ok([material, { ...material, index: 1 }])).toBe(false);
 expect(ok([{ ...material, name: '' }])).toBe(false);
 expect(ok([{ ...material, name: 'x'.repeat(65) }])).toBe(false);
 expect(ok([{ ...material, model: { baseColor: '#FFFFFF' } }])).toBe(false);
 expect(ok([{ ...material, model: { opacity: 0.5 } }])).toBe(false);
 expect(ok([{ ...material, blend: true, model: { opacity: 1.5 } }])).toBe(false);
 expect(ok([{ ...material, model: { shadeColor: '#000000' } }])).toBe(false);
 expect(ok([{ ...material, outline: true }])).toBe(false);
 expect(ok([{ ...material, model: { gloss: 1 } }])).toBe(false);
 expect(ok(Array.from({ length: 257 }, (_, index) => ({ ...material, index, name: `M${index}` })))).toBe(false);
 expect(AssetRecordSchema.safeParse({ ...record, materials: [material] }).success).toBe(true);
 expect(AssetRecordSchema.safeParse({ ...record, id: 'image_1', format: 'png', image: { width: 1, height: 1, frames: 1 }, materials: [] }).success).toBe(false);
});
