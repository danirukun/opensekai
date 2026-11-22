// @types/three 0.187 has no declaration for this module; `gpu-timer.test.ts` uses it to pin the fields that `gpu-timer.ts` reads and writes.
declare module "three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js" {
    export default class WebGPUTimestampQueryPool {
        constructor(device: unknown, type: string, maxQueries?: number);
        querySet: unknown;
        resultBuffer: { mapState: string };
        currentQueryIndex: number;
        queryOffsets: Map<string, number>;
        maxQueries: number;
        pendingResolve: unknown;
        isDisposed: boolean;
        allocateQueriesForContext(uid: string): number | null;
        resolveQueriesAsync(): Promise<number>;
    }
}
