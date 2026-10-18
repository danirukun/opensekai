import { expect, it } from 'vitest';
import { DEBUG_NODE_RATE, MAX_DEBUG_ENTRIES, MAX_DEBUG_PAGE, MAX_DEBUG_VALUES } from '@opensekai/contracts';
import { admit, createDebugLog, type DebugEffect } from '../src/debug-log';

const log = (nodeId: string, message = 'x'): DebugEffect => ({ kind: 'debugLog', nodeId, level: 'info', message });
const toast = (nodeId: string): DebugEffect => ({ kind: 'debugToast', nodeId, variant: 'success', header: 'H', caption: 'C', durationSeconds: 3 });

it('admits up to the limit in a window and reports the drops on the next kept entry', () => {
 let window = undefined as ReturnType<typeof admit>['window'] | undefined;
 const kept: [boolean, number][] = [];
 for (const now of [0, 10, 20, 999, 1000, 1001]) { const step = admit(window, now, 2); window = step.window; kept.push([step.kept, step.dropped]); }
 expect(kept).toEqual([[true, 0], [true, 0], [false, 0], [false, 0], [true, 2], [true, 0]]);
});

it('keeps the last 1000 entries in sequence order', () => {
 const debug = createDebugLog();
 for (let i = 0; i < 1100; i++) debug.record('g', [log(`n${i}`, `m${i}`)], i * 1000);
 const tail = debug.read();
 expect(tail.latest).toBe(1100);
 expect(tail.entries).toHaveLength(MAX_DEBUG_PAGE);
 expect(tail.entries.at(-1)).toMatchObject({ seq: 1100, atMs: 1_099_000, graphId: 'g', nodeId: 'n1099', kind: 'log', level: 'info', message: 'm1099' });
 // Entries 1 to 100 left the ring; a cursor before them starts at the oldest kept entry.
 const first = debug.read(0);
 expect(first.entries[0]!.seq).toBe(1100 - MAX_DEBUG_ENTRIES + 1);
 expect(first.next).toBe(first.entries.at(-1)!.seq);
 let cursor = 0, count = 0;
 for (;;) { const page = debug.read(cursor); count += page.entries.length; if (page.next === cursor || page.next === page.latest) { cursor = page.next; break; } cursor = page.next; }
 expect(count).toBe(MAX_DEBUG_ENTRIES);
 expect(cursor).toBe(1100);
 expect(debug.read(1100)).toMatchObject({ entries: [], next: 1100 });
});

it('limits each node to 10 entries a second and toasts to 5 a second for each graph', () => {
 const debug = createDebugLog();
 for (let t = 0; t < 60; t++) debug.record('g', [log('a'), log('b'), toast('t1'), toast('t2')], t * 16);
 const read = debug.read(0);
 const count = (predicate: (entry: (typeof read.entries)[number]) => boolean) => read.entries.filter(predicate).length;
 expect(count(entry => entry.nodeId === 'a')).toBe(DEBUG_NODE_RATE);
 expect(count(entry => entry.nodeId === 'b')).toBe(DEBUG_NODE_RATE);
 expect(count(entry => entry.kind === 'toast')).toBe(5);
 expect(read.dropped).toBe(2 * 50 + 115);
 debug.record('g', [log('a'), toast('t2')], 1000);
 expect(debug.read(read.latest).entries).toMatchObject([{ nodeId: 'a', dropped: 50 }, { kind: 'toast', dropped: 115 }]);
});

it('cleans text and formats event payloads', () => {
 const debug = createDebugLog();
 debug.record('g', [{ kind: 'debugLog', nodeId: 'n', level: 'warning', message: 'line\nbreak' }, { kind: 'debugEvent', nodeId: 'e', name: 'chat\u0000', payloadType: 'vector3', payload: [1, 2, 3] }, { kind: 'debugEvent', nodeId: 'e2', name: 'ping' }], 5);
 expect(debug.read().entries).toMatchObject([
  { kind: 'log', level: 'warning', message: 'line break' },
  { kind: 'event', name: 'chat ', valueType: 'vector3', text: '(1, 2, 3)' },
  { kind: 'event', name: 'ping' },
 ]);
 expect(debug.read().entries[2]).not.toHaveProperty('text');
});

it('keeps the latest value of each node and moves it only on change', () => {
 const debug = createDebugLog();
 const value = (nodeId: string, value: number): DebugEffect => ({ kind: 'debugValue', nodeId, valueType: 'number', value });
 debug.record('g', [value('v', 1)], 10);
 debug.record('g', [value('v', 1)], 20);
 expect(debug.read().values).toEqual([{ graphId: 'g', nodeId: 'v', valueType: 'number', text: '1', changedMs: 10, seq: 1 }]);
 debug.record('g', [value('v', 2)], 30);
 expect(debug.read(1).values).toEqual([{ graphId: 'g', nodeId: 'v', valueType: 'number', text: '2', changedMs: 30, seq: 2 }]);
 expect(debug.read(2).values).toEqual([]);
 for (let i = 0; i < MAX_DEBUG_VALUES; i++) debug.record('g', [value(`n${i}`, i)], 40);
 expect(debug.read().values).toHaveLength(MAX_DEBUG_VALUES);
 expect(debug.read().dropped).toBe(1);
 debug.retainValues((_graph, node) => node === 'v');
 expect(debug.read().values.map(item => item.nodeId)).toEqual(['v']);
});
