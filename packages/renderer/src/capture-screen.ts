// Capture screens (B31 R14, R15): one /capture socket, one VideoDecoder, and one texture for each stream that a visible
// screen uses. The host sends the state of each screen in captureStatus; the scene says which screens exist.
import { SRGBColorSpace, Texture, VideoFrameTexture } from "three/webgpu";
import { CAPTURE_STATE_MESSAGES, type AppError, type CaptureState, type CaptureStatus, type Id, type SceneEntity, type VideoDecoderSupport } from "@opensekai/contracts";
import type { CaptureChunk, CaptureConfig, CaptureConnection, CaptureHandlers } from "@opensekai/browser-client";

export const CAPTURE_NOT_IN_VIEW = "Capture not supported in this view";
export const CAPTURE_CODEC_UNSUPPORTED = "Capture codec not supported";
export const CAPTURE_FAILED = "Capture failed";
/** R14: above this decode queue size, chunks drop until the next key frame. */
export const MAX_DECODE_QUEUE = 4;
/** R14: a decoder error opens the socket again after 1 s, at most 3 times for one content value. */
export const CAPTURE_RETRIES = 3;
export const CAPTURE_RETRY_MS = 1000;
/** Chunks that arrive while the decoder config is checked wait in this queue; more drop to the next key frame. */
const CONFIGURING_CHUNKS = 8;
/** The states in which a renderer keeps the socket of a stream open (R14). */
export const SOCKET_STATES: ReadonlySet<CaptureState> = new Set(["starting", "idle", "live", "paused"]);
/** The R14 diagnostics probe: the codec of a 1080p VideoToolbox Main stream. */
export const PROBE_CONFIG = { codec: "avc1.4d0029", codedWidth: 1920, codedHeight: 1080 } as const;

/** The capture side of a renderer client: the host status stream and the capture route (R9, R13). */
export interface CaptureHost {
    onStatus(listener: (status: CaptureStatus) => void): () => void;
    open(streamId: string, handlers: CaptureHandlers): CaptureConnection;
}
type DecoderInit = { output(frame: VideoFrame): void; error(error: unknown): void };
type Decoder = Pick<VideoDecoder, "configure" | "decode" | "reset" | "close" | "decodeQueueSize" | "state">;
/** The browser parts a stream uses, so that a test can replace them. */
export interface CaptureEnv {
    VideoDecoder?: { new (init: DecoderInit): Decoder; isConfigSupported(config: VideoDecoderConfig): Promise<{ supported?: boolean }> };
    EncodedVideoChunk: new (init: EncodedVideoChunkInit) => EncodedVideoChunk;
    createImageBitmap(frame: VideoFrame): Promise<ImageBitmap>;
    now(): number;
}
export const browserCaptureEnv = (): CaptureEnv => ({
    VideoDecoder: typeof VideoDecoder === "undefined" ? undefined : VideoDecoder,
    EncodedVideoChunk: globalThis.EncodedVideoChunk,
    createImageBitmap: frame => createImageBitmap(frame),
    now: () => performance.now(),
});
const decoderConfig = (config: Pick<CaptureConfig, "codec" | "codedWidth" | "codedHeight"> & { description?: Uint8Array }): VideoDecoderConfig => ({
    codec: config.codec, codedWidth: config.codedWidth, codedHeight: config.codedHeight,
    ...(config.description ? { description: config.description } : {}),
    optimizeForLatency: true, hardwareAcceleration: "no-preference",
});
/** R14: whether this view has VideoDecoder, and whether it decodes avc1.4d0029 at 1920 x 1080. */
export async function probeVideoDecoder(env: Pick<CaptureEnv, "VideoDecoder"> = browserCaptureEnv()): Promise<VideoDecoderSupport> {
    if (!env.VideoDecoder) return "missing";
    try { return (await env.VideoDecoder.isConfigSupported(decoderConfig(PROBE_CONFIG))).supported === true ? "supported" : "unsupported"; }
    catch { return "unsupported"; }
}

