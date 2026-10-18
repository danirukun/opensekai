import { inlineInputType, type BlueprintGraph, type BlueprintOp } from '@opensekai/contracts';
import { graphPatch } from './graph-patch';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
// Operations that turn `from` into `to` for one graph's nodes, wires, and variables.
export function diffOps(from: BlueprintGraph, to: BlueprintGraph): BlueprintOp[] {
 const graphId = to.id, patch = graphPatch(from, to);
 const oldTypes = new Map(from.nodes.map(node => [node.id, node.type] as const));
 const retyped = patch.updateNodes.filter(node => oldTypes.get(node.id) !== node.type);
 const ops: BlueprintOp[] = patch.removeConnections.map(connectionId => ({ kind: 'disconnect', graphId, connectionId }));
 for (const nodeId of [...patch.removeNodes, ...retyped.map(node => node.id)]) ops.push({ kind: 'removeNode', graphId, nodeId });
 const before = new Map(from.variables.map(v => [v.id, v] as const)), after = new Set(to.variables.map(v => v.id));
 for (const id of before.keys()) if (!after.has(id)) ops.push({ kind: 'removeVariable', graphId, variableId: id });
 for (const variable of to.variables) {
  const old = before.get(variable.id);
  if (!old) ops.push({ kind: 'addVariable', graphId, variable });
  else if (!same(old, variable)) ops.push({ kind: 'updateVariable', graphId, variableId: variable.id, name: variable.name, type: variable.type, default: variable.default });
 }
 for (const node of [...patch.addNodes, ...retyped]) ops.push({ kind: 'addNode', graphId, node });
 const oldNodes = new Map(from.nodes.map(node => [node.id, node] as const));
 for (const node of patch.updateNodes) {
  const old = oldNodes.get(node.id);
  if (!old || old.type !== node.type) continue;
  if (!same(old.settings, node.settings)) ops.push({ kind: 'setNodeSettings', graphId, nodeId: node.id, settings: node.settings });
  // After the settings: a settings change already drops the inline values of ports that it removes or retypes.
  const before = old.inputs ?? {}, after = node.inputs ?? {};
  for (const port of new Set([...Object.keys(before), ...Object.keys(after)]))
   if (!same(before[port], after[port]) && inlineInputType(node, port)) ops.push({ kind: 'setNodeInput', graphId, nodeId: node.id, port, value: after[port] ?? null });
 }
 for (const move of patch.moveNodes) ops.push({ kind: 'moveNode', graphId, nodeId: move.id, position: move.position });
 // Wires go last: a settings change can drop wires, and a retyped node lost all of its wires.
 const added = new Set(patch.addConnections.map(wire => wire.id)), redone = new Set(retyped.map(node => node.id));
 const rewire = to.connections.filter(wire => !added.has(wire.id) && (redone.has(wire.sourceNodeId) || redone.has(wire.targetNodeId)));
 for (const connection of [...patch.addConnections, ...rewire]) ops.push({ kind: 'connect', graphId, connection });
 ops.push(...commentDiff(from, to));
 return ops;
}

// Comments are independent of nodes and wires, so their operations can go last.
function commentDiff(from: BlueprintGraph, to: BlueprintGraph): BlueprintOp[] {
 const graphId = to.id, before = new Map((from.comments ?? []).map(c => [c.id, c] as const)), after = new Set((to.comments ?? []).map(c => c.id));
 return [
  ...[...before.keys()].filter(id => !after.has(id)).map(commentId => ({ kind: 'removeComment' as const, graphId, commentId })),
  ...(to.comments ?? []).flatMap((comment): BlueprintOp[] => {
   const old = before.get(comment.id);
   if (!old) return [{ kind: 'addComment', graphId, comment }];
   return same(old, comment) ? [] : [{ kind: 'updateComment', graphId, commentId: comment.id, text: comment.text, position: comment.position, size: comment.size }];
  }),
 ];
}

interface Step { before: BlueprintGraph; after: BlueprintGraph; undo: BlueprintOp[]; redo: BlueprintOp[]; shape: string; at: number }
export interface UndoHistory {
 record(graphId: string, before: BlueprintGraph, after: BlueprintGraph, ops: readonly BlueprintOp[]): void;
 // `apply` sends the operations and returns false when they no longer apply; that step is then dropped.
 undo(graphId: string, apply: (ops: BlueprintOp[]) => boolean): boolean;
 redo(graphId: string, apply: (ops: BlueprintOp[]) => boolean): boolean;
 canUndo(graphId: string): boolean;
 canRedo(graphId: string): boolean;
 clear(): void;
}
const LIMIT = 64, MERGE_MS = 500;
// Only a drag (moves) or repeated edits of one node's settings, one inline value, one variable, or one comment text merge; any other action is one step.
const shape = (ops: readonly BlueprintOp[]) => {
 if (ops.length > 0 && ops.every(op => op.kind === 'moveNode')) return 'move';
 const [only] = ops;
 if (ops.length !== 1 || !only) return '';
 return only.kind === 'setNodeSettings' ? `settings:${only.nodeId}` : only.kind === 'setNodeInput' ? `input:${only.nodeId}:${only.port}` : only.kind === 'updateVariable' ? `variable:${only.variableId}` : only.kind === 'updateComment' && only.text !== undefined ? `comment:${only.commentId}` : '';
};

export function createUndoHistory(now: () => number = () => performance.now()): UndoHistory {
 const done = new Map<string, Step[]>(), undone = new Map<string, Step[]>();
 const move = (from: Map<string, Step[]>, to: Map<string, Step[]>, graphId: string, pick: (step: Step) => BlueprintOp[], apply: (ops: BlueprintOp[]) => boolean) => {
  const step = from.get(graphId)?.pop();
  if (!step) return false;
  if (!apply(pick(step))) return false;
  to.set(graphId, [...(to.get(graphId) ?? []), step]);
  return true;
 };
 return {
  record(graphId, before, after, ops) {
   const list = done.get(graphId) ?? [], last = list.at(-1), key = shape(ops), time = now();
   const merge = last !== undefined && key !== '' && last.shape === key && time - last.at < MERGE_MS && same(last.after, before);
   const start = merge ? last.before : before;
   const redo = diffOps(start, after);
   const kept = merge ? list.slice(0, -1) : list;
   done.set(graphId, redo.length === 0 ? kept : [...kept, { before: start, after, undo: diffOps(after, start), redo, shape: key, at: time }].slice(-LIMIT));
   if (redo.length > 0 || merge) undone.set(graphId, []);
  },
  undo: (graphId, apply) => move(done, undone, graphId, step => step.undo, apply),
  redo: (graphId, apply) => move(undone, done, graphId, step => step.redo, apply),
  canUndo: graphId => (done.get(graphId)?.length ?? 0) > 0,
  canRedo: graphId => (undone.get(graphId)?.length ?? 0) > 0,
  clear() { done.clear(); undone.clear(); },
 };
}
