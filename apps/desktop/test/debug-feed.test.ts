import { expect, it } from 'vitest';
import type { BlueprintDebug, DebugEntry } from '@opensekai/contracts';
import { debugTime, EMPTY_DEBUG_FEED, mergeDebug, planToasts } from '../src/blueprints/debug-feed';

const log = (seq: number): DebugEntry => ({ seq, atMs: seq, graphId: 'g', nodeId: 'n', kind: 'log', level: 'info', message: `m${seq}` });
const toast = (seq: number, header: string, caption: string, dropped?: number): DebugEntry => ({ seq, atMs: seq, graphId: 'g', nodeId: 't', kind: 'toast', variant: 'success', header, caption, durationSeconds: 2, ...(dropped ? { dropped } : {}) });
const reply = (entries: DebugEntry[], latest: number, next = latest, values: BlueprintDebug['values'] = []): BlueprintDebug => ({ latest, next, dropped: 0, entries, values });

it('fills the feed on the first read without new entries, then reports only new entries', () => {
 const first = mergeDebug(EMPTY_DEBUG_FEED, reply([log(1), log(2)], 3, 3, [{ graphId: 'g', nodeId: 'v', valueType: 'number', text: '1', changedMs: 0, seq: 3 }]));
 expect(first.added).toEqual([]);
 expect(first.state.entries.map(entry => entry.seq)).toEqual([1, 2]);
 expect(first.state.cursor).toBe(3);
 const second = mergeDebug(first.state, reply([log(4)], 5, 5, [{ graphId: 'g', nodeId: 'v', valueType: 'number', text: '2', changedMs: 5, seq: 5 }]));
 expect(second.added.map(entry => entry.seq)).toEqual([4]);
 expect(second.state.values.get('g\0v')?.text).toBe('2');
 // An unchanged read keeps the same state object, so the panel does not draw again.
 expect(mergeDebug(second.state, reply([], 5)).state).toBe(second.state);
});

it('starts again when the session sequence goes below the cursor', () => {
 const state = mergeDebug(EMPTY_DEBUG_FEED, reply([log(1)], 9)).state;
 expect(mergeDebug(state, reply([], 2)).state).toBe(EMPTY_DEBUG_FEED);
});

it('keeps the last 1000 entries', () => {
 let state = mergeDebug(EMPTY_DEBUG_FEED, reply([], 0)).state;
 for (let page = 0; page < 22; page++) state = mergeDebug(state, reply(Array.from({ length: 50 }, (_, i) => log(page * 50 + i + 1)), (page + 1) * 50)).state;
 expect(state.entries).toHaveLength(1000);
 expect(state.entries[0]!.seq).toBe(101);
});

it('shows toasts that fit and merges the rest into one +N more toast', () => {
 expect(planToasts([toast(1, 'Ada', 'Hi'), log(2), toast(3, '', 'Only caption')], 3)).toEqual([
  { variant: 'success', message: 'Ada: Hi', durationMs: 2000 },
  { variant: 'success', message: 'Only caption', durationMs: 2000 },
 ]);
 const many = [1, 2, 3, 4, 5].map(seq => toast(seq, `H${seq}`, ''));
 expect(planToasts(many, 3).map(item => item.message)).toEqual(['H4', 'H5', '+3 more']);
 expect(planToasts([toast(1, 'A', '', 7)], 3).map(item => item.message)).toEqual(['A', '+7 more']);
 expect(planToasts([toast(1, 'A', ''), toast(2, 'B', '')], 1).map(item => item.message)).toEqual(['+2 more']);
 expect(planToasts(many, 0)).toEqual([]);
});

it('formats the session time as minutes, seconds, and milliseconds', () => {
 expect(debugTime(0)).toBe('00:00.000');
 expect(debugTime(61_234.9)).toBe('01:01.234');
});