/** R14: the decoder keeps only the newest frame. Each older frame that was not taken is closed at once. */
export function createNewestFrame<T extends { close(): void }>() {
    let newest: T | null = null;
    return {
        offer(frame: T) { newest?.close(); newest = frame; },
        take(): T | null { const frame = newest; newest = null; return frame; },
        clear() { newest?.close(); newest = null; },
        get pending() { return newest !== null; },
    };
}
/**
 * R14: the chunk gate. Above MAX_DECODE_QUEUE queued decodes, each chunk drops (also a key frame), and after that only a
 * key frame starts the decode again. A new stream or config also waits for a key frame.
 */
export function createChunkGate() {
    let needKey = true;
    return {
        accept(key: boolean, decodeQueueSize: number): boolean {
            if (decodeQueueSize > MAX_DECODE_QUEUE) { needKey = true; return false; }
            if (needKey && !key) return false;
            needKey = false;
            return true;
        },
        reset() { needKey = true; },
    };
}
/** R14: the decoder error count of each content value. The fourth error fails the screen. */
export function createRetries(limit = CAPTURE_RETRIES) {
    const errors = new Map<string, number>();
    return {
        /** Counts one error; gives "retry" while the count is at most `limit`. */
        fail(key: string): "retry" | "failed" { const count = (errors.get(key) ?? 0) + 1; errors.set(key, count); return count > limit ? "failed" : "retry"; },
        failed: (key: string) => (errors.get(key) ?? 0) > limit,
        /** A content value that leaves the scene starts again from 0. */
        prune(keep: ReadonlySet<string>) { for (const key of [...errors.keys()]) if (!keep.has(key)) errors.delete(key); },
    };
}
/** The frame warning text of R15. */
export const captureWarning = (message: string) => `Capture: ${message}`;
/** R15: the renderer failure wins over the host state. A state without a message (starting, idle, live) gives null. */
export const captureMessage = (state: CaptureState | null, rendererFailure: string | null): string | null =>
    rendererFailure ?? (state ? CAPTURE_STATE_MESSAGES[state] ?? null : null);
const warningCode = (message: string): AppError["code"] =>
    message === CAPTURE_NOT_IN_VIEW || message === CAPTURE_CODEC_UNSUPPORTED || message === CAPTURE_STATE_MESSAGES.unsupported ? "UNSUPPORTED" : "UNAVAILABLE";

type CaptureEntity = Extract<SceneEntity, { kind: "screen" }> & { content: { kind: "capture" } };
const isCapture = (entity: SceneEntity): entity is CaptureEntity => entity.kind === "screen" && entity.content.kind === "capture";
/** The retry key of one screen: its ID and its content value (R14). */
export const contentKey = (entity: CaptureEntity) => `${entity.id}\n${JSON.stringify(entity.content)}`;
export interface CaptureScreenPlan { entityId: Id; key: string; visible: boolean; streamId: string | null; state: CaptureState | null; width: number; height: number }
/** The capture screens of a scene with their host state, in scene order. A screen without a status entry has a null state. */
export function captureScreenPlan(entities: readonly SceneEntity[], status: CaptureStatus | null): CaptureScreenPlan[] {
    return entities.filter(isCapture).map(entity => {
        const entry = status?.screens.find(item => item.entityId === entity.id);
        return { entityId: entity.id, key: contentKey(entity), visible: entity.visible, streamId: entry?.streamId ?? null, state: entry?.state ?? null, width: entry?.width ?? 0, height: entry?.height ?? 0 };
    });
}
/** R14: the streams that need a socket: a visible screen uses the stream in a socket state, and the screen has not failed. */
export function wantedStreams(plans: readonly CaptureScreenPlan[], failed: (plan: CaptureScreenPlan) => boolean): Set<string> {
    return new Set(plans.flatMap(plan => plan.visible && plan.streamId !== null && plan.state !== null && SOCKET_STATES.has(plan.state) && !failed(plan) ? [plan.streamId] : []));
}

