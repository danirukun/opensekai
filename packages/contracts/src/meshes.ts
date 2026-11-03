import { z } from 'zod';

// Character mesh toggles (B26). Keep `meshEntries` in step with `vrm_meshes` in the desktop host; `fixtures/protocol/mesh-names.json` pins both.
export const MAX_MESHES = 256;
export const MAX_MESH_NAME = 128;
export const MAX_NODE_MESHES = 16;
export interface AssetMesh { node: number; name: string }
export interface MeshView { name: string; hidden: boolean }
export interface MeshList { meshes: MeshView[]; unknown: string[] }

const unique = (names: readonly string[]) => new Set(names).size === names.length;
// A refine, not `max`: the limit counts UTF-16 code units, as the Rust check does.
export const MeshNameSchema = z.string().refine(name => name.length >= 1 && name.length <= MAX_MESH_NAME, 'Invalid mesh name');
export const HiddenMeshesSchema = z.array(MeshNameSchema).max(MAX_MESHES).refine(unique, 'Duplicate mesh name');
export const AssetMeshSchema = z.strictObject({ node: z.number().int().nonnegative().max(0xffffffff), name: MeshNameSchema });
export const AssetMeshesSchema = z.array(AssetMeshSchema).max(MAX_MESHES).refine(list => unique(list.map(entry => entry.name)), 'Duplicate mesh name');
export const NodeMeshesSchema = z.array(MeshNameSchema).min(1).max(MAX_NODE_MESHES).refine(unique, 'Duplicate mesh name');
export const MeshListSchema = z.strictObject({ meshes: z.array(z.strictObject({ name: MeshNameSchema, hidden: z.boolean() })).max(MAX_MESHES), unknown: z.array(MeshNameSchema).max(MAX_MESHES) });

// The ECMAScript `trim` set. Rust trims the same set (it is not `char::is_whitespace`: U+FEFF is in, U+0085 is out).
const trimmed = (name: string) => name.trim();
// The first `units` UTF-16 code units, without half of a surrogate pair at the end.
const cut = (name: string, units: number) => {
 if (name.length <= units) return name;
 const end = /[\uD800-\uDBFF]/.test(name[units - 1] ?? '') ? units - 1 : units;
 return name.slice(0, end);
};

// R1: the glTF nodes that have a mesh, in node order, each with a unique name of at most 128 units. The list keeps the first 256.
export const meshEntries = (json: unknown): AssetMesh[] => {
 const nodes = typeof json === 'object' && json !== null && Array.isArray((json as { nodes?: unknown }).nodes) ? (json as { nodes: unknown[] }).nodes : [];
 const taken = new Set<string>();
 const entries: AssetMesh[] = [];
 for (const [node, value] of nodes.entries()) {
  if (entries.length >= MAX_MESHES) break;
  if (typeof value !== 'object' || value === null || typeof (value as { mesh?: unknown }).mesh !== 'number') continue;
  const raw = (value as { name?: unknown }).name;
  const base = cut(trimmed(typeof raw === 'string' ? raw : '') || `Mesh ${node}`, MAX_MESH_NAME);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${cut(base, MAX_MESH_NAME - ` (${n})`.length)} (${n})`;
  taken.add(name);
  entries.push({ node, name });
 }
 return entries;
};
const once = (names: readonly string[]) => [...new Set(names)];
// Each edit keeps the order of the current list and adds new names at the end. A repeated input name has one effect.
export const toggleMeshes = (hidden: readonly string[], names: readonly string[]): string[] => {
 const flip = new Set(names);
 return [...hidden.filter(name => !flip.has(name)), ...once(names).filter(name => !hidden.includes(name))];
};
export const setMeshesVisible = (hidden: readonly string[], names: readonly string[], visible: boolean): string[] =>
 visible ? hidden.filter(name => !names.includes(name)) : [...hidden, ...once(names).filter(name => !hidden.includes(name))];

// `meshList` (R13): the record meshes in record order with their state, and the hidden names that the record does not have.
export const meshList = (meshes: readonly AssetMesh[], hidden: readonly string[] = []): MeshList => {
 const known = new Set(meshes.map(mesh => mesh.name));
 return { meshes: meshes.map(mesh => ({ name: mesh.name, hidden: hidden.includes(mesh.name) })), unknown: hidden.filter(name => !known.has(name)) };
};
