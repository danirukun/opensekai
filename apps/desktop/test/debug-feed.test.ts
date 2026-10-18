import { expect, it } from 'vitest';
import type { AppApi, BlueprintDebug, DebugEntry, DebugValue } from '@opensekai/contracts';
import { createDebugFeed, debugTime, EMPTY_DEBUG_FEED, mergeDebug, planToasts } from '../src/blueprints/debug-feed';

const log = (seq: number): DebugEntry => ({ seq, atMs: seq, graphId: 'g', nodeId: 'n', kind: 'log', level: 'info', message: `m${seq}` });
const toast = (seq: number, header: string, caption: string, dropped?: number): DebugEntry => ({ seq, atMs: seq, graphId: 'g', nodeId: 't', kind: 'toast', variant: 'success', header, caption, durationSeconds: 2, ...(dropped ? { dropped } : {}) });
const value = (nodeId: string, text: string, seq: number): DebugValue => ({ graphId: 'g', nodeId, valueType: 'number', text, changedMs: seq, seq });
const reply = (entries: DebugEntry[], latest: number, next = latest, values: DebugValue[] = [], epoch = 'e1'): BlueprintDebug => ({ epoch, latest, next, dropped: 0, entries, values });

it('fills the feed on the first read without new entries, then reports only new entries', () => {
 const first = mergeDebug(EMPTY_DEBUG_FEED, reply([log(1), log(2)], 3, 3, [value('v', '1', 3)]));
 expect(first.added).toEqual([]);
 expect(first.state.entries.map(entry => entry.seq)).toEqual([1, 2]);
 expect(first.state).toMatchObject({ cursor: 3, epoch: 'e1' });
 const second = mergeDebug(first.state, reply([log(4)], 5, 5, [value('v', '2', 5)]));
 expect(second.added.map(entry => entry.seq)).toEqual([4]);
 expect(second.state.values.get('g\0v')?.text).toBe('2');
 // An unchanged read keeps the same state object, so the panel does not draw again.
 expect(mergeDebug(second.state, reply([], 5, 5, [value('v', '2', 5)])).state).toBe(second.state);
});

it('drops the values that the session no longer reports', () => {
 const state = mergeDebug(EMPTY_DEBUG_FEED, reply([], 2, 2, [value('a', '1', 1), value('b', '2', 2)])).state;
 const next = mergeDebug(state, reply([], 2, 2, [value('a', '1', 1)])).state;
 expect([...next.values.keys()]).toEqual(['g\0a']);
});

it('starts again when the epoch of the log changes', () => {
 const state = mergeDebug(EMPTY_DEBUG_FEED, reply([log(1)], 9)).state;
 expect(mergeDebug(state, reply([], 20, 20, [], 'e2')).state).toBe(EMPTY_DEBUG_FEED);
});

it('keeps the last 1000 entries', () => {
 let state = mergeDebug(EMPTY_DEBUG_FEED, reply([], 0)).state;
 for (let page = 0; page < 22; page++) state = mergeDebug(state, reply(Array.from({ length: 50 }, (_, i) => log(page * 50 + i + 1)), (page + 1) * 50)).state;
 expect(state.entries).toHaveLength(1000);
 expect(state.entries[0]!.seq).toBe(101);
});

it('plans toasts newest first, with one +N more only when they do not fit', () => {
 expect(planToasts([toast(1, 'Ada', 'Hi'), log(2), toast(3, '', 'Only caption')], 3)).toEqual([
  { variant: 'success', message: 'Only caption', durationMs: 2000 },
  { variant: 'success', message: 'Ada: Hi', durationMs: 2000 },
 ]);
 const many = [1, 2, 3, 4, 5].map(seq => toast(seq, `H${seq}`, ''));
 expect(planToasts(many, 3).map(item => item.message)).toEqual(['H5', 'H4', '+3 more']);
 // Session drops count in the text but take no place.
 expect(planToasts([toast(1, 'A', '', 7)], 3).map(item => item.message)).toEqual(['A']);
 expect(planToasts([toast(1, 'A', '', 7), toast(2, 'B', '')], 1).map(item => item.message)).toEqual(['+9 more']);
 // A toast with no text shows nothing.
 expect(planToasts([toast(1, '', '')], 3)).toEqual([]);
 expect(planToasts(many, 0)).toEqual([]);
});

it('reports the new entries of all pages of one poll together', async () => {
 const pages = [reply([], 0, 0), reply([log(1), toast(2, 'A', '')], 4, 2), reply([toast(3, 'B', ''), toast(4, 'C', '')], 4, 4)];
 const api: Pick<AppApi, 'blueprintDebug'> = { blueprintDebug: async () => ({ ok: true, data: pages.shift()! }) };
 const calls: DebugEntry[][] = [];
 const feed = createDebugFeed(api, entries => calls.push(entries));
 await feed.poll();
 await feed.poll();
 expect(calls.map(entries => entries.map(entry => entry.seq))).toEqual([[1, 2, 3, 4]]);
 expect(planToasts(calls[0]!, 2).map(item => item.message)).toEqual(['C', '+2 more']);
});

it('formats the session time as minutes, seconds, and milliseconds', () => {
 expect(debugTime(0)).toBe('00:00.000');
 expect(debugTime(61_234.9)).toBe('01:01.234');
});