export type CaptureUpload = "frame" | "bitmap";
/** One stream: its socket, its decoder, and its texture. */
interface Stream {
    texture: Texture | null; width: number; height: number;
    /** A permanent failure of this stream (the codec check). */
    failure: string | null;
    upload(): void;
    close(): void;
}
function openStream(streamId: string, host: CaptureHost, env: CaptureEnv, upload: CaptureUpload, events: { error(): void; closed(): void }): Stream {
    const Decoder = env.VideoDecoder!;
    const newest = createNewestFrame<VideoFrame>();
    const gate = createChunkGate();
    let decoder: Decoder | null = null, configuring = false, generation = 0, closed = false, waiting: CaptureChunk[] = [];
    let bitmap: ImageBitmap | null = null, held: VideoFrame | null = null, busy = false;
    const stream: Stream = {
        texture: null, width: 0, height: 0, failure: null,
        upload() {
            if (closed || busy || !newest.pending) return;
            const frame = newest.take()!;
            const width = frame.displayWidth, height = frame.displayHeight;
            const install = (image: VideoFrame | ImageBitmap) => {
                // A new size needs a new texture; three.js does not resize one.
                if (!stream.texture || stream.width !== width || stream.height !== height) {
                    stream.texture?.dispose();
                    const texture = upload === "frame" ? new VideoFrameTexture() : new Texture();
                    texture.colorSpace = SRGBColorSpace;
                    // The quad UVs put row 0 at the top, as for an image (B28 R12).
                    texture.flipY = false;
                    texture.premultiplyAlpha = false;
                    texture.generateMipmaps = false;
                    stream.texture = texture;
                    stream.width = width; stream.height = height;
                }
                if (upload === "frame") (stream.texture as VideoFrameTexture).setFrame(image as VideoFrame);
                else { stream.texture.image = image; stream.texture.needsUpdate = true; }
            };
            if (upload === "frame") {
                install(frame);
                // The texture reads the frame at the next draw; the frame before it is drawn already.
                held?.close();
                held = frame;
                return;
            }
            // WebGPU: one ImageBitmap for each new frame (the B29 path).
            busy = true;
            env.createImageBitmap(frame).then(next => {
                if (closed) { next.close(); return; }
                const old = bitmap;
                bitmap = next;
                install(next);
                old?.close();
            }, () => {}).finally(() => { frame.close(); busy = false; });
        },
        close() {
            if (closed) return;
            closed = true;
            generation++;
            connection.close();
            if (decoder && decoder.state !== "closed") decoder.close();
            newest.clear();
            waiting = [];
            held?.close(); held = null;
            stream.texture?.dispose();
            bitmap?.close(); bitmap = null;
        },
    };
    const fail = (message: string | null) => {
        if (closed) return;
        stream.failure = message;
        stream.close();
        if (message) events.closed(); else events.error();
    };
    const feed = (chunk: CaptureChunk) => {
        (globalThis as any).__dbg = ((globalThis as any).__dbg ?? []); (globalThis as any).__dbg.push(['in', chunk.timestampUs, chunk.key, decoder?.state, decoder?.decodeQueueSize, configuring]);
        if (!decoder || decoder.state !== "configured" || !gate.accept(chunk.key, decoder.decodeQueueSize)) return;
        try { decoder.decode(new env.EncodedVideoChunk({ type: chunk.key ? "key" : "delta", timestamp: chunk.timestampUs, data: chunk.data })); }
        catch { fail(null); }
    };
    const configure = async (config: CaptureConfig) => {
        const current = ++generation;
        configuring = true;
        gate.reset();
        let supported = false;
        try { supported = (await Decoder.isConfigSupported(decoderConfig(config))).supported === true; } catch { supported = false; }
        if (closed || current !== generation) return;
        if (!supported) { fail(CAPTURE_CODEC_UNSUPPORTED); return; }
        try {
            decoder ??= new Decoder({ output: frame => { (globalThis as any).__dbg = ((globalThis as any).__dbg ?? []); (globalThis as any).__dbg.push(['out', frame.timestamp]); if (closed) frame.close(); else newest.offer(frame); }, error: () => fail(null) });
            if (decoder.state === "configured") decoder.reset();
            decoder.configure(decoderConfig(config));
        } catch { fail(null); return; }
        configuring = false;
        for (const chunk of waiting.splice(0)) feed(chunk);
    };
    const connection = host.open(streamId, {
        config(config) { void configure(config); },
        chunk(chunk) {
            if (!configuring) { feed(chunk); return; }
            // The cached key frame comes right after the config, while the config check runs (R13).
            if (waiting.length < CONFIGURING_CHUNKS) waiting.push(chunk);
            else { waiting = []; gate.reset(); }
        },
        closed() { if (!closed) { stream.close(); events.closed(); } },
    });
    return stream;
}

