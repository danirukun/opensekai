import type { GpuTimerSupport } from "@opensekai/contracts";

// The fields of a three 0.187 timestamp query pool that the timer reads and writes (light scale R8). A three update can
// change them; `gpu-timer.test.ts` pins them with the real pool class.
export interface TimestampPool {
    querySet: unknown;
    currentQueryIndex: number;
    queryOffsets: Map<string, number>;
    maxQueries: number;
    pendingResolve: unknown;
    isDisposed: boolean;
}
interface GpuBuffer {
    mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
    getMappedRange(offset?: number, size?: number): ArrayBuffer;
    unmap(): void;
    destroy(): void;
}
interface GpuDevice {
    createBuffer(descriptor: { label?: string; size: number; usage: number }): GpuBuffer;
    createCommandEncoder(descriptor?: { label?: string }): {
        resolveQuerySet(querySet: unknown, firstQuery: number, queryCount: number, destination: GpuBuffer, destinationOffset: number): void;
        copyBufferToBuffer(source: GpuBuffer, sourceOffset: number, destination: GpuBuffer, destinationOffset: number, size: number): void;
        finish(): unknown;
    };
    queue: { submit(commandBuffers: unknown[]): void };
}
export interface TimestampBackend {
    trackTimestamp: boolean;
    device?: GpuDevice | null;
    timestampQueryPool: { render: TimestampPool | null; compute: TimestampPool | null };
}
export interface GpuTimer {
    /** After the last render call of an applied frame: records a frame boundary and starts one resolve when none is in progress. */
    frameDone(): void;
    /** Before a render outside an applied frame: the current batch gives no sample. */
    taint(): void;
    /** The sample of the last resolved batch, one time; else null. */
    take(): number | null;
    readonly support: GpuTimerSupport;
    dispose(): void;
}
export type TimestampPair = readonly [begin: bigint, end: bigint];

const MAX_BATCH_FRAMES = 4;
const MAX_SPAN_MS = 1000;
const TYPES = ["render", "compute"] as const;
type PoolType = (typeof TYPES)[number];
// WebGPU constants (GPUBufferUsage, GPUMapMode). The values are fixed by the specification.
const MAP_READ = 0x0001, COPY_SRC = 0x0004, COPY_DST = 0x0008, QUERY_RESOLVE = 0x0200, MAP_MODE_READ = 0x0001;

// The begin and end pairs of each frame. `boundaries` holds the query index of the pool after each frame.
export const framePairs = (times: ArrayLike<bigint>, boundaries: readonly number[]): TimestampPair[][] | null => {
    const valid = boundaries.every((end, i) => end % 2 === 0 && end <= times.length && end >= (boundaries[i - 1] ?? 0));
    if (!valid) return null;
    return boundaries.map((end, i) => {
        const start = boundaries[i - 1] ?? 0;
        return Array.from({ length: (end - start) / 2 }, (_, k): TimestampPair => [times[start + 2 * k], times[start + 2 * k + 1]]);
    });
};

// Light scale R5: the time in ms from the earliest pass begin to the latest pass end of one frame. WebGPU resolves a query
// that no pass wrote to 0, so a pair with 0 or a reversed pair makes the frame unknown.
export const frameSpan = (pairs: readonly TimestampPair[]): number | null => {
    if (pairs.length === 0 || pairs.some(([begin, end]) => begin === 0n || end === 0n || end < begin)) return null;
    const begin = pairs.reduce((min, [value]) => value < min ? value : min, pairs[0][0]);
    const end = pairs.reduce((max, [, value]) => value > max ? value : max, pairs[0][1]);
    return Number(end - begin) / 1e6;
};

// Light scale R5: the mean of the frame spans of a batch, or null when the measurement is unknown. Never 0.
export const gpuSample = (spans: readonly (number | null)[]): number | null => {
    if (spans.length === 0 || spans.length > MAX_BATCH_FRAMES) return null;
    if (!spans.every((span): span is number => span !== null && Number.isFinite(span) && span > 0 && span <= MAX_SPAN_MS)) return null;
    return spans.reduce((total, span) => total + span, 0) / spans.length;
};

const emptyBoundaries = (): Record<PoolType, number[]> => ({ render: [], compute: [] });

