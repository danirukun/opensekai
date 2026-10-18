import { BlueprintSetSchema, keystrokeAccelerator, type AppError, type BlueprintGraph, type DeviceEvent, type DeviceKind, type Id, type Reply } from '@opensekai/contracts';
import { deviceTrigger, emptyState, type RunEnv, type RunState } from './blueprint-eval';
import { activeDevices } from './devices';
import { fnv1a } from './blueprint-random';
import type { DebugValueSample } from './debug-log';
import { compileBlueprint, fail, runFlow, type BlueprintEffect, type CompiledBlueprint, type FlowBudget, type PendingDelay } from './blueprint';

export type BlueprintEvent = { kind: 'manual'; graphId: Id; nodeId: Id } | { kind: 'keystroke'; accelerator: string } | { kind: 'device'; event: DeviceEvent } | { kind: 'update' };
export type StepEnv = Omit<RunEnv, 'deltaSeconds'>;
// `debug` (slice F): the Debug Value samples of an accepted run.
export interface GraphRun { graphId: Id; effects: BlueprintEffect[]; error: AppError | null; debug?: DebugValueSample[] }
// Called once per run, right after the run, before the next one. A returned error keeps the run's Flip Flop state and new delays uncommitted.
export type RunGate = (run: GraphRun) => AppError | null;
export interface BlueprintRuntime { install(graphs: unknown, fresh?: boolean): Reply<BlueprintGraph[]>; installCompiled(graphs: readonly CompiledBlueprint[], fresh?: boolean): void; keystrokes(): string[]; heldKeys(): string[]; devices(): DeviceKind[]; step(events: BlueprintEvent[], nowMs: number, gate?: RunGate, env?: StepEnv): GraphRun[] }

interface Active { compiled: CompiledBlueprint; logic: string; state: RunState; delays: (PendingDelay & { order: number })[]; enable: boolean; lastUpdateMs?: number }
const MAX_DELAYS = 32, TICK_VISITS = 1024, TICK_EFFECTS = 64;
// Executable content only: positions and names do not reset runtime state.
export const logicKey = (graph: BlueprintGraph) => JSON.stringify([graph.id, graph.enabled, graph.nodes.map(({ id, type, settings }) => [id, type, settings]), graph.connections, (graph.variables ?? []).map(({ id, type, default: value }) => [id, type, value])]);
export const initialState = (graph: BlueprintGraph): RunState =>
 ({ ...emptyState(fnv1a(graph.id)), variables: new Map((graph.variables ?? []).map(variable => [variable.id, variable.default])) });

export const activeAccelerators = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled)
 .flatMap(graph => graph.nodes.flatMap(node => node.type === 'event.keystroke' ? [keystrokeAccelerator(node.settings)] : [])))].sort();
export const activeHeldKeys = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled).flatMap(graph => graph.nodes.flatMap(node =>
 node.type === 'input.keyHeld' ? [node.settings.code] : node.type === 'input.keyAxis' ? [node.settings.negative, node.settings.positive] : [])))].sort();

