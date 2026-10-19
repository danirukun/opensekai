import { DEBUG_NODE_RATE, DEBUG_TOAST_RATE, DEBUG_WINDOW_MS, formatDebugValue, MAX_DEBUG_ENTRIES, MAX_DEBUG_PAGE, MAX_DEBUG_VALUES, plainDebugText, type BlueprintDebug, type BlueprintValue, type DataType, type DebugEntry, type DebugLevel, type DebugValue, type DebugVariant, type Id } from '@opensekai/contracts';

export type DebugLogEffect = { kind: 'debugLog'; nodeId: Id; level: DebugLevel; message: string };
export type DebugToastEffect = { kind: 'debugToast'; nodeId: Id; variant: DebugVariant; header: string; caption: string; durationSeconds: number };
export type DebugEventEffect = { kind: 'debugEvent'; nodeId: Id; name: string; payloadType?: DataType; payload?: BlueprintValue };
export type DebugEffect = DebugLogEffect | DebugToastEffect | DebugEventEffect;
export const DEBUG_EFFECT_KINDS: ReadonlySet<string> = new Set(['debugLog', 'debugToast', 'debugEvent']);
// What a Debug Value node passed on in a run. It is not an effect: a run with only samples keeps the empty-effects path.
export interface DebugValueSample { nodeId: Id; valueType: DataType; value: BlueprintValue }

// A fixed rate window. `pending` counts the entries dropped since the last kept entry of the key.
export interface RateWindow { startMs: number; count: number; pending: number }
export function admit(window: RateWindow | undefined, nowMs: number, limit: number): { window: RateWindow; kept: boolean; dropped: number } {
 const current = !window || nowMs - window.startMs >= DEBUG_WINDOW_MS ? { startMs: nowMs, count: 0, pending: window?.pending ?? 0 } : window;
 if (current.count >= limit) return { window: { ...current, pending: current.pending + 1 }, kept: false, dropped: 0 };
 return { window: { startMs: current.startMs, count: current.count + 1, pending: 0 }, kept: true, dropped: current.pending };
}

// Equal Blueprint values: scalars by identity, vectors and lists item by item.
export const sameDebugValue = (a: unknown, b: unknown): boolean =>
 Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => sameDebugValue(item, b[i])) : Object.is(a, b);

// A fixed-size ring of entries in sequence order.
export interface DebugRing { push(entry: DebugEntry): void; size(): number; at(index: number): DebugEntry; slice(start: number, end: number): DebugEntry[]; firstAfter(seq: number): number }
export function createDebugRing(capacity = MAX_DEBUG_ENTRIES): DebugRing {
 const items = new Array<DebugEntry | undefined>(capacity);
 let start = 0, count = 0;
 const at = (index: number) => items[(start + index) % capacity]!;
 return {
  push(entry) {
   items[(start + count) % capacity] = entry;
   if (count < capacity) count += 1; else start = (start + 1) % capacity;
  },
  size: () => count,
  at,
  slice: (from, to) => Array.from({ length: Math.max(Math.min(to, count) - from, 0) }, (_, i) => at(from + i)),
  // The index of the first entry with a higher sequence number, or the size when there is none (binary search).
  firstAfter(seq) {
   let low = 0, high = count;
   while (low < high) { const mid = (low + high) >> 1; if (at(mid).seq > seq) high = mid; else low = mid + 1; }
   return low;
  },
 };
}

type EntryBody = DebugEntry extends infer E ? E extends DebugEntry ? Omit<E, 'seq' | 'atMs' | 'graphId' | 'nodeId' | 'dropped'> : never : never;
const entryBody = (effect: DebugEffect): EntryBody =>
 effect.kind === 'debugLog' ? { kind: 'log', level: effect.level, message: plainDebugText(effect.message) }
 : effect.kind === 'debugToast' ? { kind: 'toast', variant: effect.variant, header: plainDebugText(effect.header), caption: plainDebugText(effect.caption), durationSeconds: effect.durationSeconds }
 : { kind: 'event', name: plainDebugText(effect.name), ...(effect.payloadType === undefined ? {} : { valueType: effect.payloadType, text: formatDebugValue(effect.payloadType, effect.payload!) }) };

