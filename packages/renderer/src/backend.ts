import { WebGPURenderer } from "three/webgpu";
import type { Backend, GpuTimerSupport } from "@opensekai/contracts";
export async function initializeBackend(canvas: HTMLCanvasElement, mode: "auto" | "force-webgl2", msaaSamples: 0 | 4 = 4) {
    // three keeps timestamps on WebGPU only when the device has `timestamp-query` (light scale R1).
    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: msaaSamples > 0, samples: msaaSamples, forceWebGL: mode === "force-webgl2", trackTimestamp: true });
    try {
        await renderer.init();
    }
    catch (error) {
        renderer.dispose();
        throw error;
    }
    const flags = renderer.backend as unknown as {
        isWebGPUBackend?: boolean;
        isWebGLBackend?: boolean;
        trackTimestamp: boolean;
        disjoint?: unknown;
    };
    const backend: Backend = flags.isWebGPUBackend ? "webgpu" : flags.isWebGLBackend ? "webgl2" : (() => { renderer.dispose(); throw new Error("Unknown renderer backend"); })();
    // WebGL 2 makes no timer query, because its pool can give a stale value or 0 (R1, analysis TA3). Its capability is the extension (R2).
    if (backend === "webgl2") flags.trackTimestamp = false;
    const gpuTimer: GpuTimerSupport = (backend === "webgl2" ? flags.disjoint != null : flags.trackTimestamp) ? "supported" : "unsupported";
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    return { renderer, backend, gpuTimer };
}
