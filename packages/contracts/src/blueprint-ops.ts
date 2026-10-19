import { z } from 'zod';
import { BlueprintConnectionSchema, BlueprintGraphSchema, BlueprintSetSchema, BlueprintVariableSchema, type BlueprintGraph } from './blueprint';
import { BlueprintNodeSchema, BlueprintPositionSchema, connectionType, inlineInputType, nodeDefinition, pruneInlineInputs, withInlineInput } from './blueprint-nodes';
import { DATA_TYPES, defaultBlueprintValue, isBlueprintValue, ScalarValueSchema, type DataType } from './blueprint-values';
import type { Reply } from './types';
import { BlueprintCommentPositionSchema, BlueprintCommentSchema, BlueprintCommentSizeSchema, BlueprintCommentTextSchema } from './blueprint-comments';
import { copyName, duplicateGraph } from './blueprint-duplicate';

const IdSchema = z.string().min(1).max(256);
export const BlueprintOpSchema = z.discriminatedUnion('kind', [
 z.strictObject({ kind: z.literal('replaceAll'), graphs: BlueprintSetSchema }),
 z.strictObject({ kind: z.literal('createGraph'), graph: BlueprintGraphSchema }),
 z.strictObject({ kind: z.literal('removeGraph'), graphId: IdSchema }),
 z.strictObject({ kind: z.literal('updateGraph'), graphId: IdSchema, name: z.string().trim().min(1).max(128).optional(), enabled: z.boolean().optional() }),
 z.strictObject({ kind: z.literal('addNode'), graphId: IdSchema, node: BlueprintNodeSchema }),
 z.strictObject({ kind: z.literal('removeNode'), graphId: IdSchema, nodeId: IdSchema }),
 z.strictObject({ kind: z.literal('moveNode'), graphId: IdSchema, nodeId: IdSchema, position: BlueprintPositionSchema }),
 z.strictObject({ kind: z.literal('setNodeSettings'), graphId: IdSchema, nodeId: IdSchema, settings: z.record(z.string(), z.unknown()) }),
 z.strictObject({ kind: z.literal('connect'), graphId: IdSchema, connection: BlueprintConnectionSchema }),
 z.strictObject({ kind: z.literal('disconnect'), graphId: IdSchema, connectionId: IdSchema }),
 z.strictObject({ kind: z.literal('addVariable'), graphId: IdSchema, variable: BlueprintVariableSchema }),
 // `default` is checked against the variable type when the operation applies.
 z.strictObject({ kind: z.literal('updateVariable'), graphId: IdSchema, variableId: IdSchema, name: z.string().trim().min(1).max(64).optional(), type: z.enum(DATA_TYPES as [string, ...string[]]).optional(), default: z.unknown().refine(value => value !== null, 'A default cannot be null').optional() }),
 z.strictObject({ kind: z.literal('removeVariable'), graphId: IdSchema, variableId: IdSchema }),
 // `value: null` removes the inline value; the input then reads the default of its type.
 z.strictObject({ kind: z.literal('setNodeInput'), graphId: IdSchema, nodeId: IdSchema, port: z.string().min(1).max(64), value: ScalarValueSchema.nullable() }),
 z.strictObject({ kind: z.literal('addComment'), graphId: IdSchema, comment: BlueprintCommentSchema }),
 z.strictObject({ kind: z.literal('updateComment'), graphId: IdSchema, commentId: IdSchema, text: BlueprintCommentTextSchema.optional(), position: BlueprintCommentPositionSchema.optional(), size: BlueprintCommentSizeSchema.optional() }),
 z.strictObject({ kind: z.literal('removeComment'), graphId: IdSchema, commentId: IdSchema }),
 z.strictObject({ kind: z.literal('duplicateGraph'), graphId: IdSchema, newGraphId: IdSchema, name: z.string().trim().min(1).max(128).optional() }),
]);
export const BlueprintBatchSchema = z.strictObject({ clientId: IdSchema, batchId: IdSchema, ops: z.array(BlueprintOpSchema).min(1).max(64) });
export type BlueprintOp = z.infer<typeof BlueprintOpSchema>;
export type BlueprintBatch = z.infer<typeof BlueprintBatchSchema>;

const reject = (code: 'NOT_FOUND' | 'INVALID_INPUT', message: string, ids: string[]): Reply<never> => ({ ok: false, error: { code, message, ids } });

