import type { OverrideWrite } from './overrides';
import type { ExpressionEffect } from './expressions';
import type { BoneOffsetEffect } from './bone-offsets';
import { cloneState, EVALUATORS, NO_ENV, type BlueprintValue, type Evaluator, type RunEnv, type RunState } from './blueprint-eval';
import { BlueprintGraphSchema, blueprintPorts, nodeDefinition, connectionType, type BlueprintConnection, type BlueprintGraph, type BlueprintNode, type Id, type Reply } from '@opensekai/contracts';

export type SceneEffect =
 | { kind: 'setVisibility'; entityId: Id; visible: boolean }
 | { kind: 'toggleVisibility'; entityId: Id }
 | { kind: 'selectCamera'; outputId: Id; cameraId: Id };
export type BlueprintEffect = SceneEffect | OverrideWrite | ExpressionEffect | BoneOffsetEffect;
export const isOverrideEffect = (effect: BlueprintEffect): effect is OverrideWrite => effect.kind === 'setProperty' || effect.kind === 'moveEntity';
export const isExpressionEffect = (effect: BlueprintEffect): effect is ExpressionEffect => effect.kind === 'setExpression' || effect.kind === 'toggleExpression';
export const isBoneOffsetEffect = (effect: BlueprintEffect): effect is BoneOffsetEffect => effect.kind === 'offsetBone';
export const isSceneEffect = (effect: BlueprintEffect): effect is SceneEffect => !isOverrideEffect(effect) && !isExpressionEffect(effect) && !isBoneOffsetEffect(effect);
export interface CompiledBlueprint { graph: BlueprintGraph; nodes: Map<Id, BlueprintNode>; dataIn: Map<string, BlueprintConnection>; flowNext: Map<string, BlueprintConnection> }
export interface PendingDelay { nodeId: Id; dueMs: number }
export interface FlowBudget { visits: number; effects: number }
export interface FlowResult { effects: BlueprintEffect[]; delays: PendingDelay[]; state: RunState }

const MAX_EVENT_VISITS = 512;
const MAX_LOOP_ITERATIONS = 64;
class LoopLimit extends Error {}
type Frame = { kind: 'enter'; nodeId: Id; port: string } | { kind: 'loop'; nodeId: Id; index: number; last: number };
const evaluator = (node: BlueprintNode) => EVALUATORS[node.type] as Evaluator<BlueprintNode>;
export const fail = (message: string, ids: string[] = []): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
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
 const variables = new Map(graph.variables.map(variable => [variable.id, variable.type]));
 for (const node of graph.nodes) {
  const field = nodeDefinition(node.type).fields.find(item => item.kind === 'variable');
  if (field?.kind === 'variable' && variables.get((node.settings as { variableId: string }).variableId) !== field.variableType)
   return fail('Blueprint variable is missing', [node.id]);
 }
 const nodes = new Map(graph.nodes.map(node => [node.id, node]));
 const dataIn = new Map<string, BlueprintConnection>();
 const flowNext = new Map<string, BlueprintConnection>();
 const dataEdges = new Map<Id, Id[]>(), flowEdges = new Map<Id, Id[]>();
 const push = (edges: Map<Id, Id[]>, from: Id, to: Id) => edges.set(from, [...(edges.get(from) ?? []), to]);
 for (const connection of graph.connections) {
  const source = nodes.get(connection.sourceNodeId), target = nodes.get(connection.targetNodeId);
  if (!source || !target) return fail('Blueprint connection references a missing node', [connection.sourceNodeId, connection.targetNodeId]);
  const type = connectionType(source, connection.sourcePort, target, connection.targetPort);
  if (!type) return fail('Blueprint ports do not match', [source.id, target.id]);
  if (type === 'flow') {
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

const readInput = (compiled: CompiledBlueprint, state: RunState, nodeId: Id, port: string, env: RunEnv): BlueprintValue => {
 const cache = new Map<string, BlueprintValue>();
 const evaluate = (id: Id, out: string): BlueprintValue => {
  const cached = cache.get(key(id, out));
  if (cached !== undefined) return cached;
  const node = compiled.nodes.get(id)!;
  const data = evaluator(node).data;
  if (!data) throw new Error('Blueprint has an invalid data source');
  const result = data(node, out, name => { const wire = compiled.dataIn.get(key(id, name))!; return evaluate(wire.sourceNodeId, wire.sourcePort); }, state, env);
  if (Array.isArray(result) ? !result.every(Number.isFinite) : typeof result === 'number' && !Number.isFinite(result)) throw new RangeError('Blueprint number is not finite');
  cache.set(key(id, out), result);
  return result;
 };
 const wire = compiled.dataIn.get(key(nodeId, port))!;
 return evaluate(wire.sourceNodeId, wire.sourcePort);
};

export function runFlow(compiled: CompiledBlueprint, start: { nodeId: Id; port: string }, state: RunState, budget: FlowBudget, nowMs: number, env: RunEnv = NO_ENV): Reply<FlowResult> {
 const next = cloneState(state);
 const effects: BlueprintEffect[] = [], delays: PendingDelay[] = [], stack: Frame[] = [];
 const follow = (nodeId: Id, ports: string[]) => {
  for (const port of [...ports].reverse()) { const wire = compiled.flowNext.get(key(nodeId, port)); if (wire) stack.push({ kind: 'enter', nodeId: wire.targetNodeId, port: wire.targetPort }); }
 };
 follow(start.nodeId, [start.port]);
 let visits = 0;
 while (stack.length > 0) {
  if (++visits > MAX_EVENT_VISITS || --budget.visits < 0) return fail('Blueprint run exceeded its flow limit', [start.nodeId]);
  const frame = stack.pop()!;
  if (frame.kind === 'loop') {
   if (frame.index > frame.last) { follow(frame.nodeId, ['completed']); continue; }
   next.loops.set(frame.nodeId, frame.index);
   // The next iteration waits under the body, so all flow after `body` runs first.
   stack.push({ ...frame, index: frame.index + 1 });
   follow(frame.nodeId, ['body']);
   continue;
  }
  const node = compiled.nodes.get(frame.nodeId)!;
  const flow = evaluator(node).flow;
  if (!flow) return fail('Blueprint flow reached a data node', [node.id]);
  let failure: Reply<never> | null = null;
  try {
   flow(node, {
    port: frame.port, state: next, nowMs, env,
    read: port => readInput(compiled, next, node.id, port, env),
    follow: (...ports) => follow(node.id, ports),
    emit: effect => {
     if (--budget.effects < 0) { failure ??= fail('Blueprint run exceeded its operation limit', [node.id]); return; }
     effects.push(effect); follow(node.id, ['exit']);
    },
    delay: seconds => { delays.push({ nodeId: node.id, dueMs: nowMs + seconds * 1000 }); },
    loop: (first, last) => {
     if (last - first + 1 > MAX_LOOP_ITERATIONS) throw new LoopLimit();
     if (last < first) follow(node.id, ['completed']);
     else stack.push({ kind: 'loop', nodeId: node.id, index: first, last });
    },
   });
  } catch (error) { return fail(error instanceof LoopLimit ? 'Blueprint loop exceeded its iteration limit' : 'Blueprint data could not be evaluated', [node.id]); }
  if (failure) return failure;
 }
 return { ok: true, data: { effects, delays, state: next } };
}
