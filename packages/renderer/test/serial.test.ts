import { describe, expect, it } from 'vitest';
import { serialize } from '../src/serial';

const gate = () => {
    let open!: () => void;
    let fail!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => { open = resolve; fail = reject; });
    return { promise, open, fail };
};
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('serialize', () => {
    it('starts the second run only after the first run resolves', async () => {
        const queue = serialize();
        const first = gate();
        const started: string[] = [];
        const a = queue(async () => { started.push('a'); await first.promise; return 'a'; });
        const b = queue(async () => { started.push('b'); return 'b'; });
        await flush();
        expect(started).toEqual(['a']);
        first.open();
        expect(await Promise.all([a, b])).toEqual(['a', 'b']);
        expect(started).toEqual(['a', 'b']);
    });

    it('starts the runs in the order of the calls', async () => {
        const queue = serialize();
        const started: number[] = [];
        await Promise.all([3, 1, 2].map(n => queue(async () => { started.push(n); await flush(); return n; })));
        expect(started).toEqual([3, 1, 2]);
    });

    it('rejects only the failing caller and still runs later calls', async () => {
        const queue = serialize();
        const first = gate();
        const a = queue(async () => { await first.promise; return 'a'; });
        const b = queue(async () => 'b');
        const failure = expect(a).rejects.toThrow('boom');
        first.fail(new Error('boom'));
        await failure;
        expect(await b).toBe('b');
    });

    it('turns a synchronous throw into a rejection of that call only', async () => {
        const queue = serialize();
        const a = queue((() => { throw new Error('sync'); }) as () => Promise<string>);
        const b = queue(async () => 'b');
        await expect(a).rejects.toThrow('sync');
        expect(await b).toBe('b');
    });

    it('keeps each renderer queue separate', async () => {
        const first = gate();
        const a = serialize()(async () => { await first.promise; return 'a'; });
        expect(await serialize()(async () => 'b')).toBe('b');
        first.open();
        expect(await a).toBe('a');
    });
});
