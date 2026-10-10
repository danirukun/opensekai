import type { BlueprintConnection, BlueprintGraph, BlueprintNode, BlueprintOp } from '@opensekai/contracts';

export interface BlueprintClipboard { nodes: BlueprintNode[]; connections: BlueprintConnection[] }
export function copyNodes(graph: BlueprintGraph, ids: readonly string[]): BlueprintClipboard | null {
 const chosen = new Set(ids);
 const nodes = graph.nodes.filter(node => chosen.has(node.id));
 if (nodes.length === 0) return null;
 return structuredClone({ nodes, connections: graph.connections.filter(wire => chosen.has(wire.sourceNodeId) && chosen.has(wire.targetNodeId)) });
}
const corner = (clip: BlueprintClipboard) => ({ x: Math.min(...clip.nodes.map(node => node.position.x)), y: Math.min(...clip.nodes.map(node => node.position.y)) });
export const duplicateAnchor = (clip: BlueprintClipboard) => { const { x, y } = corner(clip); return { x: x + 24, y: y + 24 }; };
// The top-left corner of the copied nodes lands on the anchor.
export function pasteOps(clip: BlueprintClipboard, graphId: string, anchor: { x: number; y: number }, newId: () => string = () => crypto.randomUUID()): { ops: BlueprintOp[]; nodeIds: string[] } {
 const origin = corner(clip), ids = new Map(clip.nodes.map(node => [node.id, newId()] as const));
 const nodes = clip.nodes.map(node => ({ ...structuredClone(node), id: ids.get(node.id)!, position: { x: anchor.x + node.position.x - origin.x, y: anchor.y + node.position.y - origin.y } }));
 const wires = clip.connections.map(wire => ({ ...wire, id: newId(), sourceNodeId: ids.get(wire.sourceNodeId)!, targetNodeId: ids.get(wire.targetNodeId)! }));
 return { ops: [...nodes.map(node => ({ kind: 'addNode' as const, graphId, node })), ...wires.map(connection => ({ kind: 'connect' as const, graphId, connection }))], nodeIds: nodes.map(node => node.id) };
}
