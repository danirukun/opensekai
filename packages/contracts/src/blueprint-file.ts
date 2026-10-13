import { z } from 'zod';
import { BlueprintGraphSchema, type BlueprintGraph } from './blueprint';
import { BLUEPRINT_LABELS, nodeDefinition, type BlueprintNode } from './blueprint-nodes';
import type { ErrorCode, Id, Reply, SceneEntity, SceneView } from './types';

export const BLUEPRINT_FILE_FORMAT = 'opensekai.blueprint';
export const MAX_BLUEPRINT_FILE_BYTES = 1024 * 1024;
const REFERENCE_KINDS = ['avatar', 'mesh', 'camera', 'output', 'unknown'] as const;
export const BlueprintReferenceSchema = z.strictObject({ id: z.string().min(1).max(256), kind: z.enum(REFERENCE_KINDS), name: z.string().min(1).max(256) });
export const BlueprintFileSchema = z.strictObject({
 format: z.literal(BLUEPRINT_FILE_FORMAT),
 formatVersion: z.literal(1),
 graph: BlueprintGraphSchema,
 references: z.array(BlueprintReferenceSchema).max(64),
}).refine(file => new Set(file.references.map(entry => entry.id)).size === file.references.length, 'Duplicate reference ID');
export type BlueprintReference = z.infer<typeof BlueprintReferenceSchema>;
export type BlueprintFile = z.infer<typeof BlueprintFileSchema>;
type ReferenceKind = BlueprintReference['kind'];
export interface BlueprintImportReport {
 graphId: Id; enabled: boolean;
 remapped: { name: string; kind: ReferenceKind; from: Id; to: Id }[];
 missing: { name: string; kind: ReferenceKind; id: Id; nodeIds: Id[] }[];
}
export interface BlueprintImport { graph: BlueprintGraph; report: BlueprintImportReport }

type FieldKind = 'entity' | 'camera' | 'output';
interface Use { nodeId: Id; key: string; kind: FieldKind; value: Id }
const isFieldKind = (kind: string): kind is FieldKind => kind === 'entity' || kind === 'camera' || kind === 'output';
// Each value of an entity, camera, or output field, in node order and then catalog field order.
const uses = (graph: BlueprintGraph): Use[] => graph.nodes.flatMap(node => nodeDefinition(node.type).fields.flatMap(field => {
 const value = (node.settings as Record<string, unknown>)[field.key];
 return isFieldKind(field.kind) && typeof value === 'string' ? [{ nodeId: node.id, key: field.key, kind: field.kind, value }] : [];
}));
const referable = (entity: SceneEntity): entity is Exclude<SceneEntity, { kind: 'tracking' }> => entity.kind !== 'tracking';
const accepts = (kind: Exclude<FieldKind, 'output'>, entity: SceneEntity) => kind === 'camera' ? entity.kind === 'camera' : referable(entity);

export function exportBlueprint(graph: BlueprintGraph, scene: SceneView): BlueprintFile {
 const references = new Map<Id, BlueprintReference>();
 for (const use of uses(graph)) {
  if (references.has(use.value)) continue;
  const entity = use.kind === 'output' ? undefined : scene.entities.find(item => item.id === use.value && referable(item));
  const output = use.kind === 'output' && scene.outputs.some(item => item.id === use.value);
  references.set(use.value, entity && referable(entity) ? { id: use.value, kind: entity.kind, name: entity.name }
   : output ? { id: use.value, kind: 'output', name: use.value }
   : { id: use.value, kind: 'unknown', name: use.value });
 }
 return { format: BLUEPRINT_FILE_FORMAT, formatVersion: 1, graph: structuredClone(graph), references: [...references.values()] };
}
export const serializeBlueprintFile = (file: BlueprintFile): string => `${JSON.stringify(file, null, 2)}\n`;

