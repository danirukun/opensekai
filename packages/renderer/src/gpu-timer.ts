import type { GpuTimerSupport } from "@opensekai/contracts";

// The fields of a three 0.187 timestamp query pool that the timer reads (light scale R8). A three update can change them;
// `gpu-timer.test.ts` pins them.
export interface TimestampPool {
    currentQueryIndex: number;
    pendingResolve: unknown;
    resultBuffer: { mapState: string } | null;
    timestamps: Map<string, number>;
}
export interface TimestampBackend {
    trackTimestamp: boolean;
    timestampQueryPool: { render: TimestampPool | null; compute: TimestampPool | null };
}
export interface TimestampRenderer {
    resolveTimestampsAsync(type: "render" | "compute"): Promise<unknown>;
}
export interface GpuTimer {
    /** After the last render call of an applied frame: counts the frame and starts one resolve when none is in progress. */
    frameDone(): void;
    /** Before a render outside an applied frame: the current batch gives no sample. */
    taint(): void;
    /** The sample of the last resolved batch, one time; else null. */
    take(): number | null;
    readonly support: GpuTimerSupport;
    dispose(): void;
}

const MAX_BATCH_FRAMES = 4;
const MAX_PASS_MS = 1000;
const TYPES = ["render", "compute"] as const;

// Light scale R5: the GPU pass time of one frame of a batch, or null when the measurement is unknown. Never 0.
export const gpuSample = (durations: readonly number[], frames: number): number | null => {
    if (!Number.isInteger(frames) || frames < 1 || frames > MAX_BATCH_FRAMES || durations.length === 0) return null;
    if (!durations.every(value => Number.isFinite(value) && value >= 0 && value <= MAX_PASS_MS)) return null;
    const sum = durations.reduce((total, value) => total + value, 0);
    return sum > 0 ? sum / frames : null;
};

const idle = (pool: TimestampPool) => !pool.pendingResolve && pool.resultBuffer?.mapState === "unmapped";

// A batch is the render and compute queries since the previous resolve. three resolves a pool, maps its result buffer, and
// fills `timestamps` (query ID -> ms). The value that `resolveTimestampsAsync` returns is not used: it can be a stale value or 0.
export function createGpuTimer(renderer: TimestampRenderer, backend: TimestampBackend | undefined): GpuTimer {
    const support: GpuTimerSupport = backend?.trackTimestamp === true ? "supported" : "unsupported";
    let frames = 0, tainted = false, resolving = false, disposed = false, sample: number | null = null;
    const frameDone = () => {
        if (!backend || support === "unsupported" || disposed) return;
        frames += 1;
        if (resolving) return;
        const pools = TYPES.flatMap(type => {
            const pool = backend.timestampQueryPool[type];
            return pool && pool.currentQueryIndex > 0 ? [{ type, pool }] : [];
        });
        if (pools.length === 0 || !pools.every(({ pool }) => idle(pool))) return;
        const batch = { frames, tainted };
        frames = 0;
        tainted = false;
        resolving = true;
        // A failed resolve leaves the map empty, so an old duration is never read again.
        for (const { pool } of pools) pool.timestamps.clear();
        Promise.all(pools.map(({ type }) => renderer.resolveTimestampsAsync(type))).then(() => {
            if (disposed || batch.tainted) return;
            const lists = pools.map(({ pool }) => [...pool.timestamps.values()]);
            sample = lists.every(list => list.length > 0) ? gpuSample(lists.flat(), batch.frames) : null;
        }, () => undefined).finally(() => { resolving = false; });
    };
    return {
        support,
        frameDone,
        taint() { tainted = true; },
        take() { const value = sample; sample = null; return value; },
        dispose() { disposed = true; sample = null; }
    };
}
