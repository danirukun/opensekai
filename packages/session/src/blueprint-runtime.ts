import { BlueprintSetSchema, defaultBlueprintValue, isBlueprintValue, keystrokeAccelerator, type AppError, type BlueprintGraph, type BlueprintNode, type BlueprintValue, type DeviceEvent, type DeviceKind, type Id, type Reply } from '@opensekai/contracts';
import { deviceTrigger, emptyState, isTrackingTrigger, setNodeState, trackingTrigger, type TrackingEdge, type NodeRequest, type RunEnv, type RunState } from './blueprint-eval';
import { activeDevices } from './devices';
import { fnv1a } from './blueprint-random';
import type { DebugValueSample } from './debug-log';
import { compileBlueprint, fail, runFlow, type BlueprintEffect, type CompiledBlueprint, type FlowBudget, type PendingDelay } from './blueprint';

export type BlueprintEvent = { kind: 'manual'; graphId: Id; nodeId: Id } | { kind: 'keystroke'; accelerator: string } | { kind: 'device'; event: DeviceEvent } | { kind: 'tracking' } | { kind: 'update' }
 | { kind: 'custom'; name: string; payload: BlueprintValue | null };
export type StepEnv = Omit<RunEnv, 'deltaSeconds'>;
// `debug` (slice F): the Debug Value samples of an accepted run. `nodeId` is the node that started the run (set on each run that `step` returns). `external` marks a run that a `custom` step event
// started, directly or through the events that its runs emitted.
export interface GraphRun { graphId: Id; effects: BlueprintEffect[]; error: AppError | null; nodeId?: Id; external?: true; debug?: DebugValueSample[] }
// Called once per run, right after the run, before the next one. A returned error keeps the run's Flip Flop state and new delays uncommitted.
export type RunGate = (run: GraphRun) => AppError | null;
export interface BlueprintRuntime { install(graphs: unknown, fresh?: boolean): Reply<BlueprintGraph[]>; installCompiled(graphs: readonly CompiledBlueprint[], fresh?: boolean): void; keystrokes(): string[]; heldKeys(): string[]; devices(): DeviceKind[]; step(events: BlueprintEvent[], nowMs: number, gate?: RunGate, env?: StepEnv): GraphRun[]; takeControlRequests(): ControlRequest[] }
// A Blueprint control request of a committed run, in run order. The session applies them after the step.
export interface ControlRequest { sourceGraphId: Id; graphId: Id; action: 'enable' | 'disable' | 'toggle' }

type Delay = PendingDelay & { order: number };
export interface Timer { name: string; dueMs: number; intervalMs: number; repeat: boolean; order: number }
type OnEventNode = Extract<BlueprintNode, { type: 'event.custom' }>;
interface Active { compiled: CompiledBlueprint; logic: string; state: RunState; delays: Delay[]; enable: boolean; lastUpdateMs?: number; timers: Timer[]; trackingEdges: Map<Id, TrackingEdge>; listeners: ReadonlyMap<string, readonly OnEventNode[]> }
const MAX_DELAYS = 32, TICK_VISITS = 1024, TICK_EFFECTS = 64;
export const MAX_TIMERS = 16, MAX_EVENT_HOPS = 8, TICK_EVENTS = 64;
// Executable content only: positions and names do not reset runtime state.
export const logicKey = (graph: BlueprintGraph) => JSON.stringify([graph.id, graph.enabled, graph.nodes.map(({ id, type, settings }) => [id, type, settings]), graph.connections, (graph.variables ?? []).map(({ id, type, default: value }) => [id, type, value])]);
export const initialState = (graph: BlueprintGraph): RunState =>
 ({ ...emptyState(fnv1a(graph.id)), variables: new Map((graph.variables ?? []).map(variable => [variable.id, variable.default])) });

export const activeAccelerators = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled)
 .flatMap(graph => graph.nodes.flatMap(node => node.type === 'event.keystroke' ? [keystrokeAccelerator(node.settings)] : [])))].sort();
export const activeHeldKeys = (graphs: readonly BlueprintGraph[]): string[] => [...new Set(graphs.filter(graph => graph.enabled).flatMap(graph => graph.nodes.flatMap(node =>
 node.type === 'input.keyHeld' ? [node.settings.code] : node.type === 'input.keyAxis' ? [node.settings.negative, node.settings.positive] : [])))].sort();

