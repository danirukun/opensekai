import type { BlueprintComment, BlueprintConnection, BlueprintGraph, BlueprintNode, BlueprintOp } from '@opensekai/contracts';

export interface BlueprintClipboard { nodes: BlueprintNode[]; connections: BlueprintConnection[]; comments?: BlueprintComment[] }
export function copyNodes(graph: BlueprintGraph, ids: readonly string[], commentIds: readonly string[] = []): BlueprintClipboard | null {
 const chosen = new Set(ids), notes = new Set(commentIds);
 const nodes = graph.nodes.filter(node => chosen.has(node.id));
 const comments = (graph.comments ?? []).filter(comment => notes.has(comment.id));
 if (nodes.length === 0 && comments.length === 0) return null;
 return structuredClone({ nodes, connections: graph.connections.filter(wire => chosen.has(wire.sourceNodeId) && chosen.has(wire.targetNodeId)), comments });
}
const corner = (clip: BlueprintClipboard) => {
 const points = [...clip.nodes, ...(clip.comments ?? [])].map(item => item.position);
 return { x: Math.min(...points.map(point => point.x)), y: Math.min(...points.map(point => point.y)) };
};
export const duplicateAnchor = (clip: BlueprintClipboard) => { const { x, y } = corner(clip); return { x: x + 24, y: y + 24 }; };
// The top-left corner of the copied nodes and comments lands on the anchor.
export function pasteOps(clip: BlueprintClipboard, graphId: string, anchor: { x: number; y: number }, newId: () => string = () => crypto.randomUUID()): { ops: BlueprintOp[]; nodeIds: string[]; commentIds: string[] } {
 const origin = corner(clip), ids = new Map(clip.nodes.map(node => [node.id, newId()] as const));
 const shift = (position: { x: number; y: number }) => ({ x: anchor.x + position.x - origin.x, y: anchor.y + position.y - origin.y });
 const nodes = clip.nodes.map(node => ({ ...structuredClone(node), id: ids.get(node.id)!, position: shift(node.position) }));
 const wires = clip.connections.map(wire => ({ ...wire, id: newId(), sourceNodeId: ids.get(wire.sourceNodeId)!, targetNodeId: ids.get(wire.targetNodeId)! }));
 const comments = (clip.comments ?? []).map(comment => ({ ...structuredClone(comment), id: newId(), position: shift(comment.position) }));
 return {
  ops: [...nodes.map(node => ({ kind: 'addNode' as const, graphId, node })), ...wires.map(connection => ({ kind: 'connect' as const, graphId, connection })), ...comments.map(comment => ({ kind: 'addComment' as const, graphId, comment }))],
  nodeIds: nodes.map(node => node.id), commentIds: comments.map(comment => comment.id),
 };
}
