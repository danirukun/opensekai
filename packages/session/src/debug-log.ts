import { DEBUG_NODE_RATE, DEBUG_TOAST_RATE, DEBUG_WINDOW_MS, formatDebugValue, MAX_DEBUG_ENTRIES, MAX_DEBUG_PAGE, MAX_DEBUG_VALUES, plainDebugText, type BlueprintDebug, type BlueprintValue, type DataType, type DebugEntry, type DebugLevel, type DebugValue, type DebugVariant, type Id } from '@opensekai/contracts';

export type DebugLogEffect = { kind: 'debugLog'; nodeId: Id; level: DebugLevel; message: string };
export type DebugToastEffect = { kind: 'debugToast'; nodeId: Id; variant: DebugVariant; header: string; caption: string; durationSeconds: number };
export type DebugEventEffect = { kind: 'debugEvent'; nodeId: Id; name: string; payloadType?: DataType; payload?: BlueprintValue };
export type DebugValueEffect = { kind: 'debugValue'; nodeId: Id; valueType: DataType; value: BlueprintValue };
export type DebugEffect = DebugLogEffect | DebugToastEffect | DebugEventEffect | DebugValueEffect;
export const DEBUG_EFFECT_KINDS: ReadonlySet<string> = new Set(['debugLog', 'debugToast', 'debugEvent', 'debugValue']);

// A fixed rate window. `pending` counts the entries dropped since the last kept entry of the key.
export interface RateWindow { startMs: number; count: number; pending: number }
export function admit(window: RateWindow | undefined, nowMs: number, limit: number): { window: RateWindow; kept: boolean; dropped: number } {
 const current = !window || nowMs - window.startMs >= DEBUG_WINDOW_MS ? { startMs: nowMs, count: 0, pending: window?.pending ?? 0 } : window;
 if (current.count >= limit) return { window: { ...current, pending: current.pending + 1 }, kept: false, dropped: 0 };
 return { window: { startMs: current.startMs, count: current.count + 1, pending: 0 }, kept: true, dropped: current.pending };
}

type EntryBody = DebugEntry extends infer E ? E extends DebugEntry ? Omit<E, 'seq' | 'atMs' | 'graphId' | 'nodeId' | 'dropped'> : never : never;
const entryBody = (effect: Exclude<DebugEffect, DebugValueEffect>): EntryBody =>
 effect.kind === 'debugLog' ? { kind: 'log', level: effect.level, message: plainDebugText(effect.message) }
 : effect.kind === 'debugToast' ? { kind: 'toast', variant: effect.variant, header: plainDebugText(effect.header), caption: plainDebugText(effect.caption), durationSeconds: effect.durationSeconds }
 : { kind: 'event', name: plainDebugText(effect.name), ...(effect.payloadType === undefined ? {} : { valueType: effect.payloadType, text: formatDebugValue(effect.payloadType, effect.payload!) }) };

export interface DebugLog {
 record(graphId: Id, effects: readonly DebugEffect[], nowMs: number): void;
 read(since?: number): BlueprintDebug;
 // Removes the values of nodes for which `keep` is false.
 retainValues(keep: (graphId: Id, nodeId: Id) => boolean): void;
}

// Runtime state only: never saved, never in a frame.
export function createDebugLog(): DebugLog {
 let seq = 0, dropped = 0;
 let entries: DebugEntry[] = [];
 const windows = new Map<string, RateWindow>();
 const values = new Map<string, DebugValue>();
 const key = (graphId: Id, nodeId: Id) => `${graphId}\0${nodeId}`;
 const prune = (nowMs: number) => {
  if (windows.size <= 4 * MAX_DEBUG_VALUES) return;
  for (const [id, window] of windows) if (window.pending === 0 && nowMs - window.startMs >= DEBUG_WINDOW_MS) windows.delete(id);
 };
 const setValue = (graphId: Id, effect: DebugValueEffect, nowMs: number) => {
  const id = key(graphId, effect.nodeId), text = formatDebugValue(effect.valueType, effect.value), old = values.get(id);
  if (old && old.text === text && old.valueType === effect.valueType) return;
  if (!old && values.size >= MAX_DEBUG_VALUES) { dropped += 1; return; }
  values.set(id, { graphId, nodeId: effect.nodeId, valueType: effect.valueType, text, changedMs: nowMs, seq: ++seq });
 };
 return {
  record(graphId, effects, nowMs) {
   for (const effect of effects) {
    if (effect.kind === 'debugValue') { setValue(graphId, effect, nowMs); continue; }
    // Toasts share one window for each graph; the other kinds have one for each node.
    const id = effect.kind === 'debugToast' ? `toast\0${graphId}` : key(graphId, effect.nodeId);
    const decision = admit(windows.get(id), nowMs, effect.kind === 'debugToast' ? DEBUG_TOAST_RATE : DEBUG_NODE_RATE);
    windows.set(id, decision.window);
    if (!decision.kept) { dropped += 1; continue; }
    entries.push({ seq: ++seq, atMs: nowMs, graphId, nodeId: effect.nodeId, ...(decision.dropped > 0 ? { dropped: decision.dropped } : {}), ...entryBody(effect) } as DebugEntry);
   }
   if (entries.length > MAX_DEBUG_ENTRIES) entries = entries.slice(-MAX_DEBUG_ENTRIES);
   prune(nowMs);
  },
  read(since) {
   const start = since === undefined ? Math.max(entries.length - MAX_DEBUG_PAGE, 0) : entries.findIndex(entry => entry.seq > since);
   const page = start < 0 ? [] : entries.slice(start, start + MAX_DEBUG_PAGE);
   const last = page.at(-1);
   const more = since !== undefined && last !== undefined && last.seq < entries.at(-1)!.seq;
   return {
    latest: seq, next: more ? last.seq : seq, dropped,
    entries: structuredClone(page),
    values: [...values.values()].filter(value => since === undefined || value.seq > since).map(value => ({ ...value })),
   };
  },
  retainValues(keep) { for (const [id, value] of values) if (!keep(value.graphId, value.nodeId)) values.delete(id); },
 };
}