// The graphs whose triggers the host must listen to: each enabled graph, and each graph that an Enable or Toggle Blueprint node
// of a listened graph names. A node can enable only a listened graph, so a runtime toggle never needs a new host set.
export const listenedGraphs = (graphs: readonly BlueprintGraph[]): BlueprintGraph[] => {
 const byId = new Map(graphs.map(graph => [graph.id, graph]));
 const seen = new Set(graphs.filter(graph => graph.enabled).map(graph => graph.id));
 const queue = [...seen];
 while (queue.length > 0) {
  for (const node of byId.get(queue.pop()!)!.nodes)
   if ((node.type === 'blueprint.enable' || node.type === 'blueprint.toggle') && byId.has(node.settings.graphId) && !seen.has(node.settings.graphId)) {
    seen.add(node.settings.graphId); queue.push(node.settings.graphId);
   }
 }
 return graphs.filter(graph => seen.has(graph.id)).map(graph => (graph.enabled ? graph : { ...graph, enabled: true }));
};

// Pending delays after a committed run: its new delays, then each Debounce replaces the pending delays of its node.
export const nextDelays = (delays: readonly Delay[], added: readonly PendingDelay[], requests: readonly NodeRequest[], nowMs: number, order: () => number): Delay[] => {
 let list = [...delays, ...added.map(delay => ({ ...delay, order: order() }))];
 for (const request of requests)
  if (request.kind === 'debounce') list = [...list.filter(delay => delay.nodeId !== request.nodeId), { nodeId: request.nodeId, dueMs: nowMs + request.seconds * 1000, order: order() }];
 return list;
};
// Timers after a committed run: Start Timer starts or restarts a timer by name, Stop Timer removes it.
export const nextTimers = (timers: readonly Timer[], requests: readonly NodeRequest[], nowMs: number, order: () => number): Timer[] => {
 let list = [...timers];
 for (const request of requests) {
  if (request.kind === 'stopTimer') list = list.filter(timer => timer.name !== request.name);
  if (request.kind === 'startTimer') list = [...list.filter(timer => timer.name !== request.name), { name: request.name, dueMs: nowMs + request.seconds * 1000, intervalMs: request.seconds * 1000, repeat: request.repeat, order: order() }];
 }
 return list;
};
// A due timer after it fires: one-shot timers end; a repeating timer is due one interval later, and never again in this step.
export const rescheduleTimer = (timer: Timer, nowMs: number, order: number): Timer | null => {
 if (!timer.repeat) return null;
 const next = timer.dueMs + timer.intervalMs;
 return { ...timer, dueMs: next > nowMs ? next : nowMs + timer.intervalMs, order };
};
// Writes the payload output of On Event into the run's state copy: the event payload when it fits the output type, else the type default.
const seedPayload = (node: OnEventNode, payload: BlueprintValue | null) => (state: RunState): void => {
 if (node.settings.payload === 'none') return;
 const type = node.settings.payload;
 setNodeState(state, node.id, payload !== null && isBlueprintValue(type, payload) ? payload : defaultBlueprintValue(type));
};
// On Event nodes of a graph by event name, in node order.
const eventListeners = (graph: BlueprintGraph): Map<string, OnEventNode[]> => {
 const listeners = new Map<string, OnEventNode[]>();
 for (const node of graph.nodes) if (node.type === 'event.custom') listeners.set(node.settings.name, [...(listeners.get(node.settings.name) ?? []), node]);
 return listeners;
};
// What started a run: the hop count of its event (0 for any other start), and whether an external event caused it.
interface Origin { hop: number; external: boolean }
const DIRECT: Origin = { hop: 0, external: false };
interface QueuedEvent extends Origin { name: string; payload: BlueprintValue | null }
// The event state of one step: the FIFO queue, the delivered count, and whether runs deliver at once.
interface StepEvents { queue: QueuedEvent[]; count: number; live: boolean; draining: boolean }
const limitRun = (graphId: Id, message: string, ids: Id[]): GraphRun => ({ graphId, effects: [], error: { code: 'INVALID_INPUT', message, ids } });

