import { it, expect, vi } from "vitest";
import Backend from "three/src/renderers/common/Backend.js";
import WebGPUTimestampQueryPool from "three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js";
import { createGpuTimer, gpuSample, type TimestampBackend, type TimestampPool } from "../src/gpu-timer";

type Type = "render" | "compute";
// The fields of a three 0.187 timestamp query pool that the timer reads (R8).
const pool = (queries: number, durations: number[] = []): TimestampPool => ({ currentQueryIndex: queries, pendingResolve: null, resultBuffer: { mapState: "unmapped" }, timestamps: new Map(durations.map((value, index) => [`r:${index}:1:f0`, value])) });
// A resolve fills `timestamps` with the next durations of its pool and settles when the test calls `settle`.
const fake = (trackTimestamp = true) => {
    const backend: TimestampBackend = { trackTimestamp, timestampQueryPool: { render: pool(0), compute: null } };
    const recorded: Record<Type, number[]> = { render: [], compute: [] };
    const pending: { type: Type; settle: () => void; fail: () => void }[] = [];
    let uid = 0;
    const renderer = {
        resolveTimestampsAsync: (type: Type) => new Promise<number>((resolve, reject) => {
            const target = backend.timestampQueryPool[type]!;
            const durations = recorded[type];
            recorded[type] = [];
            target.currentQueryIndex = 0;
            pending.push({ type, settle: () => { for (const value of durations) target.timestamps.set(`${type[0]}:${uid++}:1:f0`, value); resolve(0); }, fail: () => reject(new Error("map failed")) });
        })
    };
    // One frame records these pass durations in the pool of `type`.
    const record = (type: Type, durations: number[]) => {
        const target = backend.timestampQueryPool[type] ??= pool(0);
        target.currentQueryIndex += durations.length * 2;
        recorded[type] = [...recorded[type], ...durations];
    };
    const settleAll = async () => { for (const entry of pending.splice(0)) entry.settle(); await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
    const failAll = async () => { for (const entry of pending.splice(0)) entry.fail(); await new Promise(resolve => setTimeout(resolve, 0)); };
    return { backend, renderer, record, pending, settleAll, failAll };
};

it("gives the sum of the pass durations divided by the frame count", () => {
    expect(gpuSample([2, 3], 1)).toBe(5);
    expect(gpuSample([2, 3], 2)).toBe(2.5);
});

it("gives null for an unknown measurement, never 0", () => {
    expect(gpuSample([], 1)).toBeNull();
    expect(gpuSample([2], 0)).toBeNull();
    expect(gpuSample([2], 5)).toBeNull();
    expect(gpuSample([2, Number.NaN], 1)).toBeNull();
    expect(gpuSample([2, -1], 1)).toBeNull();
    expect(gpuSample([1001], 1)).toBeNull();
    expect(gpuSample([0, 0], 1)).toBeNull();
});

it("starts one resolve after a frame and gives its sample to one take", async () => {
    const { backend, renderer, record, pending, settleAll } = fake();
    const timer = createGpuTimer(renderer, backend);
    record("render", [1, 2]);
    record("compute", [0.5]);
    timer.frameDone();
    expect(pending.map(entry => entry.type)).toEqual(["render", "compute"]);
    expect(timer.take()).toBeNull();
    await settleAll();
    expect(timer.take()).toBe(3.5);
    expect(timer.take()).toBeNull();
});

it("counts the frames of a batch while a resolve is pending and gives their mean", async () => {
    const { backend, renderer, record, pending, settleAll } = fake();
    const timer = createGpuTimer(renderer, backend);
    record("render", [4]);
    timer.frameDone();
    record("render", [3, 5]);
    timer.frameDone();
    expect(pending).toHaveLength(1);
    await settleAll();
    expect(timer.take()).toBe(4);
    record("render", [1, 3]);
    timer.frameDone();
    expect(pending).toHaveLength(1);
    await settleAll();
    expect(timer.take()).toBe(6);
});

it("gives no sample for a batch with a render outside an applied frame", async () => {
    const { backend, renderer, record, settleAll } = fake();
    const timer = createGpuTimer(renderer, backend);
    timer.taint();
    record("render", [6]);
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBeNull();
    record("render", [2]);
    timer.frameDone();
    await settleAll();
    expect(timer.take()).toBe(2);
});

it("gives no sample for a failed resolve or after dispose", async () => {
    const { backend, renderer, record, failAll, settleAll } = fake();
    const timer = createGpuTimer(renderer, backend);
    record("render", [6]);
    timer.frameDone();
    await failAll();
    expect(timer.take()).toBeNull();
    record("render", [2]);
    timer.frameDone();
    timer.dispose();
    await settleAll();
    expect(timer.take()).toBeNull();
});

it("starts no resolve without recorded queries or while the result buffer is mapped", async () => {
    const { backend, renderer, record, pending } = fake();
    const timer = createGpuTimer(renderer, backend);
    timer.frameDone();
    expect(pending).toHaveLength(0);
    record("render", [2]);
    backend.timestampQueryPool.render!.resultBuffer = { mapState: "pending" };
    timer.frameDone();
    expect(pending).toHaveLength(0);
    backend.timestampQueryPool.render!.resultBuffer = { mapState: "unmapped" };
    backend.timestampQueryPool.render!.pendingResolve = Promise.resolve(0);
    timer.frameDone();
    expect(pending).toHaveLength(0);
});

it("is unsupported and does nothing when timestamps are off", () => {
    const { backend, renderer, record, pending } = fake(false);
    const timer = createGpuTimer(renderer, backend);
    expect(timer.support).toBe("unsupported");
    record("render", [2]);
    timer.frameDone();
    expect(pending).toHaveLength(0);
    expect(timer.take()).toBeNull();
    expect(createGpuTimer(renderer, fake().backend).support).toBe("supported");
});

it("reads the timestamp pool of three 0.187", async () => {
    vi.stubGlobal("GPUBufferUsage", { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
    try {
        // The start and end times in ns of two passes: 2 ms and 0.5 ms.
        const times = new BigUint64Array([0n, 2_000_000n, 3_000_000n, 3_500_000n]);
        let mapState = "unmapped";
        const resultBuffer = { get mapState() { return mapState; }, mapAsync: async () => { mapState = "mapped"; }, getMappedRange: () => times.buffer, unmap: () => { mapState = "unmapped"; }, destroy: () => undefined };
        const device = {
            createQuerySet: () => ({ destroy: () => undefined }),
            createBuffer: (descriptor: { usage: number }) => descriptor.usage & 8 ? resultBuffer : { destroy: () => undefined },
            createCommandEncoder: () => ({ resolveQuerySet: () => undefined, copyBufferToBuffer: () => undefined, finish: () => ({}) }),
            queue: { submit: () => undefined }
        };
        const backend = new (Backend as unknown as new (parameters: { trackTimestamp: boolean }) => TimestampBackend)({ trackTimestamp: true });
        const pool = new WebGPUTimestampQueryPool(device, "render", 8);
        backend.timestampQueryPool.render = pool as unknown as TimestampPool;
        pool.allocateQueriesForContext("r:1:5:f0");
        pool.allocateQueriesForContext("r:2:6:f0");
        let resolved: Promise<unknown> = Promise.resolve();
        const timer = createGpuTimer({ resolveTimestampsAsync: () => resolved = pool.resolveQueriesAsync() }, backend);
        expect(timer.support).toBe("supported");
        timer.frameDone();
        expect(pool.currentQueryIndex).toBe(0);
        await resolved;
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(timer.take()).toBe(2.5);
    }
    finally { vi.unstubAllGlobals(); }
});
