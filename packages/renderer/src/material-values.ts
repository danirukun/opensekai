import type { Color, Material, Object3D } from 'three';
import { MATERIAL_PARAMETERS, type AssetMaterial, type MaterialParameterSpec, type MaterialValues } from '@opensekai/contracts';

// B38 R28: the saved material values of a character or a prop, written to the three.js materials of each record material.
type Field = Color | number;
type Live = Material & Record<string, unknown> & { isOutline?: boolean };
interface Target { material: Live; outline: boolean; model: Map<string, Field> }
interface Bound { record: AssetMaterial; targets: Target[] }
export interface MaterialBinding {
 /** Writes each saved value. A parameter that leaves the group gets its model value again. Call it after the expression update. */
 apply(values: Readonly<Record<string, MaterialValues>> | undefined): void;
}

const OUTLINE = new Set(['outlineColor', 'outlineWidth']);
// Duck typing: `three` and `three/webgpu` can give two Color classes. A Color field is an object, a number field a number.
const fieldOf = (material: Live, field: string): Field | undefined => {
 const value = material[field];
 return (value as Color | null)?.isColor === true ? value as Color : typeof value === 'number' ? value : undefined;
};
// A VRM 0 Unlit material loads as MToon with the shade color equal to the base color (three-vrm v0compat), so a Base Color
// write also writes the shade color. Else the shaded side keeps the old color.
const shadeFollows = (record: AssetMaterial, material: Live) => record.profile === 'unlit' && typeof fieldOf(material, 'shadeColorFactor') === 'object';
const fieldsFor = (record: AssetMaterial, target: Target, spec: MaterialParameterSpec): string[] =>
 spec.key === 'baseColor' && shadeFollows(record, target.material) ? [spec.field, 'shadeColorFactor'] : [spec.field];
const write = (material: Live, field: string, value: string | number) => {
 const current = fieldOf(material, field);
 if (typeof current === 'object' && typeof value === 'string') current.setHex(parseInt(value.slice(1), 16));
 else if (typeof current === 'number' && typeof value === 'number') material[field] = value;
};
const restore = (target: Target, field: string) => {
 const model = target.model.get(field), current = fieldOf(target.material, field);
 if (typeof model === 'object' && typeof current === 'object') current.copy(model);
 else if (typeof model === 'number') target.material[field] = model;
};

/**
 * A prop or environment instance gets its own copy of each unlit material, so a saved value changes one instance only. The
 * environment light copies the lit materials (`createEnvironmentLight`), so no material is copied twice.
 */
export function copyUnlitMaterials(root: Object3D, isLit: (material: Material) => boolean): { originals: ReadonlyMap<Material, Material>; dispose(): void } {
 const copies = new Map<Material, Material>();
 const copy = (material: Material) => {
  if (isLit(material)) return material;
  let made = copies.get(material);
  if (!made) { made = material.clone(); copies.set(material, made); }
  return made;
 };
 root.traverse(object => {
  const holder = object as { material?: Material | Material[] };
  if (Array.isArray(holder.material)) holder.material = holder.material.map(copy);
  else if (holder.material) holder.material = copy(holder.material);
 });
 return { originals: new Map([...copies].map(([material, made]) => [made, material])), dispose() { for (const made of copies.values()) made.dispose(); copies.clear(); } };
}

/**
 * Binds the record materials to the three.js materials under `root`. `indexOf` gives the glTF material index of a loaded
 * material (`parser.associations`); `originals` maps an instance copy to its loaded material. The MToon outline clone of
 * a material has no index: it is the outline of the first material of its mesh.
 */
export function createMaterialBinding(records: readonly AssetMaterial[], root: Object3D, indexOf: (material: Material) => number | undefined, originals: ReadonlyMap<Material, Material> = new Map()): MaterialBinding {
 const byIndex = new Map(records.map(record => [record.index, record]));
 const bound = new Map<string, Bound>();
 const seen = new Set<Material>();
 const index = (material: Material) => indexOf(originals.get(material) ?? material);
 root.traverse(object => {
  const value = (object as { material?: Material | Material[] }).material;
  const list = (Array.isArray(value) ? value : value ? [value] : []) as Live[];
  for (const material of list) {
   if (seen.has(material)) continue;
   const outline = material.isOutline === true;
   const at = index(material) ?? (outline ? index(list.find(item => item.isOutline !== true) ?? material) : undefined);
   const record = at === undefined ? undefined : byIndex.get(at);
   if (!record) continue;
   seen.add(material);
   const model = new Map<string, Field>();
   for (const field of [...MATERIAL_PARAMETERS.map(spec => spec.field), 'shadeColorFactor']) {
    const current = fieldOf(material, field);
    if (current !== undefined) model.set(field, typeof current === 'object' ? current.clone() : current);
   }
   const entry = bound.get(record.name) ?? { record, targets: [] };
   entry.targets.push({ material, outline, model });
   bound.set(record.name, entry);
  }
 });
 // The parameters written by the last apply, by material name, so a removed one gets its model value once.
 let applied = new Map<string, Set<string>>();
 return {
  apply(values) {
   const next = new Map<string, Set<string>>();
   for (const [name, { record, targets }] of bound) {
    const saved = values && Object.hasOwn(values, name) ? values[name]! : undefined;
    const keys = new Set<string>();
    for (const spec of MATERIAL_PARAMETERS) {
     // A saved value of a parameter that does not apply to this record (a model change, or an MCP patch) is not written:
     // for example Opacity on a MASK material multiplies the alpha before the alpha test. The record of a binding does
     // not change, so a parameter that does not apply is never in `applied` and needs no restore.
     const value = spec.applies(record) ? saved?.[spec.key] : undefined;
     if (value === undefined) {
      if (applied.get(name)?.has(spec.key)) for (const target of targets) for (const field of fieldsFor(record, target, spec)) restore(target, field);
      continue;
     }
     keys.add(spec.key);
     // Outline parameters go to the outline clone only.
     for (const target of targets) if (!OUTLINE.has(spec.key) || target.outline) for (const field of fieldsFor(record, target, spec)) write(target.material, field, value);
    }
    if (keys.size) next.set(name, keys);
   }
   applied = next;
  },
 };
}