export function createBlueprintRuntime(): BlueprintRuntime {
 let active: Active[] = [];
 // Started versions that an install replaced or disabled; their On Disable nodes run at the start of the next step.
 // A version departs once and only after it started, so between two steps at most one version for each started graph (8) waits here.
 let leaving: Active[] = [];
 let controls: ControlRequest[] = [];
 let order = 0;
 const nextOrder = () => order++;
 // `events` is the event accounting of the step; `seed` writes into the run's state copy before the run (the On Event payload).
 const run = (entry: Active, start: { nodeId: Id; port: string }, budget: FlowBudget, nowMs: number, gate: RunGate, env: RunEnv, events?: StepEvents, origin: Origin = DIRECT, seed?: (state: RunState) => void): GraphRun => {
  const graphId = entry.compiled.graph.id;
  const result = runFlow(entry.compiled, start, entry.state, budget, nowMs, env, seed);
  if (!result.ok) return { graphId, effects: [], error: result.error };
  const requests = result.data.requests;
  const delays = nextDelays(entry.delays, result.data.delays, requests, nowMs, nextOrder);
  if (delays.length > MAX_DELAYS) return limitRun(graphId, 'Blueprint delay limit reached', [graphId]);
  const timers = nextTimers(entry.timers, requests, nowMs, nextOrder);
  if (timers.length > MAX_TIMERS) return limitRun(graphId, 'Blueprint timer limit reached', [graphId]);
  const emits = requests.flatMap(request => (request.kind === 'emit' ? [request] : []));
  if (emits.length > 0 && origin.hop + 1 > MAX_EVENT_HOPS) return limitRun(graphId, 'Blueprint event hop limit reached', [emits[0]!.nodeId]);
  if (emits.length > 0 && (events?.count ?? 0) + emits.length > TICK_EVENTS) return limitRun(graphId, 'Blueprint event limit reached', [emits[0]!.nodeId]);
  const outcome: GraphRun = { graphId, effects: result.data.effects, error: null, ...(result.data.debug.length ? { debug: result.data.debug } : {}) };
  const rejected = gate(outcome);
  if (rejected) return { graphId, effects: [], error: rejected };
  entry.state = result.data.state;
  entry.delays = delays;
  entry.timers = timers;
  for (const request of requests) if (request.kind === 'control') controls.push({ sourceGraphId: graphId, graphId: request.graphId, action: request.action });
  if (events) { events.count += emits.length; events.queue.push(...emits.map(emit => ({ name: emit.name, payload: emit.payload, hop: origin.hop + 1, external: origin.external }))); }
  return outcome;
 };
 const installCompiled = (graphs: readonly CompiledBlueprint[], fresh = false): void => {
  const kept = new Set<Active>();
  const next = graphs.map(compiled => {
   const logic = logicKey(compiled.graph);
   const previous = compiled.graph.enabled && !fresh ? active.find(entry => entry.logic === logic) : undefined;
   if (previous) kept.add(previous);
   // A new state on an enabled graph runs its On Enable nodes on the next step.
   const listeners = eventListeners(compiled.graph);
   return previous ? { ...previous, compiled, listeners } : { compiled, logic, state: initialState(compiled.graph), delays: [], timers: [], trackingEdges: new Map(), enable: compiled.graph.enabled, listeners };
  });
  // A started, enabled version that is not kept departs. A show open (`fresh`) runs no On Disable.
  // Its delays, debounces, and timers end now, so they never fire and its On Disable starts from no pending schedule.
  const departing = fresh ? [] : active.filter(entry => !kept.has(entry) && entry.compiled.graph.enabled && !entry.enable);
  leaving = fresh ? [] : [...leaving, ...departing.map(entry => ({ ...entry, delays: [], timers: [] }))];
  active = next;
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
  keystrokes: () => activeAccelerators(listenedGraphs(active.map(entry => entry.compiled.graph))),
  heldKeys: () => activeHeldKeys(listenedGraphs(active.map(entry => entry.compiled.graph))),
  devices: () => activeDevices(listenedGraphs(active.map(entry => entry.compiled.graph))),
  takeControlRequests: () => { const taken = controls; controls = []; return taken; },
  step(events, nowMs, gate = () => null, base: StepEnv = { held: new Set<string>(), scene: () => null }) {
   // Requests of an earlier step that threw before the session took them are stale.
   controls = [];
   const budget: FlowBudget = { visits: TICK_VISITS, effects: TICK_EFFECTS };
   const enabled = new Map(active.map(entry => [entry.compiled.graph.id, entry.compiled.graph.enabled] as const));
   base = { ...base, nowMs, graphEnabled: graphId => enabled.get(graphId) ?? false };
   const instant: RunEnv = { ...base, deltaSeconds: 0 };
   const runs: GraphRun[] = [];
   // Custom events: delivered after each run once `live`; phases 1 and 2 deliver at the end of phase 2.
   const queued: StepEvents = { queue: [], count: 0, live: false, draining: false };
   const drain = () => {
    if (queued.draining) return;
    queued.draining = true;
    for (let event = queued.queue.shift(); event; event = queued.queue.shift())
     for (const entry of active)
      for (const node of entry.compiled.graph.enabled ? entry.listeners.get(event.name) ?? [] : []) {
       const result = run(entry, { nodeId: node.id, port: 'flow' }, budget, nowMs, gate, instant, queued, event, seedPayload(node, event.payload));
       runs.push({ ...result, nodeId: node.id, ...(event.external ? { external: true as const } : {}) });
      }
    queued.draining = false;
   };
   const fire = (entry: Active, start: { nodeId: Id; port: string }, env: RunEnv, runBudget = budget) => {
    runs.push({ ...run(entry, start, runBudget, nowMs, gate, env, queued), nodeId: start.nodeId });
    if (queued.live) drain();
   };
   // Phase 1: On Disable of departing versions, with their own budget. Their delays and timers go with them.
   const departing = leaving;
   leaving = [];
   const departBudget: FlowBudget = { visits: TICK_VISITS, effects: TICK_EFFECTS };
   for (const entry of departing)
    for (const node of entry.compiled.graph.nodes)
     if (node.type === 'event.disable') fire(entry, { nodeId: node.id, port: 'flow' }, instant, departBudget);
   for (const entry of active) {
    if (!entry.enable) continue;
    entry.enable = false;
    for (const node of entry.compiled.graph.nodes)
     if (node.type === 'event.enable') fire(entry, { nodeId: node.id, port: 'flow' }, instant);
   }
   queued.live = true;
   drain();
   // Phase 3: due delays, debounces, and timers by due time, then schedule order.
   const due = [
    ...active.flatMap(entry => entry.delays.filter(delay => delay.dueMs <= nowMs).map(delay => ({ entry, at: delay.dueMs, order: delay.order, delay, timer: undefined }))),
    ...active.flatMap(entry => entry.timers.filter(timer => timer.dueMs <= nowMs).map(timer => ({ entry, at: timer.dueMs, order: timer.order, delay: undefined, timer }))),
   ].sort((a, b) => a.at - b.at || a.order - b.order);
   for (const { entry, delay, timer } of due) {
    if (delay) {
     // A Debounce entry earlier in this step can replace a due delay.
     if (!entry.delays.includes(delay)) continue;
     entry.delays = entry.delays.filter(item => item !== delay);
     fire(entry, { nodeId: delay.nodeId, port: 'exit' }, instant);
     continue;
    }
    if (!timer || !entry.timers.includes(timer)) continue;
    const next = rescheduleTimer(timer, nowMs, nextOrder());
    entry.timers = entry.timers.flatMap(item => (item !== timer ? [item] : next ? [next] : []));
    for (const node of entry.compiled.graph.nodes)
     if (node.type === 'timer.on' && node.settings.name === timer.name) fire(entry, { nodeId: node.id, port: 'flow' }, instant);
   }
   for (const event of events) {
    if (event.kind === 'update') {
     for (const entry of active) {
      const graph = entry.compiled.graph;
      const starts = graph.enabled ? graph.nodes.filter(node => node.type === 'event.update') : [];
      if (starts.length === 0) continue;
      const deltaSeconds = entry.lastUpdateMs === undefined ? 0 : Math.min(Math.max((nowMs - entry.lastUpdateMs) / 1000, 0), 0.1);
      entry.lastUpdateMs = nowMs;
      for (const node of starts) fire(entry, { nodeId: node.id, port: 'flow' }, { ...base, deltaSeconds });
     }
     continue;
    }
    if (event.kind === 'device') {
     for (const entry of active)
      for (const node of entry.compiled.graph.enabled ? entry.compiled.graph.nodes : [])
       if (deviceTrigger(node, event.event)) fire(entry, { nodeId: node.id, port: 'flow' }, { ...instant, trigger: event.event });
     continue;
    }
    if (event.kind === 'tracking') {
     for (const entry of active)
      for (const node of entry.compiled.graph.enabled ? entry.compiled.graph.nodes : []) {
       if (!isTrackingTrigger(node)) continue;
       const result = trackingTrigger(node, entry.trackingEdges.get(node.id), instant, nowMs);
       entry.trackingEdges.set(node.id, result.edge);
       if (result.port) fire(entry, { nodeId: node.id, port: result.port }, instant);
      }
     continue;
    }
    if (event.kind === 'custom') {
     queued.count += 1;
     queued.queue.push({ name: event.name, payload: event.payload, hop: 1, external: true });
     drain();
     continue;
    }
    for (const entry of active) {
     const graph = entry.compiled.graph;
     if (!graph.enabled) continue;
     for (const node of graph.nodes) {
      const matches = event.kind === 'manual'
       ? node.type === 'event.manual' && graph.id === event.graphId && node.id === event.nodeId
       : node.type === 'event.keystroke' && keystrokeAccelerator(node.settings) === event.accelerator;
      if (matches) fire(entry, { nodeId: node.id, port: 'flow' }, instant);
     }
    }
   }
   return runs;
  },
 };
}