// Replaces the settings of node `i`, then removes the inline values and wires that no longer type-check. False when the settings are invalid.
function resettle(graph: BlueprintGraph, i: number, settings: unknown): boolean {
 // Settings are checked first, so the inline values are checked against valid ports.
 const { inputs, ...bare } = graph.nodes[i]!;
 const parsed = BlueprintNodeSchema.safeParse({ ...bare, settings });
 if (!parsed.success) return false;
 const node = graph.nodes[i] = pruneInlineInputs(inputs ? { ...parsed.data, inputs } : parsed.data);
 graph.connections = graph.connections.filter(c => {
  if (c.sourceNodeId !== node.id && c.targetNodeId !== node.id) return true;
  const source = graph.nodes.find(n => n.id === c.sourceNodeId), target = graph.nodes.find(n => n.id === c.targetNodeId);
  return !!source && !!target && connectionType(source, c.sourcePort, target, c.targetPort) !== null;
 });
 return true;
}
// A node with a `typedVariable` field follows the new type of its variable. A node whose settings cannot take the type (a list node
// after a change to a scalar type) stays as it is, and the compiler reports the variable as missing.
function retypeVariableNodes(graph: BlueprintGraph, variableId: string, type: DataType): void {
 graph.nodes.forEach((node, i) => {
  const field = nodeDefinition(node.type).fields.find(item => item.kind === 'typedVariable');
  const settings = node.settings as Record<string, unknown>;
  if (field?.kind === 'typedVariable' && settings[field.key] === variableId) resettle(graph, i, { ...settings, [field.typeKey]: type });
 });
}

