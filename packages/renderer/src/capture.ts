import { failure } from "./apply-frame";
export function createCapturePolicy() { let last = -Infinity; return { reserve(now: number) { if (now - last < 1000)
        throw failure("RATE_LIMITED", "Capture rate limit"); last = now; }, checkBytes(bytes: number) { if (bytes > 2 * 1024 * 1024)
        throw failure("INVALID_INPUT", "Diagnostic PNG exceeds 2 MiB"); } }; }
export async function readPng(canvas: HTMLCanvasElement): Promise<Uint8Array> { const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(failure("UNAVAILABLE", "PNG readback failed")), "image/png")); if (blob.size > 2 * 1024 * 1024)
    throw failure("INVALID_INPUT", "Diagnostic PNG exceeds 2 MiB"); return new Uint8Array(await blob.arrayBuffer()); }