const NOT_OURS = 'Not an OpenSekai Blueprint file';
const fail = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function unknownNodes(graph: unknown): { types: string[]; nodeIds: Id[] } {
 const nodes = isRecord(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
 const types: string[] = [], nodeIds: Id[] = [];
 for (const node of nodes) {
  if (!isRecord(node) || typeof node.type !== 'string' || Object.hasOwn(BLUEPRINT_LABELS, node.type)) continue;
  if (!types.includes(node.type)) types.push(node.type);
  if (typeof node.id === 'string') nodeIds.push(node.id);
 }
 return { types, nodeIds };
}

export function importBlueprint(input: unknown, scene: SceneView, newId: () => Id): Reply<BlueprintImport> {
 const text = typeof input === 'string' ? input.replace(/^﻿/, '') : JSON.stringify(input) ?? '';
 if (new TextEncoder().encode(text).length > MAX_BLUEPRINT_FILE_BYTES) return fail('INVALID_INPUT', 'Blueprint file is too large');
 let raw: unknown = input;
 if (typeof input === 'string') { try { raw = JSON.parse(text); } catch { return fail('INVALID_INPUT', NOT_OURS); } }
 if (!isRecord(raw) || raw.format !== BLUEPRINT_FILE_FORMAT) return fail('INVALID_INPUT', NOT_OURS);
 const version = raw.formatVersion;
 if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return fail('INVALID_INPUT', NOT_OURS);
 if (version > 1) return fail('VERSION_MISMATCH', 'Blueprint file needs a newer OpenSekai');
 const unknown = unknownNodes(raw.graph);
 if (unknown.types.length > 0) return fail('UNSUPPORTED', `Unknown node types: ${unknown.types.slice(0, 5).join(', ')}`, unknown.nodeIds);
 const parsed = BlueprintFileSchema.safeParse(raw);
 if (!parsed.success) return fail('INVALID_INPUT', parsed.error.issues[0]?.message ?? NOT_OURS);
 return { ok: true, data: resolveReferences(parsed.data, scene, newId()) };
}

function resolveReferences(file: BlueprintFile, scene: SceneView, graphId: Id): BlueprintImport {
 const all = uses(file.graph), entries = new Map(file.references.map(entry => [entry.id, entry]));
 const targets = new Map<Id, Id>();
 const report: BlueprintImportReport = { graphId, enabled: false, remapped: [], missing: [] };
 for (const value of new Set(all.map(use => use.value))) {
  const mine = all.filter(use => use.value === value), kinds = [...new Set(mine.map(use => use.kind))];
  const entry: BlueprintReference = entries.get(value) ?? { id: value, kind: 'unknown', name: value };
  const fits = (entity: SceneEntity) => kinds.every(kind => kind !== 'output' && accepts(kind, entity));
  const byId = kinds.every(kind => kind === 'output' ? scene.outputs.some(item => item.id === value) : scene.entities.some(item => item.id === value && accepts(kind, item)));
  if (byId) continue;
  const byName = entry.kind === 'output' || entry.kind === 'unknown' ? [] : scene.entities.filter(item => item.kind === entry.kind && item.name === entry.name && fits(item));
  if (byName.length === 1) {
   targets.set(value, byName[0]!.id);
   report.remapped.push({ name: entry.name, kind: entry.kind, from: value, to: byName[0]!.id });
  } else report.missing.push({ name: entry.name, kind: entry.kind, id: value, nodeIds: [...new Set(mine.map(use => use.nodeId))] });
 }
 const nodes = file.graph.nodes.map(node => {
  const changed = all.filter(use => use.nodeId === node.id && targets.has(use.value));
  return changed.length === 0 ? node : { ...node, settings: { ...node.settings, ...Object.fromEntries(changed.map(use => [use.key, targets.get(use.value)!])) } } as BlueprintNode;
 });
 report.enabled = file.graph.enabled && report.missing.length === 0;
 return { graph: { ...structuredClone(file.graph), id: graphId, enabled: report.enabled, nodes: structuredClone(nodes) }, report };
}
