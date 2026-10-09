import { expect, it } from 'vitest';
import { fnv1a, nextRandom } from '../src/blueprint-random';

it('hashes with 32-bit FNV-1a', () => {
 expect(fnv1a('')).toBe(0x811c9dc5);
 expect(fnv1a('a')).toBe(0xe40c292c);
 expect(fnv1a('foobar')).toBe(0xbf9cf968);
});

it('steps mulberry32 deterministically within [0, 1)', () => {
 let state = fnv1a('graph');
 const first: number[] = [];
 for (let i = 0; i < 100; i++) { const step = nextRandom(state); first.push(step.value); state = step.state; }
 let again = fnv1a('graph');
 for (const value of first) { const step = nextRandom(again); expect(step.value).toBe(value); again = step.state; }
 expect(first.every(value => value >= 0 && value < 1)).toBe(true);
 expect(new Set(first).size).toBe(100);
});
