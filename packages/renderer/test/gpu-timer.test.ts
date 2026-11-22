import { it, expect, vi } from "vitest";
import WebGPUBackend from "three/src/renderers/webgpu/WebGPUBackend.js";
import WebGPUTimestampQueryPool from "three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js";
import { createGpuTimer, framePairs, frameSpan, gpuSample, type TimestampBackend, type TimestampPool } from "../src/gpu-timer";

const ms = (value: number) => BigInt(Math.round(value * 1e6));

it("splits the timestamps of a pool into the begin and end pairs of each frame", () => {
    const times = [1n, 2n, 3n, 4n, 5n, 6n];
    expect(framePairs(times, [4, 4, 6])).toEqual([[[1n, 2n], [3n, 4n]], [], [[5n, 6n]]]);
    expect(framePairs([], [0, 0])).toEqual([[], []]);
    expect(framePairs(times, [4, 2])).toBeNull();
    expect(framePairs(times, [3])).toBeNull();
    expect(framePairs(times, [8])).toBeNull();
});

it("gives the time from the earliest begin to the latest end of a frame", () => {
    // Two passes that run at the same time count one time; a gap between passes is in the span.
    expect(frameSpan([[ms(1), ms(3)], [ms(2), ms(5)]])).toBe(4);
    expect(frameSpan([[ms(5), ms(6)], [ms(1), ms(2)]])).toBe(5);
});

it("gives no frame span for a frame without a pass, an unwritten query, or a reversed pair", () => {
    expect(frameSpan([])).toBeNull();
    expect(frameSpan([[0n, ms(2)], [ms(1), ms(3)]])).toBeNull();
    expect(frameSpan([[ms(1), 0n]])).toBeNull();
    expect(frameSpan([[ms(3), ms(1)]])).toBeNull();
});

it("gives the mean of the frame spans of a batch, or null for an unknown measurement, never 0", () => {
    expect(gpuSample([4])).toBe(4);
    expect(gpuSample([2, 4, 3, 7])).toBe(4);
    expect(gpuSample([])).toBeNull();
    expect(gpuSample([1, 1, 1, 1, 1])).toBeNull();
    expect(gpuSample([2, null])).toBeNull();
    expect(gpuSample([2, Number.NaN])).toBeNull();
    expect(gpuSample([0])).toBeNull();
    expect(gpuSample([-1, 3])).toBeNull();
    expect(gpuSample([1001])).toBeNull();
});

