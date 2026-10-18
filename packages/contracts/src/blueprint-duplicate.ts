import type { BlueprintGraph } from './blueprint';
import { nodeDefinition, type BlueprintNode } from './blueprint-nodes';

const MAX_NAME = 128;
const SEEDS = [0x811c9dc5, 0x050c5d1f, 0x2b7e1516, 0x6a09e667] as const;
const fnv1a = (text: string, basis: number) => {
 let hash = basis >>> 0;
 for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
 return hash;
};
// A 32-hex-digit ID from four FNV-1a hashes of the seed and the old ID, so every client and the session derive the same copy.
export const derivedId = (seed: string, id: string): string =>
 SEEDS.map(basis => fnv1a(`${seed}\u0000${id}`, basis).toString(16).padStart(8, '0')).join('');

// The longest start of `text` within `units` UTF-16 code units that does not split a surrogate pair.
const cut = (text: string, units: number) => {
 let out = '';
 for (const point of text) { if (out.length + point.length > units) break; out += point; }
 return out;
};
export function copyName(name: string, taken: readonly string[]): string {
 for (let n = 1; ; n++) {
  const suffix = n === 1 ? ' copy' : ` copy ${n}`;
  const candidate = `${cut(name, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
  if (!taken.includes(candidate)) return candidate;
 }
}

// A copy of the node whose `graph` fields name `from` name `to` instead (a Blueprint control node that targets its own graph).
export function retargetGraph<N extends BlueprintNode>(node: N, from: string, to: string): N {
 const keys = nodeDefinition(node.type).fields.flatMap(field => (field.kind === 'graph' && (node.settings as Record<string, unknown>)[field.key] === from ? [field.key] : []));
 return keys.length === 0 ? node : { ...node, settings: { ...node.settings, ...Object.fromEntries(keys.map(key => [key, to])) } };
}

// Node, wire, and comment IDs are new; a node that targets the graph itself targets the copy; variable IDs are local to the graph and node settings refer to them, so they stay.
export function duplicateGraph(graph: BlueprintGraph, newGraphId: string, name: string): BlueprintGraph {
 const id = (old: string) => derivedId(newGraphId, old);
 const copy = structuredClone(graph);
 return {
  ...copy,
  id: newGraphId,
  name,
  enabled: false,
  nodes: copy.nodes.map(node => retargetGraph({ ...node, id: id(node.id) }, graph.id, newGraphId)),
  connections: copy.connections.map(wire => ({ ...wire, id: id(wire.id), sourceNodeId: id(wire.sourceNodeId), targetNodeId: id(wire.targetNodeId) })),
  ...(copy.comments ? { comments: copy.comments.map(comment => ({ ...comment, id: id(comment.id) })) } : {}),
 };
}
