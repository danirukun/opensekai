import type { BlueprintGraph } from './blueprint';

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

export function copyName(name: string, taken: readonly string[]): string {
 for (let n = 1; ; n++) {
  const suffix = n === 1 ? ' copy' : ` copy ${n}`;
  const candidate = `${name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}`;
  if (!taken.includes(candidate)) return candidate;
 }
}

// Node, wire, and comment IDs are new; variable IDs are local to the graph and node settings refer to them, so they stay.
export function duplicateGraph(graph: BlueprintGraph, newGraphId: string, name: string): BlueprintGraph {
 const id = (old: string) => derivedId(newGraphId, old);
 const copy = structuredClone(graph);
 return {
  ...copy,
  id: newGraphId,
  name,
  enabled: false,
  nodes: copy.nodes.map(node => ({ ...node, id: id(node.id) })),
  connections: copy.connections.map(wire => ({ ...wire, id: id(wire.id), sourceNodeId: id(wire.sourceNodeId), targetNodeId: id(wire.targetNodeId) })),
  ...(copy.comments ? { comments: copy.comments.map(comment => ({ ...comment, id: id(comment.id) })) } : {}),
 };
}
