import { blueprintPorts, type BlueprintConnection, type BlueprintNode } from '@opensekai/contracts';

export interface LayoutSize { width: number; height: number }
type Point = { x: number; y: number };
export const DEFAULT_NODE_SIZE: LayoutSize = { width: 180, height: 100 };
const GAP_X = 80, GAP_Y = 40, GAP_GROUP = 80;

const byPosition = (a: BlueprintNode, b: BlueprintNode) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Weakly connected groups, each in its current vertical order; the groups also keep that order.
function groups(nodes: readonly BlueprintNode[], wires: readonly BlueprintConnection[]): BlueprintNode[][] {
 const parent = new Map(nodes.map(node => [node.id, node.id] as const));
 const root = (id: string): string => { const up = parent.get(id)!; if (up === id) return id; const top = root(up); parent.set(id, top); return top; };
 for (const wire of wires) parent.set(root(wire.sourceNodeId), root(wire.targetNodeId));
 const sets = new Map<string, BlueprintNode[]>();
 for (const node of [...nodes].sort(byPosition)) { const key = root(node.id); sets.set(key, [...(sets.get(key) ?? []), node]); }
 return [...sets.values()];
}

// Flow wires give layers by longest path; a back edge of a flow cycle is ignored.
function flowLayers(nodes: readonly BlueprintNode[], flow: readonly BlueprintConnection[]): Map<string, number> {
 const out = new Map<string, string[]>();
 for (const wire of flow) out.set(wire.sourceNodeId, [...(out.get(wire.sourceNodeId) ?? []), wire.targetNodeId]);
 const state = new Map<string, 'open' | 'done'>(), kept: [string, string][] = [];
 const visit = (id: string) => {
  state.set(id, 'open');
  for (const next of out.get(id) ?? []) {
   if (state.get(next) === 'open') continue;
   kept.push([id, next]);
   if (!state.has(next)) visit(next);
  }
  state.set(id, 'done');
 };
 const flowIds = new Set(flow.flatMap(wire => [wire.sourceNodeId, wire.targetNodeId]));
 const starts = [...nodes].filter(node => flowIds.has(node.id)).sort((a, b) => a.position.x - b.position.x || byPosition(a, b));
 for (const node of starts) if (!state.has(node.id)) visit(node.id);
 const layer = new Map<string, number>(starts.map(node => [node.id, 0] as const));
 // Longest path over the kept (acyclic) edges.
 for (let changed = true, rounds = 0; changed && rounds <= starts.length; rounds++) {
  changed = false;
  for (const [from, to] of kept) {
   const next = layer.get(from)! + 1;
   if (next > layer.get(to)!) { layer.set(to, next); changed = true; }
  }
 }
 return layer;
}

// A node without a flow wire sits one layer left of its nearest data consumer, else right of its producers, else in layer 0.
function dataLayers(nodes: readonly BlueprintNode[], data: readonly BlueprintConnection[], layer: Map<string, number>) {
 const visiting = new Set<string>();
 const place = (id: string): number => {
  const known = layer.get(id);
  if (known !== undefined) return known;
  if (visiting.has(id)) return 0;
  visiting.add(id);
  const consumers = data.filter(wire => wire.sourceNodeId === id).map(wire => place(wire.targetNodeId));
  const producers = consumers.length > 0 ? [] : data.filter(wire => wire.targetNodeId === id).map(wire => place(wire.sourceNodeId));
  const value = consumers.length > 0 ? Math.min(...consumers) - 1 : producers.length > 0 ? Math.max(...producers) + 1 : 0;
  visiting.delete(id);
  layer.set(id, value);
  return value;
 };
 for (const node of nodes) place(node.id);
}

