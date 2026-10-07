import type { BlueprintConnection, BlueprintGraph, BlueprintNode, Id } from '@opensekai/contracts';

export interface GraphPatch {
 removeConnections: Id[]; removeNodes: Id[]; addNodes: BlueprintNode[];
 updateNodes: BlueprintNode[]; moveNodes: { id: Id; position: BlueprintNode['position'] }[]; addConnections: BlueprintConnection[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function graphPatch(previous: BlueprintGraph | undefined, next: BlueprintGraph | undefined): GraphPatch {
 const oldNodes = new Map((previous?.nodes ?? []).map(node => [node.id, node] as const));
 const newNodes = new Map((next?.nodes ?? []).map(node => [node.id, node] as const));
 const oldWires = new Map((previous?.connections ?? []).map(wire => [wire.id, wire] as const));
 const newWires = new Map((next?.connections ?? []).map(wire => [wire.id, wire] as const));
 const patch: GraphPatch = { removeConnections: [], removeNodes: [], addNodes: [], updateNodes: [], moveNodes: [], addConnections: [] };
 // A changed wire keeps its ID only when every end matches; otherwise it is removed and added again.
 for (const [id, wire] of oldWires) if (!same(wire, newWires.get(id))) patch.removeConnections.push(id);
 for (const id of oldNodes.keys()) if (!newNodes.has(id)) patch.removeNodes.push(id);
 for (const node of next?.nodes ?? []) {
  const old = oldNodes.get(node.id);
  if (!old) { patch.addNodes.push(node); continue; }
  if (old.type !== node.type || !same(old.settings, node.settings)) patch.updateNodes.push(node);
  if (!same(old.position, node.position)) patch.moveNodes.push({ id: node.id, position: node.position });
 }
 for (const wire of next?.connections ?? []) if (!same(wire, oldWires.get(wire.id))) patch.addConnections.push(wire);
 return patch;
}
