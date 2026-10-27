import { expect, it } from "vitest";
import type { OutputFrameLimit } from "@opensekai/contracts";
import { createFramePacer, isDue } from "../src/frame-pacer";

interface Frame { seq: number; fps: OutputFrameLimit }
// A fake clock: tasks run in time order, and an apply settles after `applyMs`.
function harness(options: { applyMs?: number; reject?: (frame: Frame) => boolean; onApplied?: (seq: number) => void } = {}) {
    let now = 0, order = 0;
    const tasks: { at: number; order: number; run: () => void; id: number }[] = [];
    const schedule = (run: () => void, ms: number) => { const id = ++order; tasks.push({ at: now + ms, order: id, run, id }); return id; };
    const cancel = (id: unknown) => { const index = tasks.findIndex(task => task.id === id); if (index >= 0) tasks.splice(index, 1); };
    const applied: { seq: number; at: number }[] = [];
    const starts: number[] = [];
    const pacer = createFramePacer<Frame>({
        apply: frame => new Promise((resolve, reject) => {
            starts.push(frame.seq);
            schedule(() => {
                if (options.reject?.(frame)) { reject(Object.assign(new Error("cancelled"), { code: "CANCELLED" })); return; }
                applied.push({ seq: frame.seq, at: now }); options.onApplied?.(frame.seq); resolve(undefined);
            }, options.applyMs ?? 2);
        }),
        fpsOf: frame => frame.fps,
        now: () => now,
        setTimeout: schedule,
        clearTimeout: cancel,
    });
    const timers = () => tasks.length;
    // Run every task up to `until`, and let promise callbacks settle after each task.
    const advance = async (until: number) => {
        for (;;) {
            await Promise.resolve(); await Promise.resolve();
            tasks.sort((a, b) => a.at - b.at || a.order - b.order);
            const next = tasks[0];
            if (!next || next.at > until) break;
            tasks.shift(); now = next.at; next.run();
        }
        now = until;
        await Promise.resolve(); await Promise.resolve();
    };
    return { pacer, applied, starts, advance, schedule, timers, get now() { return now; } };
}
const frames = (count: number, interval: number, fps: OutputFrameLimit, h: ReturnType<typeof harness>) => {
    for (let seq = 1; seq <= count; seq++) h.schedule(() => h.pacer.offer({ seq, fps }), (seq - 1) * interval);
};