export function applyBlueprintOps(graphs: readonly BlueprintGraph[], ops: readonly BlueprintOp[]): Reply<BlueprintGraph[]> {
 let next = (structuredClone(graphs) as BlueprintGraph[]).map(graph => ({ ...graph, variables: graph.variables ?? [] }));
 for (const op of ops) {
  if (op.kind === 'replaceAll') { next = structuredClone(op.graphs); continue; }
  if (op.kind === 'createGraph') {
   if (next.some(g => g.id === op.graph.id)) return reject('INVALID_INPUT', 'Duplicate graph ID', [op.graph.id]);
   next.push(structuredClone(op.graph)); continue;
  }
  const graph = next.find(g => g.id === op.graphId);
  if (!graph) return reject('NOT_FOUND', 'Blueprint not found', [op.graphId]);
  const nodeAt = (id: string) => graph.nodes.findIndex(n => n.id === id);
  switch (op.kind) {
   case 'removeGraph': next = next.filter(g => g !== graph); break;
   case 'updateGraph':
    if (op.name !== undefined) graph.name = op.name;
    if (op.enabled !== undefined) graph.enabled = op.enabled;
    break;
   case 'addNode':
    if (nodeAt(op.node.id) >= 0) return reject('INVALID_INPUT', 'Duplicate node ID', [op.node.id]);
    graph.nodes.push(structuredClone(op.node)); break;
   case 'removeNode':
    if (nodeAt(op.nodeId) < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    graph.nodes = graph.nodes.filter(n => n.id !== op.nodeId);
    graph.connections = graph.connections.filter(c => c.sourceNodeId !== op.nodeId && c.targetNodeId !== op.nodeId);
    break;
   case 'moveNode': {
    const i = nodeAt(op.nodeId);
    if (i < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    graph.nodes[i]!.position = { ...op.position }; break;
   }
   case 'setNodeSettings': {
    const i = nodeAt(op.nodeId);
    if (i < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    if (!resettle(graph, i, op.settings)) return reject('INVALID_INPUT', 'Invalid node settings', [op.nodeId]);
    break;
   }
   case 'connect': {
    const wire = op.connection;
    const source = graph.nodes[nodeAt(wire.sourceNodeId)], target = graph.nodes[nodeAt(wire.targetNodeId)];
    if (!source || !target) return reject('NOT_FOUND', 'Node not found', [wire.sourceNodeId, wire.targetNodeId]);
    const type = connectionType(source, wire.sourcePort, target, wire.targetPort);
    if (!type) return reject('INVALID_INPUT', 'Blueprint ports do not match', [source.id, target.id]);
    if (graph.connections.some(c => c.id === wire.id)) return reject('INVALID_INPUT', 'Duplicate connection ID', [wire.id]);
    graph.connections = graph.connections.filter(c => type === 'flow'
     ? !(c.sourceNodeId === wire.sourceNodeId && c.sourcePort === wire.sourcePort)
     : !(c.targetNodeId === wire.targetNodeId && c.targetPort === wire.targetPort));
    graph.connections.push({ ...wire }); break;
   }
   case 'disconnect':
    if (!graph.connections.some(c => c.id === op.connectionId)) return reject('NOT_FOUND', 'Connection not found', [op.connectionId]);
    graph.connections = graph.connections.filter(c => c.id !== op.connectionId); break;
   case 'addVariable':
    if (graph.variables.some(v => v.id === op.variable.id)) return reject('INVALID_INPUT', 'Duplicate variable ID', [op.variable.id]);
    graph.variables.push(structuredClone(op.variable)); break;
   case 'updateVariable': {
    const i = graph.variables.findIndex(v => v.id === op.variableId);
    if (i < 0) return reject('NOT_FOUND', 'Variable not found', [op.variableId]);
    const old = graph.variables[i]!, type = op.type ?? old.type;
    // A new type without a new default starts from that type's zero value.
    const fallback = type === old.type ? old.default : defaultBlueprintValue(type as typeof old.type);
    const parsed = BlueprintVariableSchema.safeParse({ id: old.id, name: op.name ?? old.name, type, default: op.default !== undefined ? op.default : fallback });
    if (!parsed.success) return reject('INVALID_INPUT', 'Invalid variable', [op.variableId]);
    graph.variables[i] = parsed.data;
    if (type !== old.type) retypeVariableNodes(graph, op.variableId, parsed.data.type);
    break;
   }
   case 'removeVariable':
    if (!graph.variables.some(v => v.id === op.variableId)) return reject('NOT_FOUND', 'Variable not found', [op.variableId]);
    graph.variables = graph.variables.filter(v => v.id !== op.variableId); break;
   case 'setNodeInput': {
    const i = nodeAt(op.nodeId);
    if (i < 0) return reject('NOT_FOUND', 'Node not found', [op.nodeId]);
    const node = graph.nodes[i]!, type = inlineInputType(node, op.port);
    if (!type || (op.value !== null && !isBlueprintValue(type, op.value))) return reject('INVALID_INPUT', 'Invalid inline input', [op.nodeId]);
    graph.nodes[i] = withInlineInput(node, op.port, structuredClone(op.value));
    break;
   }
   case 'addComment':
    if ((graph.comments ?? []).some(c => c.id === op.comment.id)) return reject('INVALID_INPUT', 'Duplicate comment ID', [op.comment.id]);
    graph.comments = [...(graph.comments ?? []), structuredClone(op.comment)]; break;
   case 'updateComment': {
    const comments = graph.comments ?? [], i = comments.findIndex(c => c.id === op.commentId);
    if (i < 0) return reject('NOT_FOUND', 'Comment not found', [op.commentId]);
    const old = comments[i]!;
    comments[i] = { ...old, ...(op.text === undefined ? {} : { text: op.text }), ...(op.position ? { position: { ...op.position } } : {}), ...(op.size ? { size: { ...op.size } } : {}) };
    break;
   }
   case 'removeComment':
    if (!(graph.comments ?? []).some(c => c.id === op.commentId)) return reject('NOT_FOUND', 'Comment not found', [op.commentId]);
    graph.comments = graph.comments!.filter(c => c.id !== op.commentId); break;
   case 'duplicateGraph':
    if (next.some(g => g.id === op.newGraphId)) return reject('INVALID_INPUT', 'Duplicate graph ID', [op.newGraphId]);
    next.splice(next.indexOf(graph) + 1, 0, duplicateGraph(graph, op.newGraphId, op.name ?? copyName(graph.name, next.map(g => g.name))));
    break;
  }
 }
 const valid = BlueprintSetSchema.safeParse(next);
 if (valid.success) return { ok: true, data: valid.data };
 const issue = valid.error.issues[0]!;
 const [graphIndex, field, nodeIndex] = issue.path;
 const owner = typeof graphIndex === 'number' ? next[graphIndex] : undefined;
 const member = owner && field === 'nodes' && typeof nodeIndex === 'number' ? owner.nodes[nodeIndex] : undefined;
 const ids = owner ? [owner.id, ...(member ? [member.id] : [])] : [];
 return reject('INVALID_INPUT', issue.code === 'too_big' ? 'Blueprint set exceeds its limits' : issue.message, ids);
}
