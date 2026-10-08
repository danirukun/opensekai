import { BlueprintSetSchema, keystrokeAccelerator, type AppError, type BlueprintGraph, type Id, type Reply } from '@opensekai/contracts';
import { compileBlueprint, fail, runFlow, type BlueprintEffect, type CompiledBlueprint, type FlowBudget, type PendingDelay } from './blueprint';

export type BlueprintEvent = { kind: 'manual'; graphId: Id; nodeId: Id } | { kind: 'keystroke'; accelerator: string };
export interface GraphRun { graphId: Id; effects: BlueprintEffect[]; error: AppError | null }
export interface BlueprintRuntime { install(graphs: unknown): Reply<BlueprintGraph[]>; keystrokes(): string[]; step(events: BlueprintEvent[], nowMs: number): GraphRun[] }

interface Active { compiled: CompiledBlueprint; logic: string; flip: Map<Id, boolean>; delays: (PendingDelay & { order: number })[] }
const MAX_DELAYS = 32;
// Executable content only: positions and names do not reset runtime state.
export const logicKey = (graph: BlueprintGraph) => JSON.stringify([graph.id, graph.enabled, graph.nodes.map(({ id, type, settings }) => [id, type, settings]), graph.connections]);

export const activeAccelerators = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled)
 .flatMap(graph => graph.nodes.flatMap(node => node.type === 'event.keystroke' ? [keystrokeAccelerator(node.settings)] : [])))].sort();

export function createBlueprintRuntime(): BlueprintRuntime {
 let active: Active[] = [];
 let order = 0;
 const run = (entry: Active, start: { nodeId: Id; port: string }, budget: FlowBudget, nowMs: number): GraphRun => {
  const graphId = entry.compiled.graph.id;
  const result = runFlow(entry.compiled, start, entry.flip, budget, nowMs);
  if (!result.ok) return { graphId, effects: [], error: result.error };
  if (entry.delays.length + result.data.delays.length > MAX_DELAYS) {
   const limit = fail('Blueprint delay limit reached', [graphId]);
   return { graphId, effects: [], error: limit.ok ? null : limit.error };
  }
  entry.flip = result.data.flip;
  entry.delays.push(...result.data.delays.map(delay => ({ ...delay, order: order++ })));
  return { graphId, effects: result.data.effects, error: null };
 };
 return {
  install(graphs) {
   const parsed = BlueprintSetSchema.safeParse(graphs);
   if (!parsed.success) return fail('Invalid Blueprint set');
   const next: Active[] = [];
   for (const graph of parsed.data) {
    const compiled = compileBlueprint(graph);
    if (!compiled.ok) return { ok: false, error: { ...compiled.error, ids: [graph.id, ...compiled.error.ids] } };
    const logic = logicKey(graph);
    const previous = graph.enabled ? active.find(entry => entry.logic === logic) : undefined;
    next.push({ compiled: compiled.data, logic, flip: previous?.flip ?? new Map(), delays: previous?.delays ?? [] });
   }
   active = next;
   return { ok: true, data: parsed.data };
  },
  keystrokes: () => activeAccelerators(active.map(entry => entry.compiled.graph)),
  step(events, nowMs) {
   const budget: FlowBudget = { visits: 256, effects: 64 };
   const runs: GraphRun[] = [];
   const due = active.flatMap(entry => entry.delays.filter(delay => delay.dueMs <= nowMs).map(delay => ({ entry, delay })))
    .sort((a, b) => a.delay.dueMs - b.delay.dueMs || a.delay.order - b.delay.order);
   for (const { entry, delay } of due) {
    entry.delays = entry.delays.filter(item => item !== delay);
    runs.push(run(entry, { nodeId: delay.nodeId, port: 'exit' }, budget, nowMs));
   }
   for (const event of events)
    for (const entry of active) {
     const graph = entry.compiled.graph;
     if (!graph.enabled) continue;
     for (const node of graph.nodes) {
      const matches = event.kind === 'manual'
       ? node.type === 'event.manual' && graph.id === event.graphId && node.id === event.nodeId
       : node.type === 'event.keystroke' && keystrokeAccelerator(node.settings) === event.accelerator;
      if (matches) runs.push(run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs));
     }
    }
   return runs;
  },
 };
}
