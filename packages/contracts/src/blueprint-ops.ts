import { z } from 'zod';
import { BlueprintConnectionSchema, BlueprintGraphSchema, BlueprintSetSchema, type BlueprintGraph } from './blueprint';
import { BlueprintNodeSchema, BlueprintPositionSchema, blueprintPorts, connectionType, ownPort } from './blueprint-nodes';
import type { Reply } from './types';

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
]);
export const BlueprintBatchSchema = z.strictObject({ clientId: IdSchema, batchId: IdSchema, ops: z.array(BlueprintOpSchema).min(1).max(64) });
export type BlueprintOp = z.infer<typeof BlueprintOpSchema>;
export type BlueprintBatch = z.infer<typeof BlueprintBatchSchema>;

const reject = (code: 'NOT_FOUND' | 'INVALID_INPUT', message: string, ids: string[]): Reply<never> => ({ ok: false, error: { code, message, ids } });

export function applyBlueprintOps(graphs: readonly BlueprintGraph[], ops: readonly BlueprintOp[]): Reply<BlueprintGraph[]> {
 let next = structuredClone(graphs) as BlueprintGraph[];
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
    const parsed = BlueprintNodeSchema.safeParse({ ...graph.nodes[i], settings: op.settings });
    if (!parsed.success) return reject('INVALID_INPUT', 'Invalid node settings', [op.nodeId]);
    graph.nodes[i] = parsed.data;
    const ports = blueprintPorts(parsed.data);
    graph.connections = graph.connections.filter(c =>
     (c.sourceNodeId !== op.nodeId || ownPort(ports, 'outputs', c.sourcePort)) && (c.targetNodeId !== op.nodeId || ownPort(ports, 'inputs', c.targetPort)));
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
