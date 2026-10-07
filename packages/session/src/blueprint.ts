import { BlueprintGraphSchema, blueprintPorts, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type Id, type Reply } from '@opensekai/contracts';

export type BlueprintEffect =
 | { kind: 'setVisibility'; entityId: Id; visible: boolean }
 | { kind: 'toggleVisibility'; entityId: Id }
 | { kind: 'selectCamera'; outputId: Id; cameraId: Id };
export interface CompiledBlueprint { graph: BlueprintGraph; nodes: Map<Id, BlueprintNode>; dataIn: Map<string, BlueprintConnection>; flowNext: Map<string, BlueprintConnection> }
export interface PendingDelay { nodeId: Id; dueMs: number }
export interface FlowBudget { visits: number; effects: number }
export interface FlowResult { effects: BlueprintEffect[]; delays: PendingDelay[]; flip: Map<Id, boolean> }

const MAX_EVENT_VISITS = 64;
export const fail = (message: string, ids: string[] = []): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
const own = <T>(record: Record<string, T>, name: string): T | undefined => Object.hasOwn(record, name) ? record[name] : undefined;
const key = (nodeId: string, port: string) => `${nodeId}\0${port}`;

const cycleIn = (ids: Id[], edges: Map<Id, Id[]>): Id | null => {
 const visiting = new Set<Id>(), done = new Set<Id>();
 const visit = (id: Id): boolean => {
  if (visiting.has(id)) return false;
  if (done.has(id)) return true;
  visiting.add(id);
  for (const next of edges.get(id) ?? []) if (!visit(next)) return false;
  visiting.delete(id); done.add(id);
  return true;
 };
 return ids.find(id => !visit(id)) ?? null;
};

export function compileBlueprint(input: unknown): Reply<CompiledBlueprint> {
 const parsed = BlueprintGraphSchema.safeParse(input);
 if (!parsed.success) return fail('Invalid Blueprint document');
 const graph = parsed.data;
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 const dataIn = new Map<string, BlueprintConnection>();
 const flowNext = new Map<string, BlueprintConnection>();
 const dataEdges = new Map<Id, Id[]>(), flowEdges = new Map<Id, Id[]>();
 const push = (edges: Map<Id, Id[]>, from: Id, to: Id) => edges.set(from, [...(edges.get(from) ?? []), to]);
 for (const connection of graph.connections) {
  const source = nodes.get(connection.sourceNodeId), target = nodes.get(connection.targetNodeId);
  if (!source || !target) return fail('Blueprint connection references a missing node', [connection.sourceNodeId, connection.targetNodeId]);
  const output = own(blueprintPorts(source).outputs, connection.sourcePort);
  const input = own(blueprintPorts(target).inputs, connection.targetPort);
  if (!output || !input || output !== input) return fail('Blueprint ports do not match', [source.id, target.id]);
  if (output === 'flow') {
   if (flowNext.has(key(source.id, connection.sourcePort))) return fail('Blueprint flow output has multiple connections', [source.id]);
   flowNext.set(key(source.id, connection.sourcePort), connection);
   if (source.type !== 'flow.delay') push(flowEdges, source.id, target.id);
  } else {
   if (dataIn.has(key(target.id, connection.targetPort))) return fail('Blueprint input has multiple connections', [target.id]);
   dataIn.set(key(target.id, connection.targetPort), connection);
   push(dataEdges, source.id, target.id);
  }
 }
 for (const node of graph.nodes)
  for (const [port, type] of Object.entries(blueprintPorts(node).inputs))
   if (type !== 'flow' && !dataIn.has(key(node.id, port))) return fail('Blueprint input is not connected', [node.id]);
 const ids = graph.nodes.map(node => node.id);
 const cycle = cycleIn(ids, dataEdges) ?? cycleIn(ids, flowEdges);
 if (cycle) return fail('Blueprint has an immediate cycle', [cycle]);
 return { ok: true, data: { graph, nodes, dataIn, flowNext } };
}

