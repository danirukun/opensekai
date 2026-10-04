import { WebGPURenderer } from "three/webgpu";
import type { Backend } from "@opensekai/contracts";
export async function initializeBackend(canvas: HTMLCanvasElement, mode: "auto" | "force-webgl2") {
    const renderer = new WebGPURenderer({ canvas, alpha: true, antialias: true, forceWebGL: mode === "force-webgl2" });
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
    };
    const backend: Backend = flags.isWebGPUBackend ? "webgpu" : flags.isWebGLBackend ? "webgl2" : (() => { renderer.dispose(); throw new Error("Unknown renderer backend"); })();
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    return { renderer, backend };
}
