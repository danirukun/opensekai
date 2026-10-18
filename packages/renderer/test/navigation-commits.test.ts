import { expect, it } from 'vitest';
import type { Reply, Transform } from '@opensekai/contracts';
import { createNavigationCommitter, type NavigationCommit, type NavigationEnd } from '../src/navigation-commits';

const at = (x: number): Transform => ({ position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
// A fake clock and a fake patch route: each send waits until the test answers it.
function harness(start = 5) {
    let now = 0;
    const timers: { due: number; run: () => void }[] = [];
    const sent: { commit: NavigationCommit; answer(reply: Reply<{ revision: number }>): Promise<void> }[] = [];
    const ends: NavigationEnd[] = [];
    const committer = createNavigationCommitter(start, {
        now: () => now,
        setTimer: (run, ms) => { const timer = { due: now + ms, run }; timers.push(timer); return timer; },
        clearTimer: handle => { const i = timers.indexOf(handle as never); if (i >= 0) timers.splice(i, 1); },
        send: commit => new Promise(resolve => { sent.push({ commit, answer: async reply => { resolve(reply); await Promise.resolve(); await Promise.resolve(); } }); }),
        onEnd: end => { ends.push(end); },
    });
    const advance = (ms: number) => { now += ms; for (const timer of timers.filter(t => t.due <= now)) { timers.splice(timers.indexOf(timer), 1); timer.run(); } };
    return { committer, sent, ends, advance };
}
const ok = (revision: number): Reply<{ revision: number }> => ({ ok: true, data: { revision } });

it('sends at most one patch every 100 ms, each after the previous reply, with the returned revision', async () => {
    const { committer, sent, advance } = harness();
    committer.offer({ transform: at(1) });
    expect(sent.map(s => s.commit)).toEqual([{ transform: at(1), expectedRevision: 5 }]);
    committer.offer({ transform: at(2) });
    committer.offer({ transform: at(3) });
    advance(150);
    expect(sent).toHaveLength(1); // still waiting for the reply
    await sent[0]!.answer(ok(6));
    expect(sent).toHaveLength(2);
    expect(sent[1]!.commit).toEqual({ transform: at(3), expectedRevision: 6 });
    await sent[1]!.answer(ok(7));
    committer.offer({ transform: at(4) });
    expect(sent).toHaveLength(2);
    advance(100);
    expect(sent).toHaveLength(2);
    advance(1);
    expect(sent[2]!.commit).toEqual({ transform: at(4), expectedRevision: 7 });
});

it('sends the last draft at the end at once, then reports the final revision', async () => {
    const { committer, sent, ends, advance } = harness();
    committer.offer({ transform: at(1) });
    await sent[0]!.answer(ok(6));
    committer.offer({ transform: at(2), pivotOffset: [0, 1.3, 1] });
    committer.finish();
    expect(sent[1]!.commit).toEqual({ transform: at(2), pivotOffset: [0, 1.3, 1], expectedRevision: 6 });
    expect(ends).toEqual([]);
    await sent[1]!.answer(ok(7));
    expect(ends).toEqual([{ ok: true, revision: 7, committed: true }]);
    advance(1000);
    expect(sent).toHaveLength(2);
});

it('ends without a commit when nothing moved', () => {
    const { committer, sent, ends } = harness();
    committer.finish();
    expect(sent).toEqual([]);
    expect(ends).toEqual([{ ok: true, revision: 5, committed: false }]);
    expect(committer.active()).toBe(false);
});

it('ends the gesture on CONFLICT and sends nothing more', async () => {
    const { committer, sent, ends, advance } = harness();
    committer.offer({ transform: at(1) });
    committer.offer({ transform: at(2) });
    await sent[0]!.answer({ ok: false, error: { code: 'CONFLICT', message: 'CONFLICT', ids: [] } });
    expect(ends).toEqual([{ ok: false }]);
    committer.offer({ transform: at(3) });
    committer.finish();
    advance(500);
    expect(sent).toHaveLength(1);
});

it('owns only the revisions its own commits explain', async () => {
    const { committer, sent } = harness();
    expect(committer.owns(5)).toBe(true);
    expect(committer.owns(6)).toBe(false);
    committer.offer({ transform: at(1) });
    expect(committer.owns(6)).toBe(true); // the frame can arrive before the reply
    await sent[0]!.answer(ok(6));
    expect(committer.owns(6)).toBe(true);
    expect(committer.owns(7)).toBe(false);
});

it('holds on CONFLICT when asked, then sends the mapped draft with the rebased revision', async () => {
    let conflicts = 0;
    let now = 0;
    const sent: { commit: NavigationCommit; resolve(reply: Reply<{ revision: number }>): void }[] = [];
    const ends: NavigationEnd[] = [];
    const committer = createNavigationCommitter(5, {
        now: () => now, setTimer: () => null, clearTimer: () => {},
        send: commit => new Promise(resolve => { sent.push({ commit, resolve }); }),
        onEnd: end => { ends.push(end); },
        onConflict: () => { conflicts++; return true; },
    });
    const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
    committer.offer({ transform: at(1) });
    sent[0]!.resolve({ ok: false, error: { code: 'CONFLICT', message: 'CONFLICT', ids: [] } });
    await settle();
    expect(conflicts).toBe(1);
    expect(ends).toEqual([]);
    now = 500;
    committer.finish();
    expect(sent).toHaveLength(1); // held until the rebase
    committer.rebase(8, draft => ({ ...draft, transform: at(draft.transform.position[0] + 10) }));
    expect(sent[1]!.commit).toEqual({ transform: at(11), expectedRevision: 8 });
    sent[1]!.resolve(ok(9));
    await settle();
    expect(ends).toEqual([{ ok: true, revision: 9, committed: true }]);
});

it('holds the sends after hold() until a rebase', () => {
    const sent: NavigationCommit[] = [];
    const committer = createNavigationCommitter(5, { now: () => 1000, setTimer: () => null, clearTimer: () => {}, send: commit => { sent.push(commit); return new Promise(() => {}); }, onEnd: () => {} });
    committer.hold();
    committer.offer({ transform: at(1) });
    expect(sent).toEqual([]);
    committer.rebase(7, draft => draft);
    expect(sent).toEqual([{ transform: at(1), expectedRevision: 7 }]);
});
