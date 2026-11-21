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
// A saved group of values for one material (B38 R19): at least one parameter.
export type MaterialValues = MaterialModel;
// R30: `value` is the saved value; `unknown` lists the saved names that the record does not have.
export interface MaterialParameterView { parameter: MaterialParameter; model: string | number; value?: string | number }
export interface MaterialList { materials: { name: string; profile: MaterialProfile; parameters: MaterialParameterView[] }[]; unknown: string[] }

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
// R19: the saved values of a character or a prop, by material name. An empty group is not stored.
export const MaterialValuesSchema = MaterialModelSchema.refine(values => Object.keys(values).length > 0, 'Empty material values');
// Not `z.record`: it drops a key named `__proto__`, and a model can name a material so. The output keeps each own key.
const plainObject = (value: unknown): value is Record<string, unknown> =>
 typeof value === 'object' && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const isGroup = (value: unknown): value is Record<string, MaterialValues> => plainObject(value) && Object.keys(value).length <= MAX_MATERIALS
 && Object.entries(value).every(([name, values]) => MaterialNameSchema.safeParse(name).success && MaterialValuesSchema.safeParse(values).success);
const { $schema: _draft, ...valuesJsonSchema } = z.toJSONSchema(MaterialModelSchema);
// Not `z.custom` either: it has no JSON Schema, and the MCP SDK lists each tool with the JSON Schema of its input (R30).
// The refine checks the value; the metadata gives the JSON Schema of the same shape.
export const MaterialGroupSchema = z.unknown().refine(isGroup, 'Invalid material values')
 .meta({ type: 'object', maxProperties: MAX_MATERIALS, propertyNames: { type: 'string', minLength: 1, maxLength: MAX_MATERIAL_NAME }, additionalProperties: { ...valuesJsonSchema, minProperties: 1 } })
 .transform(group => Object.fromEntries(Object.entries(group as Record<string, MaterialValues>).map(([name, values]) => [name, MaterialValuesSchema.parse(values)])));
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
  parameters: z.array(z.strictObject({ parameter: MaterialParameterSchema, model: z.union([MaterialColorSchema, z.number()]), value: z.union([MaterialColorSchema, z.number()]).optional() })).max(MATERIAL_PARAMETERS.length),
 })).max(MAX_MATERIALS),
 unknown: z.array(MaterialNameSchema).max(MAX_MATERIALS),
});

// `materialList` (R18, R30): the record materials in record order, each with the model value of each parameter that applies
// and the saved value, then the saved names that the record does not have.
export const materialList = (materials: readonly AssetMaterial[], saved?: Readonly<Record<string, MaterialValues>>): MaterialList => ({
 materials: materials.map(m => ({
  name: m.name,
  profile: m.profile,
  parameters: appliedParameters(m).flatMap(spec => {
   const model = m.model[spec.key], value = savedMaterialValue(saved, m.name, spec.key);
   return model === undefined ? [] : [{ parameter: spec.key, model, ...(value === undefined ? {} : { value }) }];
  }),
 })),
 unknown: Object.keys(saved ?? {}).filter(name => !materials.some(m => m.name === name)),
});
/** R30: the parameters for `opensekai://blueprint-nodes`: label, type, range, the profiles they apply to, and a need for blend or outline. */
export const materialParameterCatalog = () => MATERIAL_PARAMETERS.map(spec => ({
 key: spec.key,
 label: spec.label,
 type: spec.type,
 ...(spec.type === 'number' ? { range: spec.range } : {}),
 default: spec.defaultValue,
 profiles: MaterialProfileSchema.options.filter(profile => spec.applies({ profile, blend: true, outline: profile === 'mtoon' })),
 ...(spec.applies({ profile: 'mtoon', blend: false, outline: true }) ? {} : { requires: 'blend' }),
 ...(spec.applies({ profile: 'mtoon', blend: true, outline: false }) ? {} : { requires: 'outline' }),
}));

// The saved group with one parameter set, or removed when `value` is null. Empty groups and an empty result are dropped.
// Entries, not property writes: a model can name a material `__proto__`.
// A changed name and a changed parameter keep their place, so a write of the same value gives the same JSON.
export function withMaterialValue(group: Readonly<Record<string, MaterialValues>> | undefined, name: string, parameter: MaterialParameter, value: string | number | null): Record<string, MaterialValues> {
 const entries = Object.entries(group ?? {});
 const own = entries.find(([key]) => key === name)?.[1];
 let values: MaterialValues;
 if (value === null) { const { [parameter]: _old, ...rest } = own ?? {}; values = rest; } else values = { ...own, [parameter]: value };
 const empty = Object.keys(values).length === 0;
 const next = own ? entries.flatMap(([key, item]) => key !== name ? [[key, item] as const] : empty ? [] : [[key, values] as const]) : empty ? entries : [...entries, [name, values] as const];
 return Object.fromEntries(next);
}
/** The saved value of a parameter, or undefined. */
export const savedMaterialValue = (group: Readonly<Record<string, MaterialValues>> | undefined, name: string, parameter: MaterialParameter): string | number | undefined =>
 group && Object.hasOwn(group, name) ? group[name]![parameter] : undefined;