// Positions for `nodes` in layers from left to right. The top-left corner of the set stays where it is.
export function formatLayout(nodes: readonly BlueprintNode[], connections: readonly BlueprintConnection[], sizes: ReadonlyMap<string, LayoutSize> = new Map()): Map<string, Point> {
 const result = new Map<string, Point>();
 if (nodes.length === 0) return result;
 const byId = new Map(nodes.map(node => [node.id, node] as const));
 const wires = connections.filter(wire => byId.has(wire.sourceNodeId) && byId.has(wire.targetNodeId) && wire.sourceNodeId !== wire.targetNodeId);
 const isFlow = (wire: BlueprintConnection) => blueprintPorts(byId.get(wire.sourceNodeId)!).outputs[wire.sourcePort] === 'flow';
 const size = (id: string) => sizes.get(id) ?? DEFAULT_NODE_SIZE;
 const neighbors = (id: string) => wires.flatMap(wire => wire.sourceNodeId === id ? [wire.targetNodeId] : wire.targetNodeId === id ? [wire.sourceNodeId] : []);
 const origin = { x: Math.min(...nodes.map(node => node.position.x)), y: Math.min(...nodes.map(node => node.position.y)) };
 let top = origin.y;
 for (const group of groups(nodes, wires)) {
  const ids = new Set(group.map(node => node.id));
  const mine = wires.filter(wire => ids.has(wire.sourceNodeId));
  const layer = flowLayers(group, mine.filter(isFlow));
  dataLayers(group, mine.filter(wire => !isFlow(wire)), layer);
  const low = Math.min(...layer.values());
  const columns: string[][] = [];
  for (const node of group) (columns[layer.get(node.id)! - low] ??= []).push(node.id);
  const filled = Array.from(columns, column => column ?? []);
  const xs = filled.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? origin.x : acc[i - 1]! + Math.max(DEFAULT_NODE_SIZE.width, ...filled[i - 1]!.map(id => size(id).width)) + GAP_X], []);
  const y = new Map<string, number>();
  const center = (id: string) => y.get(id)! + size(id).height / 2;
  // Each node moves toward its target top without overlap; ties keep the current vertical order.
  const stack = (column: string[], target: (id: string) => number | undefined) => {
   const keyed = column.map((id, index) => ({ id, index, want: target(id) }));
   keyed.sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity) || a.index - b.index);
   let cursor = top;
   for (const { id, want } of keyed) { const at = Math.max(cursor, want ?? cursor); y.set(id, at); cursor = at + size(id).height + GAP_Y; }
   return keyed.map(item => item.id);
  };
  const mean = (list: string[]) => list.length === 0 ? undefined : list.reduce((sum, id) => sum + center(id), 0) / list.length;
  const side = (id: string, column: number, step: -1 | 1) => neighbors(id).filter(other => layer.get(other)! - low === column + step && y.has(other));
  filled.forEach((column, i) => { filled[i] = stack(column, id => { const m = mean(side(id, i, -1)); return m === undefined ? undefined : m - size(id).height / 2; }); });
  // A node with no wire to its left follows the wires to its right.
  for (let i = filled.length - 2; i >= 0; i--) {
   filled[i] = stack(filled[i]!, id => {
    if (side(id, i, -1).length > 0) return y.get(id);
    const m = mean(side(id, i, 1));
    return m === undefined ? y.get(id) : m - size(id).height / 2;
   });
  }
  // The group starts at `top`, so the corner of the set stays and a second Format changes nothing.
  const lift = top - Math.min(...y.values());
  filled.forEach((column, i) => { for (const id of column) result.set(id, { x: Math.round(xs[i]!), y: Math.round(y.get(id)! + lift) }); });
  top = Math.max(...group.map(node => y.get(node.id)! + lift + size(node.id).height)) + GAP_GROUP;
 }
 return result;
}

// One moveNode for each node whose position changes.
export const formatOps = (graphId: string, nodes: readonly BlueprintNode[], positions: ReadonlyMap<string, Point>) =>
 nodes.flatMap(node => {
  const to = positions.get(node.id);
  return to && (to.x !== node.position.x || to.y !== node.position.y) ? [{ kind: 'moveNode' as const, graphId, nodeId: node.id, position: to }] : [];
 });