export interface DebugLog {
 record(graphId: Id, effects: readonly DebugEffect[], samples: readonly DebugValueSample[], nowMs: number): void;
 read(since?: number): BlueprintDebug;
 // Removes the values of nodes for which `keep` is false.
 retainValues(keep: (graphId: Id, nodeId: Id) => boolean): void;
}

// Runtime state only: never saved, never in a frame. `epoch` names this log, so a reader sees a new session.
export function createDebugLog(epoch: string = crypto.randomUUID()): DebugLog {
 let seq = 0, dropped = 0;
 const entries = createDebugRing();
 // Toasts share one window for each graph; the other kinds have one for each node.
 const nodeWindows = new Map<string, RateWindow>(), toastWindows = new Map<string, RateWindow>();
 const values = new Map<string, DebugValue & { raw: BlueprintValue }>();
 const key = (graphId: Id, nodeId: Id) => `${graphId}\0${nodeId}`;
 const prune = (nowMs: number) => {
  for (const windows of [nodeWindows, toastWindows]) {
   if (windows.size <= 4 * MAX_DEBUG_VALUES) continue;
   for (const [id, window] of windows) if (window.pending === 0 && nowMs - window.startMs >= DEBUG_WINDOW_MS) windows.delete(id);
  }
 };
 const setValue = (graphId: Id, sample: DebugValueSample, nowMs: number) => {
  const id = key(graphId, sample.nodeId), old = values.get(id);
  if (old && old.valueType === sample.valueType && sameDebugValue(old.raw, sample.value)) return;
  const text = formatDebugValue(sample.valueType, sample.value);
  if (old && old.valueType === sample.valueType && old.text === text) { values.set(id, { ...old, raw: sample.value }); return; }
  if (!old && values.size >= MAX_DEBUG_VALUES) { dropped += 1; return; }
  values.set(id, { graphId, nodeId: sample.nodeId, valueType: sample.valueType, text, changedMs: nowMs, seq: ++seq, raw: sample.value });
 };
 return {
  record(graphId, effects, samples, nowMs) {
   for (const effect of effects) {
    const windows = effect.kind === 'debugToast' ? toastWindows : nodeWindows;
    const id = effect.kind === 'debugToast' ? graphId : key(graphId, effect.nodeId);
    const decision = admit(windows.get(id), nowMs, effect.kind === 'debugToast' ? DEBUG_TOAST_RATE : DEBUG_NODE_RATE);
    windows.set(id, decision.window);
    if (!decision.kept) { dropped += 1; continue; }
    entries.push({ seq: ++seq, atMs: nowMs, graphId, nodeId: effect.nodeId, ...(decision.dropped > 0 ? { dropped: decision.dropped } : {}), ...entryBody(effect) } as DebugEntry);
   }
   for (const sample of samples) setValue(graphId, sample, nowMs);
   prune(nowMs);
  },
  read(since) {
   const start = since === undefined ? Math.max(entries.size() - MAX_DEBUG_PAGE, 0) : entries.firstAfter(since);
   const page = entries.slice(start, start + MAX_DEBUG_PAGE);
   const more = start + page.length < entries.size();
   // The values are always the full set, so a reader can drop the values of removed nodes.
   return {
    epoch, latest: seq, next: since !== undefined && more ? page.at(-1)!.seq : seq, dropped,
    entries: structuredClone(page),
    values: [...values.values()].map(({ raw: _raw, ...value }) => value),
   };
  },
  retainValues(keep) { for (const [id, value] of values) if (!keep(value.graphId, value.nodeId)) values.delete(id); },
 };
}
