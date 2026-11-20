import { z } from 'zod';
import type { MaterialProfile } from './materials';

// Material parameters (B38 R13–R14, R18). Keep in step with `AssetMaterial` in `crates/contracts/src/lib.rs`.
export const MAX_MATERIALS = 256;
export const MAX_MATERIAL_NAME = 64;
export const MATERIAL_PARAMETER_KEYS = ['baseColor', 'opacity', 'emissionColor', 'emissionStrength', 'shadeColor', 'rimColor', 'outlineColor', 'outlineWidth'] as const;
export type MaterialParameter = typeof MATERIAL_PARAMETER_KEYS[number];
export type MaterialModel = Partial<Record<MaterialParameter, string | number>>;
export interface MaterialShape { profile: MaterialProfile; blend: boolean; outline: boolean }
export interface AssetMaterial extends MaterialShape { index: number; name: string; model: MaterialModel }
export interface MaterialParameterView { parameter: MaterialParameter; model: string | number }
export interface MaterialList { materials: { name: string; profile: MaterialProfile; parameters: MaterialParameterView[] }[] }

type Spec = {
 key: MaterialParameter;
 label: string;
 /** The three.js material field that holds the value. */
 field: string;
 /** The node value when a Set has no input (R22). */
 defaultValue: string | number;
 applies: (material: MaterialShape) => boolean;
} & ({ type: 'color' } | { type: 'number'; range: readonly [number, number] });
export type MaterialParameterSpec = Readonly<Spec>;

// A liltoon material has no editable parameter.
const all = (m: MaterialShape) => m.profile !== 'liltoon';
const lit = (m: MaterialShape) => m.profile !== 'unlit' && m.profile !== 'liltoon';
const mtoon = (m: MaterialShape) => m.profile === 'mtoon';
// R14, in this order.
export const MATERIAL_PARAMETERS: readonly MaterialParameterSpec[] = [
 { key: 'baseColor', label: 'Base Color', type: 'color', field: 'color', defaultValue: '#ffffff', applies: all },
 { key: 'opacity', label: 'Opacity', type: 'number', range: [0, 1], field: 'opacity', defaultValue: 1, applies: m => m.blend && all(m) },
 { key: 'emissionColor', label: 'Emission Color', type: 'color', field: 'emissive', defaultValue: '#000000', applies: lit },
 { key: 'emissionStrength', label: 'Emission Strength', type: 'number', range: [0, 100], field: 'emissiveIntensity', defaultValue: 1, applies: lit },
 { key: 'shadeColor', label: 'Shade Color', type: 'color', field: 'shadeColorFactor', defaultValue: '#ffffff', applies: mtoon },
 { key: 'rimColor', label: 'Rim Color', type: 'color', field: 'parametricRimColorFactor', defaultValue: '#000000', applies: mtoon },
 { key: 'outlineColor', label: 'Outline Color', type: 'color', field: 'outlineColorFactor', defaultValue: '#000000', applies: m => m.outline },
 { key: 'outlineWidth', label: 'Outline Width', type: 'number', range: [0, 0.05], field: 'outlineWidthFactor', defaultValue: 0, applies: m => m.outline },
];
export const materialParameter = (key: MaterialParameter): MaterialParameterSpec => MATERIAL_PARAMETERS.find(spec => spec.key === key)!;
/** The parameters that apply to a material, in R14 order. */
export const appliedParameters = (material: MaterialShape): MaterialParameterSpec[] => MATERIAL_PARAMETERS.filter(spec => spec.applies(material));

const unique = (names: readonly string[]) => new Set(names).size === names.length;
export const MaterialColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
// A refine, not `max`: the limit counts UTF-16 code units, as the Rust check does.
export const MaterialNameSchema = z.string().refine(name => name.length >= 1 && name.length <= MAX_MATERIAL_NAME, 'Invalid material name');
export const MaterialProfileSchema = z.enum(['mtoon', 'pbr', 'unlit', 'liltoon']);
export const MaterialParameterSchema = z.enum(MATERIAL_PARAMETER_KEYS);
const valueSchema = (spec: MaterialParameterSpec) => spec.type === 'color' ? MaterialColorSchema : z.number().min(spec.range[0]).max(spec.range[1]);
export const MaterialModelSchema = z.strictObject(Object.fromEntries(MATERIAL_PARAMETERS.map(spec => [spec.key, valueSchema(spec).optional()])) as Record<MaterialParameter, z.ZodOptional<z.ZodString | z.ZodNumber>>);
export const AssetMaterialSchema = z.strictObject({
 index: z.number().int().nonnegative().max(0xffffffff),
 name: MaterialNameSchema,
 profile: MaterialProfileSchema,
 blend: z.boolean(),
 outline: z.boolean(),
 model: MaterialModelSchema,
}).refine(m => (!m.outline || m.profile === 'mtoon') && Object.keys(m.model).every(key => materialParameter(key as MaterialParameter).applies(m)), 'Material value does not apply');
export const AssetMaterialsSchema = z.array(AssetMaterialSchema).max(MAX_MATERIALS).refine(list => unique(list.map(m => m.name)), 'Duplicate material name');

export const MaterialListSchema = z.strictObject({
 materials: z.array(z.strictObject({
  name: MaterialNameSchema,
  profile: MaterialProfileSchema,
  parameters: z.array(z.strictObject({ parameter: MaterialParameterSchema, model: z.union([MaterialColorSchema, z.number()]) })).max(MATERIAL_PARAMETERS.length),
 })).max(MAX_MATERIALS),
});

// `materialList` (R18): the record materials in record order, each with the model value of each parameter that applies.
export const materialList = (materials: readonly AssetMaterial[]): MaterialList => ({
 materials: materials.map(m => ({
  name: m.name,
  profile: m.profile,
  parameters: appliedParameters(m).flatMap(spec => m.model[spec.key] === undefined ? [] : [{ parameter: spec.key, model: m.model[spec.key]! }]),
 })),
});