const readInput = (compiled: CompiledBlueprint, flip: ReadonlyMap<Id, boolean>, nodeId: Id, port: string): number | boolean => {
 const cache = new Map<string, number | boolean>();
 const evaluate = (id: Id, out: string): number | boolean => {
  const cached = cache.get(key(id, out));
  if (cached !== undefined) return cached;
  const node = compiled.nodes.get(id)!;
  const input = (name: string) => { const wire = compiled.dataIn.get(key(id, name))!; return evaluate(wire.sourceNodeId, wire.sourcePort); };
  let result: number | boolean;
  switch (node.type) {
   case 'value.number': case 'value.boolean': result = node.settings.value; break;
   case 'math.add': result = Number(input('a')) + Number(input('b')); break;
   case 'logic.greater': result = Number(input('a')) > Number(input('b')); break;
   case 'logic.not': result = !input('value'); break;
   case 'flow.flipFlop': result = flip.get(id) ?? false; break;
   default: throw new Error('Blueprint has an invalid data source');
  }
  if (typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  cache.set(key(id, out), result);
  return result;
 };
 const wire = compiled.dataIn.get(key(nodeId, port))!;
 return evaluate(wire.sourceNodeId, wire.sourcePort);
};

export function runFlow(compiled: CompiledBlueprint, start: { nodeId: Id; port: string }, state: ReadonlyMap<Id, boolean>, budget: FlowBudget, nowMs: number): Reply<FlowResult> {
 const flip = new Map(state);
 const effects: BlueprintEffect[] = [], delays: PendingDelay[] = [], stack: Id[] = [];
 const follow = (nodeId: Id, ports: string[]) => {
  for (const port of [...ports].reverse()) { const wire = compiled.flowNext.get(key(nodeId, port)); if (wire) stack.push(wire.targetNodeId); }
 };
 const emit = (node: BlueprintNode, effect: BlueprintEffect): Reply<never> | null => {
  if (--budget.effects < 0) return fail('Blueprint run exceeded its operation limit', [node.id]);
  effects.push(effect); follow(node.id, ['exit']); return null;
 };
 follow(start.nodeId, [start.port]);
 let visits = 0;
 while (stack.length > 0) {
  if (++visits > MAX_EVENT_VISITS || --budget.visits < 0) return fail('Blueprint run exceeded its flow limit', [start.nodeId]);
  const node = compiled.nodes.get(stack.pop()!)!;
  let failure: Reply<never> | null = null;
  try {
   switch (node.type) {
    case 'flow.branch': follow(node.id, [readInput(compiled, flip, node.id, 'condition') ? 'true' : 'false']); break;
    case 'flow.sequence': follow(node.id, Array.from({ length: node.settings.outputs }, (_, i) => `then${i}`)); break;
    case 'flow.flipFlop': { const isA = !(flip.get(node.id) ?? false); flip.set(node.id, isA); follow(node.id, [isA ? 'a' : 'b']); break; }
    case 'flow.delay': delays.push({ nodeId: node.id, dueMs: nowMs + node.settings.seconds * 1000 }); break;
    case 'scene.setVisibility': failure = emit(node, { kind: 'setVisibility', entityId: node.settings.entityId, visible: Boolean(readInput(compiled, flip, node.id, 'visible')) }); break;
    case 'scene.toggleVisibility': failure = emit(node, { kind: 'toggleVisibility', entityId: node.settings.entityId }); break;
    case 'camera.switch': failure = emit(node, { kind: 'selectCamera', outputId: node.settings.outputId, cameraId: node.settings.cameraId }); break;
    default: return fail('Blueprint flow reached a data node', [node.id]);
   }
  } catch { return fail('Blueprint data could not be evaluated', [node.id]); }
  if (failure) return failure;
 }
 return { ok: true, data: { effects, delays, flip } };
}
