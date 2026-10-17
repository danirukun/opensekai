import type { Reply, Transform, Vec3 } from '@opensekai/contracts';

// One navigation gesture commits its draft through the normal patch route: at most one patch every
// `intervalMs`, only after the reply to the previous one, and a last patch at the end of the gesture.
export interface NavigationDraft { transform: Transform; pivotOffset?: Vec3 }
export interface NavigationCommit extends NavigationDraft { expectedRevision: number }
export type NavigationEnd = { ok: true; revision: number; committed: boolean } | { ok: false };
export interface CommitterOptions {
    send(commit: NavigationCommit): Promise<Reply<{ revision: number }>>;
    onEnd(end: NavigationEnd): void;
    now(): number;
    setTimer(run: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
    intervalMs?: number;
}
export interface NavigationCommitter {
    offer(draft: NavigationDraft): void;
    finish(): void;
    abort(): void;
    // A frame revision that this gesture's own commits explain. A later revision is another edit.
    owns(revision: number): boolean;
    active(): boolean;
}
export function createNavigationCommitter(revision: number, options: CommitterOptions): NavigationCommitter {
    const interval = options.intervalMs ?? 100;
    let base = revision, pending = false, finishing = false, done = false, committed = false;
    let dirty: NavigationDraft | null = null, lastSent = -Infinity, timer: unknown = null;
    const stopTimer = () => { if (timer !== null) { options.clearTimer(timer); timer = null; } };
    const end = (result: NavigationEnd) => { if (done) return; done = true; stopTimer(); dirty = null; options.onEnd(result); };
    const pump = () => {
        if (done || pending) return;
        if (!dirty) { if (finishing) end({ ok: true, revision: base, committed }); return; }
        const wait = lastSent + interval - options.now();
        // A timer can fire a fraction of a millisecond early against `now`, so wait one more.
        if (!finishing && wait > 0) { if (timer === null) timer = options.setTimer(() => { timer = null; pump(); }, Math.ceil(wait) + 1); return; }
        stopTimer();
        const draft = dirty;
        dirty = null;
        pending = true;
        lastSent = options.now();
        let sent: Promise<Reply<{ revision: number }>>;
        try { sent = options.send({ ...draft, expectedRevision: base }); }
        catch { pending = false; end({ ok: false }); return; }
        sent.then(reply => {
            pending = false;
            if (done) return;
            if (!reply.ok) { end({ ok: false }); return; }
            base = reply.data.revision;
            committed = true;
            pump();
        }, () => { pending = false; end({ ok: false }); });
    };
    return {
        offer(draft) { if (done || finishing) return; dirty = structuredClone(draft); pump(); },
        finish() { if (done) return; finishing = true; pump(); },
        abort() { if (done) return; done = true; stopTimer(); dirty = null; },
        owns(value) { return value <= base + (pending ? 1 : 0); },
        active() { return !done; },
    };
}
