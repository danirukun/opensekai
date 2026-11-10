// The capture route of a renderer (B31 R13): one socket for each stream. The first message is captureAuth (text);
// the host answers with captureConfig (text), then binary chunk messages. No token goes into the URL.
import { ConnectionDescriptorSchema, type ConnectionDescriptor } from "@opensekai/contracts";

export interface CaptureConfig { codec: string; description: Uint8Array; codedWidth: number; codedHeight: number }
export interface CaptureChunk { key: boolean; timestampUs: number; data: Uint8Array }
export interface CaptureHandlers {
    config(config: CaptureConfig): void;
    chunk(chunk: CaptureChunk): void;
    /** The socket closed, by either side. `code` is the WebSocket close code (4401, 4404, 4429, or another). */
    closed(code: number): void;
}
export interface CaptureConnection { close(): void }
/** R13: one binary message is at most 4 MiB. */
export const CAPTURE_MESSAGE_BYTES = 4 * 1024 * 1024;
const HEADER_BYTES = 9;

/** The binary chunk message: byte 0 the flags (bit 0 = key frame), bytes 1 to 8 the timestamp in µs (u64 BE), then the AVCC chunk. */
export function parseCaptureChunk(message: ArrayBuffer | Uint8Array): CaptureChunk | null {
    const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
    if (bytes.byteLength <= HEADER_BYTES || bytes.byteLength > CAPTURE_MESSAGE_BYTES) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const timestamp = view.getBigUint64(1);
    if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { key: (bytes[0]! & 1) === 1, timestampUs: Number(timestamp), data: bytes.subarray(HEADER_BYTES) };
}
/** Test and stub helper: the binary chunk message of `parseCaptureChunk`. */
export function encodeCaptureChunk(chunk: CaptureChunk): Uint8Array {
    const bytes = new Uint8Array(HEADER_BYTES + chunk.data.byteLength);
    bytes[0] = chunk.key ? 1 : 0;
    new DataView(bytes.buffer).setBigUint64(1, BigInt(chunk.timestampUs));
    bytes.set(chunk.data, HEADER_BYTES);
    return bytes;
}
const base64Bytes = (text: string): Uint8Array | null => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return null;
    const binary = atob(text);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
};
/** The captureConfig text message, or null for any other or invalid text. */
export function parseCaptureConfig(text: string): CaptureConfig | null {
    if (text.length > 64 * 1024) return null;
    let value: unknown;
    try { value = JSON.parse(text); } catch { return null; }
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const keys = Object.keys(v).sort().join(",");
    if (keys !== "codec,codedHeight,codedWidth,description,kind" || v.kind !== "captureConfig") return null;
    const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 2 && n <= 1920;
    if (typeof v.codec !== "string" || !/^avc[13]\.[0-9a-fA-F]{6}$/.test(v.codec) || typeof v.description !== "string" || !size(v.codedWidth) || !size(v.codedHeight)) return null;
    const description = base64Bytes(v.description);
    return description && description.byteLength > 0 ? { codec: v.codec, description, codedWidth: v.codedWidth as number, codedHeight: v.codedHeight as number } : null;
}
/** The /capture URL of the descriptor origin. */
export const captureUrl = (descriptor: Pick<ConnectionDescriptor, "wsUrl">) => new URL("/capture", descriptor.wsUrl).href;

type Socket = Pick<WebSocket, "send" | "close" | "addEventListener" | "binaryType">;
/** Opens one /capture socket for `streamId` with a renderer descriptor (R13, R14). A protocol error closes it. */
export function openCaptureSocket(raw: ConnectionDescriptor, streamId: string, handlers: CaptureHandlers, socketOf: (url: string) => Socket = url => new WebSocket(url)): CaptureConnection {
    const descriptor = ConnectionDescriptorSchema.parse(raw);
    if (descriptor.role !== "renderer" || descriptor.outputId === null) throw new Error("Renderer descriptor required");
    const socket = socketOf(captureUrl(descriptor));
    socket.binaryType = "arraybuffer";
    let done = false, configured = false;
    const finish = (code: number) => { if (done) return; done = true; try { socket.close(); } catch { /* closed */ } handlers.closed(code); };
    socket.addEventListener("open", () => socket.send(JSON.stringify({ kind: "captureAuth", token: descriptor.token, outputId: descriptor.outputId, streamId })));
    socket.addEventListener("message", event => {
        if (done) return;
        const data = (event as MessageEvent).data;
        if (typeof data === "string") {
            const config = parseCaptureConfig(data);
            if (!config) { finish(1002); return; }
            configured = true;
            handlers.config(config);
            return;
        }
        const chunk = data instanceof ArrayBuffer ? parseCaptureChunk(data) : null;
        if (!chunk || !configured) { finish(1002); return; }
        handlers.chunk(chunk);
    });
    socket.addEventListener("close", event => finish((event as CloseEvent).code ?? 1006));
    socket.addEventListener("error", () => finish(1006));
    return { close() { finish(1000); } };
}
