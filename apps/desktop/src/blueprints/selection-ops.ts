import type { BlueprintGraph, BlueprintOp } from '@opensekai/contracts';

export const deleteOps = (graph: BlueprintGraph, nodeIds: readonly string[], commentIds: readonly string[] = []): BlueprintOp[] => [
 ...graph.nodes.filter(node => nodeIds.includes(node.id)).map(node => ({ kind: 'removeNode' as const, graphId: graph.id, nodeId: node.id })),
 ...(graph.comments ?? []).filter(comment => commentIds.includes(comment.id)).map(comment => ({ kind: 'removeComment' as const, graphId: graph.id, commentId: comment.id })),
];
export const disconnectOps = (graph: BlueprintGraph, nodeIds: readonly string[]): BlueprintOp[] =>
 graph.connections.filter(wire => nodeIds.includes(wire.sourceNodeId) || nodeIds.includes(wire.targetNodeId)).map(wire => ({ kind: 'disconnect', graphId: graph.id, connectionId: wire.id }));
