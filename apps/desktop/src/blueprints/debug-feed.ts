import { MAX_DEBUG_ENTRIES, type AppApi, type BlueprintDebug, type DebugEntry, type DebugValue, type DebugVariant } from '@opensekai/contracts';

// The editor copy of the session debug log (slice F R11). `cursor` is null until the first read.
export interface DebugFeedState { cursor: number | null; entries: readonly DebugEntry[]; values: ReadonlyMap<string, DebugValue> }
export const EMPTY_DEBUG_FEED: DebugFeedState = { cursor: null, entries: [], values: new Map() };
export const debugKey = (graphId: string, nodeId: string) => `${graphId}\0${nodeId}`;

// `added` holds the new entries of a later read; the first read fills the feed without them, so old toasts do not show again.
export function mergeDebug(state: DebugFeedState, reply: BlueprintDebug): { state: DebugFeedState; added: DebugEntry[] } {
 // A lower sequence than the cursor means a new session: start again from an empty feed.
 if (state.cursor !== null && reply.latest < state.cursor) return { state: EMPTY_DEBUG_FEED, added: [] };
 const last = state.entries.at(-1)?.seq ?? state.cursor ?? 0;
 const fresh = reply.entries.filter(entry => entry.seq > last);
 if (fresh.length === 0 && reply.values.length === 0 && reply.next === state.cursor) return { state, added: [] };
 const values = new Map(state.values);
 for (const value of reply.values) values.set(debugKey(value.graphId, value.nodeId), value);
 const entries = fresh.length ? [...state.entries, ...fresh].slice(-MAX_DEBUG_ENTRIES) : state.entries;
 return { state: { cursor: reply.next, entries, values }, added: state.cursor === null ? [] : fresh };
}

export const debugToastText = (entry: Extract<DebugEntry, { kind: 'toast' }>) =>
 entry.header && entry.caption ? `${entry.header}: ${entry.caption}` : entry.header || entry.caption;
export interface PlannedToast { variant: DebugVariant; message: string; durationMs: number }
// At most `places` toasts. When the new toasts (and the ones the session dropped) do not fit, the newest show and one `+N more` toast counts the rest.
export function planToasts(added: readonly DebugEntry[], places: number): PlannedToast[] {
 const toasts = added.filter((entry): entry is Extract<DebugEntry, { kind: 'toast' }> => entry.kind === 'toast');
 const dropped = toasts.reduce((sum, entry) => sum + (entry.dropped ?? 0), 0);
 if (places <= 0 || toasts.length === 0) return [];
 const plain = toasts.map(entry => ({ variant: entry.variant, message: debugToastText(entry), durationMs: entry.durationSeconds * 1000 }));
 if (plain.length + (dropped > 0 ? 1 : 0) <= places) return dropped > 0 ? [...plain, more(dropped)] : plain;
 const shown = plain.slice(plain.length - (places - 1));
 return [...shown, more(plain.length - shown.length + dropped)];
}
const more = (count: number): PlannedToast => ({ variant: 'info', message: `+${count} more`, durationMs: 3000 });

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
  async poll() {
   if (busy) return;
   busy = true;
   try {
    for (let page = 0; page < MAX_PAGES; page++) {
     const reply = await api.blueprintDebug(current.cursor === null ? {} : { since: current.cursor });
     if (!reply.ok) return;
     const before = current;
     const merged = mergeDebug(current, reply.data);
     current = merged.state;
     if (merged.added.length) onAdded(merged.added);
     if (current !== before) publish();
     if (current.cursor === null || reply.data.next >= reply.data.latest) return;
    }
   } catch { /* the next poll tries again */ } finally { busy = false; }
  },
  state: () => current,
  subscribe(listener) { listeners.add(listener); listener(current); return () => { listeners.delete(listener); }; },
  clear() { current = { ...current, entries: [] }; publish(); },
 };
}