type Type = "render" | "compute";
interface FakeBuffer { data: BigUint64Array; mapState: string; destroyed: boolean; mapAsync(mode: number, offset?: number, size?: number): Promise<void>; getMappedRange(offset?: number, size?: number): ArrayBuffer; unmap(): void; destroy(): void }
type Op = (() => void);
// A device that runs the copies of a submit at once, and maps a buffer when the test calls `settleAll` or `failAll`.
const fakeDevice = () => {
    const pending: { settle: () => void; fail: () => void }[] = [];
    const buffers: FakeBuffer[] = [];
    let submits = 0;
    const device = {
        createQuerySet: (descriptor: { count: number }) => ({ slots: new BigUint64Array(descriptor.count), destroy: () => undefined }),
        createBuffer: (descriptor: { size: number }) => {
            const buffer: FakeBuffer = {
                data: new BigUint64Array(descriptor.size / 8),
                mapState: "unmapped",
                destroyed: false,
                mapAsync: () => new Promise<void>((resolve, reject) => {
                    buffer.mapState = "pending";
                    pending.push({ settle: () => { buffer.mapState = "mapped"; resolve(); }, fail: () => { buffer.mapState = "unmapped"; reject(new Error("map failed")); } });
                }),
                getMappedRange: () => buffer.data.buffer as ArrayBuffer,
                unmap: () => { buffer.mapState = "unmapped"; },
                destroy: () => { buffer.destroyed = true; }
            };
            buffers.push(buffer);
            return buffer;
        },
        createCommandEncoder: () => {
            const ops: Op[] = [];
            return {
                resolveQuerySet: (set: { slots: BigUint64Array }, first: number, count: number, target: FakeBuffer, offset: number) => ops.push(() => target.data.set(set.slots.subarray(first, first + count), offset / 8)),
                copyBufferToBuffer: (source: FakeBuffer, from: number, target: FakeBuffer, to: number, size: number) => ops.push(() => target.data.set(source.data.subarray(from / 8, (from + size) / 8), to / 8)),
                finish: () => ops
            };
        },
        queue: { submit: (list: Op[][]) => { submits += 1; for (const ops of list) for (const op of ops) op(); } }
    };
    const settleAll = async () => { for (const entry of pending.splice(0)) entry.settle(); await new Promise(resolve => setTimeout(resolve, 0)); };
    const failAll = async () => { for (const entry of pending.splice(0)) entry.fail(); await new Promise(resolve => setTimeout(resolve, 0)); };
    return { device, pending, buffers, settleAll, failAll, submits: () => submits };
};
// A pool with the fields of a three 0.187 timestamp pool; `pass` records one pass as three does and writes its timestamps.
const fake = (trackTimestamp = true) => {
    const gpu = fakeDevice();
    const pool = (type: Type) => ({ type, querySet: gpu.device.createQuerySet({ count: 64 }), currentQueryIndex: 0, queryOffsets: new Map<string, number>(), maxQueries: 64, pendingResolve: false as unknown, isDisposed: false });
    const backend = { trackTimestamp, device: gpu.device, timestampQueryPool: { render: pool("render"), compute: null as ReturnType<typeof pool> | null } };
    let uid = 0;
    const pass = (type: Type, begin: bigint, end: bigint) => {
        const target = backend.timestampQueryPool[type] ??= pool(type);
        const offset = target.currentQueryIndex;
        target.querySet.slots[offset] = begin;
        target.querySet.slots[offset + 1] = end;
        target.currentQueryIndex += 2;
        target.queryOffsets.set(`${type[0]}:${uid++}:1:f0`, offset);
    };
    return { ...gpu, backend: backend as unknown as TimestampBackend, pools: backend.timestampQueryPool, pass };
};

it("resolves the queries after a frame and gives the frame span to one take", async () => {
    const { backend, pools, pass, pending, settleAll, submits } = fake();
    const timer = createGpuTimer(backend);
    pass("render", ms(1), ms(3));
    pass("render", ms(2), ms(5));
    pass("compute", ms(4), ms(6));
    timer.frameDone();
    expect(submits()).toBe(1);
    expect(pending).toHaveLength(2);
    expect(pools.render.currentQueryIndex).toBe(0);
    expect(pools.render.queryOffsets.size).toBe(0);
    expect(pools.compute!.currentQueryIndex).toBe(0);
    expect(timer.take()).toBeNull();
    await settleAll();
    expect(timer.take()).toBe(5);
    expect(timer.take()).toBeNull();
});

it("gives the mean of the frame spans of the frames that end while a resolve is pending", async () => {
    const { backend, pass, pending, settleAll } = fake();
    const timer = createGpuTimer(backend);
    pass("render", ms(1), ms(5));
    timer.frameDone();
    pass("render", ms(10), ms(13));
    timer.frameDone();
    pass("render", ms(20), ms(29));
    timer.frameDone();
    expect(pending).toHaveLength(1);
    await settleAll();
    expect(timer.take()).toBe(4);
    pass("render", ms(30), ms(32));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeCloseTo(14 / 3, 9);
});

it("gives no sample for a batch with a render outside an applied frame", async () => {
    const { backend, pass, settleAll } = fake();
    const timer = createGpuTimer(backend);
    timer.taint();
    pass("render", ms(1), ms(7));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeNull();
    pass("render", ms(10), ms(12));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBe(2);
});

it("gives no sample for a frame with a query that no pass wrote", async () => {
    const { backend, pass, settleAll } = fake();
    const timer = createGpuTimer(backend);
    pass("render", ms(1), ms(9));
    pass("render", 0n, 0n);
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeNull();
});

