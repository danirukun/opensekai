import { HalfFloatType, NodeMaterial, QuadMesh, RenderTarget, UnsignedByteType, type Camera, type Object3D, type Scene, type WebGPURenderer } from "three/webgpu";
import { renderOutput, texture } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import type { Backend, CameraAntiAliasing } from "@opensekai/contracts";

export const SCREENSHOT_WIDTH = 1920;
export const SCREENSHOT_HEIGHT = 1080;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();
const crc32 = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.byteLength);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.byteLength);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
    return out;
};
const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** PNG scanlines with a filter for each row: the filter of Sub, Up, and Paeth with the smallest sum of absolute values (the usual PNG heuristic). */
export function filterRows(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const stride = width * 4;
    const out = new Uint8Array(height * (stride + 1));
    const candidates = [new Uint8Array(stride), new Uint8Array(stride), new Uint8Array(stride)];
    for (let y = 0; y < height; y++) {
        const row = rgba.subarray(y * stride, (y + 1) * stride);
        const up = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
        const [sub, upRow, pa] = candidates as [Uint8Array, Uint8Array, Uint8Array];
        let subSum = 0, upSum = 0, paethSum = 0;
        for (let i = 0; i < stride; i++) {
            const a = i >= 4 ? row[i - 4]! : 0, b = up ? up[i]! : 0, c = up && i >= 4 ? up[i - 4]! : 0, x = row[i]!;
            const s = (x - a) & 0xff, u = (x - b) & 0xff, p = (x - paeth(a, b, c)) & 0xff;
            sub[i] = s; upRow[i] = u; pa[i] = p;
            subSum += s < 128 ? s : 256 - s; upSum += u < 128 ? u : 256 - u; paethSum += p < 128 ? p : 256 - p;
        }
        const best = subSum <= upSum && subSum <= paethSum ? 0 : upSum <= paethSum ? 1 : 2;
        out[y * (stride + 1)] = [1, 2, 4][best]!;
        out.set(candidates[best]!, y * (stride + 1) + 1);
    }
    return out;
}

/** Encodes straight-alpha RGBA as an 8-bit RGBA PNG. The zlib stream comes from the platform `CompressionStream`. */
export async function encodePng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    if (rgba.byteLength !== width * height * 4) throw new Error("Pixel buffer size mismatch");
    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, width);
    view.setUint32(4, height);
    header.set([8, 6, 0, 0, 0], 8);
    const filtered = filterRows(rgba, width, height);
    const compressed = new Uint8Array(await new Response(new Blob([filtered as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
    const png = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) { png.set(part, offset); offset += part.byteLength; }
    return png;
}

/**
 * Converts the read-back render target pixels to top-down, straight-alpha rows. The render is
 * premultiplied over a transparent clear (as the canvas is), and WebGL reads rows bottom-up.
 */
export function toStraightRows(pixels: Uint8Array, width: number, height: number, bottomUp: boolean): Uint8Array {
    const stride = width * 4;
    const out = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const source = (bottomUp ? height - 1 - y : y) * stride;
        for (let i = 0; i < stride; i += 4) {
            const a = pixels[source + i + 3]!, o = y * stride + i;
            out[o + 3] = a;
            if (a === 0) continue;
            for (let k = 0; k < 3; k++) out[o + k] = a === 255 ? pixels[source + i + k]! : Math.min(255, Math.round(pixels[source + i + k]! * 255 / a));
        }
    }
    return out;
}

export interface ScreenshotRender {
    renderer: WebGPURenderer;
    backend: Backend;
    scene: Scene;
    camera: Camera;
    /** The direct children of `scene` to draw, with their visibility. Lights stay as they are; every other child (editor helpers, camera roots) is hidden. */
    show: Map<Object3D, boolean>;
    antiAliasing: CameraAntiAliasing;
    msaaSamples: number;
}

/** Renders one 1920 × 1080 frame to offscreen targets with a transparent clear, reads it once, and returns the PNG. The canvas is not drawn. */
export async function renderScreenshot({ renderer, backend, scene, camera, show, antiAliasing, msaaSamples }: ScreenshotRender): Promise<Uint8Array> {
    const width = SCREENSHOT_WIDTH, height = SCREENSHOT_HEIGHT;
    const sceneTarget = new RenderTarget(width, height, { type: HalfFloatType, samples: msaaSamples, depthBuffer: true });
    const colorTarget = new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false });
    const fxaaTarget = antiAliasing === "fxaa" ? new RenderTarget(width, height, { type: UnsignedByteType, depthBuffer: false }) : null;
    const materials: NodeMaterial[] = [];
    const quad = (node: NodeMaterial["fragmentNode"]) => { const material = new NodeMaterial(); material.fragmentNode = node; materials.push(material); return new QuadMesh(material); };
    const saved = scene.children.map(child => [child, child.visible] as const);
    const previousTarget = renderer.getRenderTarget();
    try {
        for (const [child] of saved) if (!(child as { isLight?: boolean }).isLight) child.visible = show.get(child) ?? false;
        renderer.setRenderTarget(sceneTarget);
        await renderer.renderAsync(scene, camera);
        // The same display transform as the canvas output; FXAA then works on display-referred color, as in anti-aliasing.ts.
        renderer.setRenderTarget(colorTarget);
        await quad(renderOutput(texture(sceneTarget.texture), renderer.toneMapping, renderer.outputColorSpace)).renderAsync(renderer);
        if (fxaaTarget) {
            renderer.setRenderTarget(fxaaTarget);
            await quad(fxaa(texture(colorTarget.texture))).renderAsync(renderer);
        }
        const pixels = await renderer.readRenderTargetPixelsAsync(fxaaTarget ?? colorTarget, 0, 0, width, height) as Uint8Array;
        return await encodePng(toStraightRows(new Uint8Array(pixels.buffer, pixels.byteOffset, width * height * 4), width, height, backend === "webgl2"), width, height);
    }
    finally {
        renderer.setRenderTarget(previousTarget);
        for (const [child, visible] of saved) child.visible = visible;
        for (const material of materials) material.dispose();
        sceneTarget.dispose(); colorTarget.dispose(); fxaaTarget?.dispose();
    }
}