// three keeps only a duration for each pass, so the timer resolves the query set of each pool itself into its own buffers
// and resets the pool as `WebGPUTimestampQueryPool._resolveQueries` does (light scale R8, TA5).
export function createGpuTimer(backend: TimestampBackend | undefined): GpuTimer {
    const support: GpuTimerSupport = backend?.trackTimestamp === true ? "supported" : "unsupported";
    const buffers = new Map<TimestampPool, { resolve: GpuBuffer; result: GpuBuffer }>();
    let boundaries = emptyBoundaries(), frames = 0, tainted = false, lost = false;
    let resolving = false, disposed = false, sample: number | null = null;
    const pool = (type: PoolType) => {
        const value = backend?.timestampQueryPool[type];
        return value && !value.isDisposed ? value : null;
    };
    const buffersOf = (device: GpuDevice, target: TimestampPool) => {
        const known = buffers.get(target);
        if (known) return known;
        const size = target.maxQueries * 8;
        const created = {
            resolve: device.createBuffer({ label: "opensekai_gpu_timer_resolve", size, usage: QUERY_RESOLVE | COPY_SRC }),
            result: device.createBuffer({ label: "opensekai_gpu_timer_result", size, usage: COPY_DST | MAP_READ })
        };
        buffers.set(target, created);
        return created;
    };
    const read = async (result: GpuBuffer, count: number) => {
        await result.mapAsync(MAP_MODE_READ, 0, count * 8);
        try {
            return new BigUint64Array(result.getMappedRange(0, count * 8).slice(0));
        }
        finally {
            result.unmap();
        }
    };
    const frameDone = () => {
        if (!backend || support === "unsupported" || disposed) return;
        frames += 1;
        for (const type of TYPES) {
            const target = pool(type);
            const index = target?.currentQueryIndex ?? 0;
            // A lower index, or a resolve of three, means that three reset the pool itself and its queries are lost.
            if (index < (boundaries[type].at(-1) ?? 0) || target?.pendingResolve) lost = true;
            boundaries[type].push(index);
        }
        const device = backend.device;
        if (resolving || !device) return;
        const pools = TYPES.flatMap(type => {
            const target = pool(type);
            return target && target.currentQueryIndex > 0 ? [{ type, target, count: target.currentQueryIndex }] : [];
        });
        if (pools.length === 0) {
            boundaries = emptyBoundaries();
            frames = 0;
            tainted = false;
            lost = false;
            return;
        }
        if (pools.some(({ target }) => target.pendingResolve)) return;
        const batch = { boundaries, frames, tainted, lost };
        boundaries = emptyBoundaries();
        frames = 0;
        tainted = false;
        lost = false;
        resolving = true;
        const encoder = device.createCommandEncoder({ label: "opensekai_gpu_timer" });
        const reads = pools.map(({ type, target, count }) => {
            const { resolve, result } = buffersOf(device, target);
            encoder.resolveQuerySet(target.querySet, 0, count, resolve, 0);
            encoder.copyBufferToBuffer(resolve, 0, result, 0, count * 8);
            target.currentQueryIndex = 0;
            target.queryOffsets.clear();
            return { type, result, count };
        });
        device.queue.submit([encoder.finish()]);
        Promise.all(reads.map(async ({ type, result, count }) => ({ type, times: await read(result, count) }))).then(resolved => {
            if (disposed || batch.tainted || batch.lost) return;
            const perPool = TYPES.map(type => framePairs(resolved.find(entry => entry.type === type)?.times ?? [], batch.boundaries[type]));
            if (perPool.some(pairs => pairs === null)) return;
            const spans = Array.from({ length: batch.frames }, (_, i) => frameSpan(perPool.flatMap(pairs => pairs![i] ?? [])));
            sample = gpuSample(spans);
        }, () => undefined).finally(() => { resolving = false; });
    };
    return {
        support,
        frameDone,
        taint() { tainted = true; },
        take() { const value = sample; sample = null; return value; },
        dispose() {
            disposed = true;
            sample = null;
            for (const { resolve, result } of buffers.values()) {
                resolve.destroy();
                result.destroy();
            }
            buffers.clear();
        }
    };
}