/** What a renderer draws for one capture screen on this frame. */
export interface CaptureScreenView {
    entityId: Id;
    /** The texture to draw, or null: no decoded frame, a state other than live, or a failure. */
    texture: Texture | null;
    /** width / height of the quad, from the decoded size, else the host size, else 16:9. */
    aspect: number;
    warning: AppError | null;
}
export interface CaptureScreens {
    /** Opens and closes the sockets for this frame, uploads the newest frames, and gives one view for each capture screen. */
    apply(entities: readonly SceneEntity[]): Map<Id, CaptureScreenView>;
    /** Closes each socket (the preview pump stop); the next apply opens them again (R14). */
    pause(): void;
    /** Opened sockets, for the headless check. */
    sockets(): string[];
    dispose(): void;
}
export function createCaptureScreens(options: { host?: CaptureHost; upload: CaptureUpload; env?: CaptureEnv }): CaptureScreens {
    const env = options.env ?? browserCaptureEnv();
    const streams = new Map<string, Stream & { keys: string[] }>();
    // A stream that failed for a codec stays failed: a new config gives a new stream ID (R8).
    const codecFailures = new Map<string, string>();
    const reopenAt = new Map<string, number>();
    const retries = createRetries();
    let status: CaptureStatus | null = null;
    const off = options.host?.onStatus(next => { status = next; });
    const close = (id: string) => { streams.get(id)?.close(); streams.delete(id); };
    return {
        apply(entities) {
            const views = new Map<Id, CaptureScreenView>();
            const plans = captureScreenPlan(entities, status);
            // A scene without a capture screen opens no socket and changes nothing (Safeguards).
            if (plans.length === 0) { for (const id of [...streams.keys()]) close(id); retries.prune(new Set()); return views; }
            retries.prune(new Set(plans.map(plan => plan.key)));
            const rendererFailure = (plan: CaptureScreenPlan): string | null =>
                !env.VideoDecoder ? CAPTURE_NOT_IN_VIEW : retries.failed(plan.key) ? CAPTURE_FAILED : plan.streamId !== null && plan.state !== null && SOCKET_STATES.has(plan.state) ? codecFailures.get(plan.streamId) ?? null : null;
            const wanted = options.host ? wantedStreams(plans, plan => rendererFailure(plan) !== null) : new Set<string>();
            for (const id of [...streams.keys()]) if (!wanted.has(id)) close(id);
            for (const id of [...codecFailures.keys()]) if (!plans.some(plan => plan.streamId === id)) codecFailures.delete(id);
            const now = env.now();
            for (const id of wanted) {
                if (streams.has(id) || (reopenAt.get(id) ?? 0) > now) continue;
                reopenAt.delete(id);
                const stream: Stream & { keys: string[] } = Object.assign(openStream(id, options.host!, env, options.upload, {
                    error() {
                        if (streams.get(id) !== stream) return;
                        streams.delete(id);
                        for (const key of stream.keys) retries.fail(key);
                        reopenAt.set(id, env.now() + CAPTURE_RETRY_MS);
                    },
                    closed() {
                        if (streams.get(id) !== stream) return;
                        streams.delete(id);
                        if (stream.failure) codecFailures.set(id, stream.failure);
                        else reopenAt.set(id, env.now() + CAPTURE_RETRY_MS);
                    },
                }), { keys: [] as string[] });
                streams.set(id, stream);
            }
            for (const stream of streams.values()) { stream.keys = []; stream.upload(); }
            for (const plan of plans) {
                const stream = plan.streamId !== null ? streams.get(plan.streamId) : undefined;
                if (stream) stream.keys.push(plan.key);
                const failureText = rendererFailure(plan);
                const message = captureMessage(plan.state, failureText);
                const texture = plan.state === "live" && !failureText && stream?.texture && stream.texture.image ? stream.texture : null;
                const aspect = stream && stream.width > 0 ? stream.width / stream.height : plan.width > 0 && plan.height > 0 ? plan.width / plan.height : 16 / 9;
                views.set(plan.entityId, { entityId: plan.entityId, texture, aspect, warning: message ? { code: warningCode(message), message: captureWarning(message), ids: [plan.entityId] } : null });
            }
            return views;
        },
        pause() { for (const id of [...streams.keys()]) close(id); },
        sockets: () => [...streams.keys()],
        dispose() { off?.(); for (const id of [...streams.keys()]) close(id); },
    };
}
