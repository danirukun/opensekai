import { BlueprintGraphSchema, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type PatchOp, type Reply } from '@opensekai/contracts';

type PortType = 'flow' | 'number' | 'boolean';
type PortShape = { inputs: Record<string, PortType>; outputs: Record<string, PortType> };
const PORTS: Record<BlueprintNode['type'], PortShape> = {
 'event.manual': { inputs: {}, outputs: { flow: 'flow' } },
 'value.number': { inputs: {}, outputs: { value: 'number' } },
 'value.boolean': { inputs: {}, outputs: { value: 'boolean' } },
 'math.add': { inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } },
 'logic.greater': { inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } },
 'scene.setVisibility': { inputs: { flow: 'flow', visible: 'boolean' }, outputs: {} },
};

const fail = (message: string, ids: string[] = []): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const key = (nodeId: string, port: string) => `${nodeId}\0${port}`;

export interface CompiledBlueprint {
 graph: BlueprintGraph;
 nodes: Map<string, BlueprintNode>;
 incoming: Map<string, BlueprintConnection>;
 flowOut: Map<string, BlueprintConnection[]>;
}

export function compileBlueprint(input: unknown): Reply<CompiledBlueprint> {
 const parsed = BlueprintGraphSchema.safeParse(input);
 if (!parsed.success) return fail('Invalid Blueprint document');
 const graph = parsed.data;
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 const incoming = new Map<string, BlueprintConnection>();
 const flowOut = new Map<string, BlueprintConnection[]>();
 const neighbors = new Map(graph.nodes.map(node => [node.id, [] as string[]]));
 for (const connection of graph.connections) {
  const source = nodes.get(connection.sourceNodeId);
  const target = nodes.get(connection.targetNodeId);
  if (!source || !target) return fail('Blueprint connection references a missing node', [connection.sourceNodeId, connection.targetNodeId]);
  const output = PORTS[source.type].outputs[connection.sourcePort];
  const input = PORTS[target.type].inputs[connection.targetPort];
  if (!output || !input || output !== input)
   return fail('Blueprint ports do not match', [source.id, target.id]);
  const inputKey = key(target.id, connection.targetPort);
  if (incoming.has(inputKey)) return fail('Blueprint input has multiple connections', [target.id]);
  incoming.set(inputKey, connection);
  neighbors.get(source.id)!.push(target.id);
  if (output === 'flow') flowOut.set(source.id, [...(flowOut.get(source.id) ?? []), connection]);
 }
 for (const node of graph.nodes) {
  for (const port of Object.keys(PORTS[node.type].inputs))
   if (!incoming.has(key(node.id, port))) return fail('Blueprint input is not connected', [node.id]);
 }
 const visiting = new Set<string>();
 const visited = new Set<string>();
 const visit = (id: string): boolean => {
  if (visiting.has(id)) return false;
  if (visited.has(id)) return true;
  visiting.add(id);
  for (const next of neighbors.get(id) ?? []) if (!visit(next)) return false;
  visiting.delete(id);
  visited.add(id);
  return true;
 };
 for (const node of graph.nodes) if (!visit(node.id)) return fail('Blueprint has an immediate cycle', [node.id]);
 return { ok: true, data: { graph, nodes, incoming, flowOut } };
}

export function executeBlueprint(compiled: CompiledBlueprint, triggerNodeId: string): Reply<PatchOp[]> {
 const trigger = compiled.nodes.get(triggerNodeId);
 if (trigger?.type !== 'event.manual') return fail('Manual trigger not found', [triggerNodeId]);
 const cache = new Map<string, number | boolean>();
 const evaluate = (nodeId: string, port: string): number | boolean => {
  const outputKey = key(nodeId, port);
  const cached = cache.get(outputKey);
  if (cached !== undefined) return cached;
  const node = compiled.nodes.get(nodeId)!;
  const input = (inputPort: string) => {
   const wire = compiled.incoming.get(key(nodeId, inputPort))!;
   return evaluate(wire.sourceNodeId, wire.sourcePort);
  };
  let result: number | boolean;
  switch (node.type) {
   case 'value.number': result = node.settings.value; break;
   case 'value.boolean': result = node.settings.value; break;
   case 'math.add': result = Number(input('a')) + Number(input('b')); break;
   case 'logic.greater': result = Number(input('a')) > Number(input('b')); break;
   default: throw new Error('Blueprint has an invalid data source');
  }
  if (typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  cache.set(outputKey, result);
  return result;
 };
 const operations: PatchOp[] = [];
 const queue = [triggerNodeId];
 let visits = 0;
 while (queue.length > 0) {
  if (++visits > 64) return fail('Blueprint run exceeded its flow limit', [triggerNodeId]);
  const id = queue.shift()!;
  for (const wire of compiled.flowOut.get(id) ?? []) {
   const target = compiled.nodes.get(wire.targetNodeId)!;
   if (target.type === 'scene.setVisibility') {
    const inputWire = compiled.incoming.get(key(target.id, 'visible'))!;
    let visible: number | boolean;
    try { visible = evaluate(inputWire.sourceNodeId, inputWire.sourcePort); }
    catch { return fail('Blueprint data could not be evaluated', [target.id]); }
    if (operations.length >= 64) return fail('Blueprint run exceeded its operation limit', [target.id]);
    operations.push({ kind: 'setVisibility', entityId: target.settings.entityId, visible: Boolean(visible) });
   }
   queue.push(target.id);
  }
 }
 return { ok: true, data: operations };
}