it("gives no sample after three reset a pool itself, and waits while three resolves", async () => {
    const { backend, pools, pass, pending, settleAll } = fake();
    const timer = createGpuTimer(backend);
    pass("render", ms(1), ms(2));
    timer.frameDone();
    pass("render", ms(3), ms(4));
    pass("render", ms(5), ms(6));
    timer.frameDone();
    // three resolved the pool itself when it was full and started again at 0.
    pools.render.currentQueryIndex = 0;
    pass("render", ms(7), ms(9));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBe(1);
    pass("render", ms(10), ms(11));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeNull();
    pass("render", ms(12), ms(15));
    pools.render.pendingResolve = Promise.resolve(0);
    timer.frameDone();
    expect(pending).toHaveLength(0);
    pools.render.pendingResolve = null;
    pass("render", ms(16), ms(18));
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeNull();
});

it("gives no sample for a failed map or after dispose, and destroys its buffers", async () => {
    const { backend, pass, failAll, settleAll, buffers } = fake();
    const timer = createGpuTimer(backend);
    pass("render", ms(1), ms(7));
    timer.frameDone();
    await failAll();
    expect(timer.take()).toBeNull();
    pass("render", ms(10), ms(12));
    timer.frameDone();
    timer.dispose();
    await settleAll();
    expect(timer.take()).toBeNull();
    expect(buffers.length).toBeGreaterThan(0);
    expect(buffers.every(buffer => buffer.destroyed)).toBe(true);
});

it("starts no resolve without a recorded query", () => {
    const { backend, pending, submits } = fake();
    const timer = createGpuTimer(backend);
    timer.frameDone();
    expect(submits()).toBe(0);
    expect(pending).toHaveLength(0);
});

it("is unsupported and does nothing when timestamps are off", () => {
    const { backend, pass, submits } = fake(false);
    const timer = createGpuTimer(backend);
    expect(timer.support).toBe("unsupported");
    pass("render", ms(1), ms(2));
    timer.frameDone();
    expect(submits()).toBe(0);
    expect(timer.take()).toBeNull();
    expect(createGpuTimer(fake().backend).support).toBe("supported");
});

it("uses the backend and the timestamp pool of three 0.187", async () => {
    vi.stubGlobal("GPUBufferUsage", { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, QUERY_RESOLVE: 0x200 });
    vi.stubGlobal("GPUMapMode", { READ: 0x1 });
    try {
        const gpu = fakeDevice();
        const backend = new WebGPUBackend({ trackTimestamp: true }) as unknown as { trackTimestamp: boolean; device: unknown; timestampQueryPool: { render: unknown; compute: unknown } };
        expect(backend.trackTimestamp).toBe(true);
        expect(backend.device).toBeNull();
        expect(backend.timestampQueryPool).toEqual({ render: null, compute: null });
        backend.device = gpu.device;
        const pool = new WebGPUTimestampQueryPool(gpu.device, "render", 8);
        expect(pool.maxQueries).toBe(8);
        expect(pool.isDisposed).toBe(false);
        expect(pool.pendingResolve).toBeFalsy();
        backend.timestampQueryPool.render = pool;
        const slots = (pool.querySet as unknown as { slots: BigUint64Array }).slots;
        // two passes of one frame: 1 ms to 3 ms and 2 ms to 3.5 ms.
        slots.set([ms(1), ms(3)], pool.allocateQueriesForContext("r:1:5:f0")!);
        slots.set([ms(2), ms(3.5)], pool.allocateQueriesForContext("r:2:6:f0")!);
        expect(pool.queryOffsets.size).toBe(2);
        const timer = createGpuTimer(backend as unknown as TimestampBackend);
        expect(timer.support).toBe("supported");
        timer.frameDone();
        expect(pool.currentQueryIndex).toBe(0);
        expect(pool.queryOffsets.size).toBe(0);
        await gpu.settleAll();
        expect(timer.take()).toBe(2.5);
        // The timer resolves into its own buffers, so three's result buffer stays unmapped.
        expect(pool.resultBuffer.mapState).toBe("unmapped");
        expect(((pool as unknown as TimestampPool).querySet)).toBe(pool.querySet);
    }
    finally { vi.unstubAllGlobals(); }
});
