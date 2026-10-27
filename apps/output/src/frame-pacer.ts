import type { OutputFrameLimit } from "@opensekai/contracts";

// A frame that arrives up to this much early is still due, so host jitter does not halve the rate (B22 R6).
export const FRAME_SLACK_MS = 4;

export const isDue = (lastStart: number | null, now: number, fps: OutputFrameLimit): boolean =>
    fps === 60 || lastStart === null || now - lastStart >= 1000 / fps - FRAME_SLACK_MS;

export interface FramePacerOptions<F> {
    apply: (frame: F) => Promise<unknown>;
    fpsOf: (frame: F) => OutputFrameLimit;
    now: () => number;
    setTimeout: (run: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}
export interface FramePacer<F> {
    offer(frame: F): void;
    dispose(): void;
}

// The page applies fewer frames than the host sends and acknowledges only the applied frames.
// A held frame waits for one timer, never for the next arrival: the host stops at 2 unacknowledged frames.
export function createFramePacer<F>(options: FramePacerOptions<F>): FramePacer<F> {
    let confirmed: number | null = null;
    let last: number | null = null;
    let held: F | null = null;
    let timer: unknown = null;
    let disposed = false;
    const stopTimer = () => { if (timer !== null) options.clearTimeout(timer); timer = null; };
    const start = (frame: F) => {
        const at = options.now();
        last = at;
        let applying: Promise<unknown>;
        try { applying = options.apply(frame); } catch (error) { applying = Promise.reject(error); }
        void applying.then(
            () => { if (confirmed === null || at > confirmed) confirmed = at; },
            () => {
                // A rejected or cancelled frame does not move the last-applied time.
                if (last !== at || disposed) return;
                last = confirmed;
                if (held !== null) settle();
            });
    };
    const settle = () => {
        stopTimer();
        const frame = held!;
        const fps = options.fpsOf(frame);
        if (isDue(last, options.now(), fps)) { held = null; start(frame); return; }
        timer = options.setTimeout(() => { timer = null; if (disposed || held === null) return; const next = held; held = null; start(next); }, Math.max(0, last! + 1000 / fps - options.now()));
    };
    return {
        offer(frame) {
            if (disposed) return;
            held = frame;
            settle();
        },
        dispose() { disposed = true; held = null; stopTimer(); },
    };
}