export function createBlueprintRuntime(): BlueprintRuntime {
 let active: Active[] = [];
 let order = 0;
 const run = (entry: Active, start: { nodeId: Id; port: string }, budget: FlowBudget, nowMs: number, gate: RunGate, env: RunEnv): GraphRun => {
  const graphId = entry.compiled.graph.id;
  const result = runFlow(entry.compiled, start, entry.state, budget, nowMs, env);
  if (!result.ok) return { graphId, effects: [], error: result.error };
  if (entry.delays.length + result.data.delays.length > MAX_DELAYS) {
   const limit = fail('Blueprint delay limit reached', [graphId]);
   return { graphId, effects: [], error: limit.ok ? null : limit.error };
  }
  const outcome: GraphRun = { graphId, effects: result.data.effects, error: null, ...(result.data.debug.length ? { debug: result.data.debug } : {}) };
  const rejected = gate(outcome);
  if (rejected) return { graphId, effects: [], error: rejected };
  entry.state = result.data.state;
  entry.delays.push(...result.data.delays.map(delay => ({ ...delay, order: order++ })));
  return outcome;
 };
 const installCompiled = (graphs: readonly CompiledBlueprint[], fresh = false): void => {
  active = graphs.map(compiled => {
   const logic = logicKey(compiled.graph);
   const previous = compiled.graph.enabled && !fresh ? active.find(entry => entry.logic === logic) : undefined;
   // A new state on an enabled graph runs its On Enable nodes on the next step.
   return previous ? { ...previous, compiled } : { compiled, logic, state: initialState(compiled.graph), delays: [], enable: compiled.graph.enabled };
  });
 };
 return {
  installCompiled,
  install(graphs, fresh = false) {
   const parsed = BlueprintSetSchema.safeParse(graphs);
   if (!parsed.success) return fail('Invalid Blueprint set');
   const list: CompiledBlueprint[] = [];
   for (const graph of parsed.data) {
    const compiled = compileBlueprint(graph);
    if (!compiled.ok) return { ok: false, error: { ...compiled.error, ids: [graph.id, ...compiled.error.ids] } };
    list.push(compiled.data);
   }
   installCompiled(list, fresh);
   return { ok: true, data: parsed.data };
  },
  keystrokes: () => activeAccelerators(active.map(entry => entry.compiled.graph)),
  heldKeys: () => activeHeldKeys(active.map(entry => entry.compiled.graph)),
  devices: () => activeDevices(active.map(entry => entry.compiled.graph)),
  step(events, nowMs, gate = () => null, base: StepEnv = { held: new Set<string>(), scene: () => null }) {
   const budget: FlowBudget = { visits: TICK_VISITS, effects: TICK_EFFECTS };
   const instant: RunEnv = { ...base, deltaSeconds: 0 };
   const runs: GraphRun[] = [];
   for (const entry of active) {
    if (!entry.enable) continue;
    entry.enable = false;
    for (const node of entry.compiled.graph.nodes)
     if (node.type === 'event.enable') runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, instant));
   }
   const due = active.flatMap(entry => entry.delays.filter(delay => delay.dueMs <= nowMs).map(delay => ({ entry, delay })))
    .sort((a, b) => a.delay.dueMs - b.delay.dueMs || a.delay.order - b.delay.order);
   for (const { entry, delay } of due) {
    entry.delays = entry.delays.filter(item => item !== delay);
    runs.push(run(entry, { nodeId: delay.nodeId, port: 'exit' }, budget, nowMs, gate, instant));
   }
   for (const event of events) {
    if (event.kind === 'update') {
     for (const entry of active) {
      const graph = entry.compiled.graph;
      const starts = graph.enabled ? graph.nodes.filter(node => node.type === 'event.update') : [];
      if (starts.length === 0) continue;
      const deltaSeconds = entry.lastUpdateMs === undefined ? 0 : Math.min(Math.max((nowMs - entry.lastUpdateMs) / 1000, 0), 0.1);
      entry.lastUpdateMs = nowMs;
      for (const node of starts) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, { ...base, deltaSeconds }));
     }
     continue;
    }
    if (event.kind === 'device') {
     for (const entry of active)
      for (const node of entry.compiled.graph.enabled ? entry.compiled.graph.nodes : [])
       if (deviceTrigger(node, event.event)) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, { ...instant, trigger: event.event }));
     continue;
    }
    for (const entry of active) {
     const graph = entry.compiled.graph;
     if (!graph.enabled) continue;
     for (const node of graph.nodes) {
      const matches = event.kind === 'manual'
       ? node.type === 'event.manual' && graph.id === event.graphId && node.id === event.nodeId
       : node.type === 'event.keystroke' && keystrokeAccelerator(node.settings) === event.accelerator;
      if (matches) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, instant));
     }
    }
   }
   return runs;
  },
 };
}