it("is due at once at 60 FPS and after the interval minus the slack at 30 FPS", () => {
    expect(isDue(null, 0, 30)).toBe(true);
    expect(isDue(0, 1, 60)).toBe(true);
    expect(isDue(0, 29.2, 30)).toBe(false);
    expect(isDue(0, 1000 / 30 - 4, 30)).toBe(true);
});
it("applies each frame at 60 FPS", async () => {
    const h = harness();
    frames(10, 1000 / 60, 60, h);
    await h.advance(1000);
    expect(h.applied.map(f => f.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
it("applies every second frame at 30 FPS for a 16.7 ms arrival interval", async () => {
    const h = harness();
    frames(10, 1000 / 60, 30, h);
    await h.advance(200);
    expect(h.applied.map(f => f.seq)).toEqual([1, 3, 5, 7, 9, 10]);
    // The last held frame comes from the timer, one interval after the frame before it.
    expect(h.timers()).toBe(0);
});
it("applies the newest held frame when a newer frame replaces it", async () => {
    const h = harness();
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(5); h.pacer.offer({ seq: 2, fps: 30 });
    await h.advance(10); h.pacer.offer({ seq: 3, fps: 30 });
    await h.advance(100);
    expect(h.applied.map(f => f.seq)).toEqual([1, 3]);
    expect(h.starts).toEqual([1, 3]);
    expect(h.applied[1].at).toBeCloseTo(1000 / 30 + 2);
});
it("applies a held frame from the timer when arrivals stop", async () => {
    const h = harness();
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(16); h.pacer.offer({ seq: 2, fps: 30 });
    await h.advance(30);
    expect(h.starts).toEqual([1]);
    await h.advance(40);
    expect(h.starts).toEqual([1, 2]);
});
it("does not move the last-applied time for a rejected apply", async () => {
    const h = harness({ reject: frame => frame.seq === 2 });
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(40); h.pacer.offer({ seq: 2, fps: 30 });
    // Frame 2 starts at 40 and fails at 42. Frame 3 at 45 is due against frame 1 (0), not frame 2 (40).
    await h.advance(45); h.pacer.offer({ seq: 3, fps: 30 });
    await h.advance(60);
    expect(h.starts).toEqual([1, 2, 3]);
    expect(h.applied.map(f => f.seq)).toEqual([1, 3]);
});
it("starts at most one apply for each due time while an apply is in flight", async () => {
    const h = harness({ applyMs: 20 });
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(10); h.pacer.offer({ seq: 2, fps: 30 });
    await h.advance(15); h.pacer.offer({ seq: 3, fps: 30 });
    await h.advance(20);
    expect(h.starts).toEqual([1]);
});
it("applies the next frame at once after a change from 30 to 60 FPS", async () => {
    const h = harness();
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(10); h.pacer.offer({ seq: 2, fps: 30 });
    await h.advance(12); h.pacer.offer({ seq: 3, fps: 60 });
    await h.advance(100);
    expect(h.starts).toEqual([1, 3]);
    expect(h.timers()).toBe(0);
});
it("stops the timer on dispose", async () => {
    const h = harness();
    h.pacer.offer({ seq: 1, fps: 30 });
    await h.advance(10); h.pacer.offer({ seq: 2, fps: 30 });
    h.pacer.dispose();
    h.pacer.offer({ seq: 3, fps: 30 });
    await h.advance(200);
    expect(h.starts).toEqual([1]);
    expect(h.timers()).toBe(0);
});
it("keeps about 30 FPS with jittered arrivals and the 2-frame host cap", async () => {
    // The host model sends on a 60 Hz clock with a jitter, and only while fewer than 2 frames are unacknowledged.
    // An acknowledgment of a newer frame also releases the older frames (coalescing renderer).
    let acked = 0, sent = 0, skipped = 0;
    const h = harness({ onApplied: seq => { acked = Math.max(acked, seq); } });
    const jitter = [12, 21, 16, 18, 15, 19, 12, 21];
    let at = 0;
    for (let tick = 0; at < 5000; tick++) {
        h.schedule(() => {
            if (sent - acked >= 2) { skipped++; return; }
            sent++; h.pacer.offer({ seq: sent, fps: 30 });
        }, at);
        at += jitter[tick % jitter.length];
    }
    const seen = h.applied;
    await h.advance(5000);
    const rate = seen.length / 5;
    expect(rate).toBeGreaterThan(28);
    expect(rate).toBeLessThan(31);
    // The pacer never waits for an arrival that the cap stops.
    const gaps = seen.slice(1).map((frame, index) => frame.at - seen[index].at);
    expect(Math.max(...gaps)).toBeLessThan(1000 / 30 + 21 + 1);
    expect(skipped).toBeGreaterThan(0);
});
it("treats a synchronous throw as a rejected apply", async () => {
    let now = 0; const starts: number[] = [];
    const pacer = createFramePacer<Frame>({ apply: frame => { starts.push(frame.seq); if (frame.seq === 2) throw new Error("sync"); return Promise.resolve(); }, fpsOf: frame => frame.fps, now: () => now, setTimeout: () => 1, clearTimeout: () => {} });
    pacer.offer({ seq: 1, fps: 30 }); await Promise.resolve();
    now = 40; expect(() => pacer.offer({ seq: 2, fps: 30 })).not.toThrow(); await Promise.resolve(); await Promise.resolve();
    now = 45; pacer.offer({ seq: 3, fps: 30 });
    expect(starts).toEqual([1, 2, 3]);
});
