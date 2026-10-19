import { MAX_DEBUG_ENTRIES, type AppApi, type BlueprintDebug, type DebugEntry, type DebugValue, type DebugVariant } from '@opensekai/contracts';

// The editor copy of the session debug log (slice F R11). `cursor` is null until the first read of a log `epoch`.
export interface DebugFeedState { epoch: string | null; cursor: number | null; entries: readonly DebugEntry[]; values: ReadonlyMap<string, DebugValue> }
export const EMPTY_DEBUG_FEED: DebugFeedState = { epoch: null, cursor: null, entries: [], values: new Map() };
export const debugKey = (graphId: string, nodeId: string) => `${graphId}\0${nodeId}`;

const sameValues = (old: ReadonlyMap<string, DebugValue>, values: readonly DebugValue[]) =>
 old.size === values.length && values.every(value => old.get(debugKey(value.graphId, value.nodeId))?.seq === value.seq);
// `added` holds the new entries of a later read; the first read fills the feed without them, so old toasts do not show again.
export function mergeDebug(state: DebugFeedState, reply: BlueprintDebug): { state: DebugFeedState; added: DebugEntry[] } {
 // Another epoch is a new session: start again from an empty feed, and read again without a cursor.
 if (state.cursor !== null && reply.epoch !== state.epoch) return { state: EMPTY_DEBUG_FEED, added: [] };
 const last = state.entries.at(-1)?.seq ?? state.cursor ?? 0;
 const fresh = reply.entries.filter(entry => entry.seq > last);
 const keepValues = sameValues(state.values, reply.values);
 if (fresh.length === 0 && keepValues && reply.next === state.cursor) return { state, added: [] };
 // The reply has the full value set, so a node that the session no longer reports loses its text.
 const values = keepValues ? state.values : new Map(reply.values.map(value => [debugKey(value.graphId, value.nodeId), value] as const));
 const entries = fresh.length ? [...state.entries, ...fresh].slice(-MAX_DEBUG_ENTRIES) : state.entries;
 return { state: { epoch: reply.epoch, cursor: reply.next, entries, values }, added: state.cursor === null ? [] : fresh };
}

type ToastEntry = Extract<DebugEntry, { kind: 'toast' }>;
export const debugToastText = (entry: ToastEntry) =>
 entry.header && entry.caption ? `${entry.header}: ${entry.caption}` : entry.header || entry.caption;
export interface PlannedToast { variant: DebugVariant; message: string; durationMs: number }
// The toasts of one poll, newest first, in at most `places` places. A toast with no text shows nothing; the Debug output lists it.
// When there are more toasts than places, the newest `places - 1` show and one `+N more` toast counts the rest and the session drops.
export function planToasts(added: readonly DebugEntry[], places: number): PlannedToast[] {
 const toasts = added.filter((entry): entry is ToastEntry => entry.kind === 'toast' && debugToastText(entry) !== '').reverse();
 if (places <= 0 || toasts.length === 0) return [];
 const plain = toasts.map(entry => ({ variant: entry.variant, message: debugToastText(entry), durationMs: entry.durationSeconds * 1000 }));
 if (plain.length <= places) return plain;
 const dropped = toasts.reduce((sum, entry) => sum + (entry.dropped ?? 0), 0);
 const shown = plain.slice(0, places - 1);
 return [...shown, { variant: 'info', message: `+${plain.length - shown.length + dropped} more`, durationMs: 3000 }];
}

export const debugTime = (ms: number) => {
 const total = Math.floor(ms), minutes = Math.floor(total / 60000), seconds = Math.floor(total / 1000) % 60;
 return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
};

export interface DebugFeed {
 poll(): Promise<void>;
 state(): DebugFeedState;
 subscribe(listener: (state: DebugFeedState) => void): () => void;
 // Hides the entries that the feed has now; the session log does not change.
 clear(): void;
}
const MAX_PAGES = 20;
export function createDebugFeed(api: Pick<AppApi, 'blueprintDebug'>, onAdded: (entries: DebugEntry[]) => void): DebugFeed {
 let current = EMPTY_DEBUG_FEED, busy = false;
 const listeners = new Set<(state: DebugFeedState) => void>();
 const publish = () => { for (const listener of listeners) listener(current); };
 return {
  // Reads all pages, then reports the new entries of the whole poll once, so the toast plan sees them together.
  async poll() {
   if (busy) return;
   busy = true;
   const added: DebugEntry[] = [];
   try {
    for (let page = 0; page < MAX_PAGES; page++) {
     const reply = await api.blueprintDebug(current.cursor === null ? {} : { since: current.cursor });
     if (!reply.ok) break;
     const merged = mergeDebug(current, reply.data);
     const changed = merged.state !== current;
     current = merged.state;
     added.push(...merged.added);
     if (changed) publish();
     if (current.cursor !== null && reply.data.next >= reply.data.latest) break;
    }
   } catch { /* the next poll tries again */ } finally { busy = false; }
   if (added.length) onAdded(added);
  },
  state: () => current,
  subscribe(listener) { listeners.add(listener); listener(current); return () => { listeners.delete(listener); }; },
  clear() { current = { ...current, entries: [] }; publish(); },
 };
}
