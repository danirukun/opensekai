// Video screens (B29 R12 to R17): the container read, the decode check, one object URL for each asset, one element for
// each screen, the playback sync with the session position, and the failure messages.
import { Texture, VideoTexture, SRGBColorSpace } from "three/webgpu";
import type { AppError, ScreenPlayback, VideoAudioCodec, VideoCodec } from "@opensekai/contracts";
import { failure } from "./apply-frame";

export type VideoFormat = "mp4" | "webm";
export interface VideoInfo { format: VideoFormat; codec: VideoCodec; codecString: string; audioCodec: VideoAudioCodec | null; alpha: boolean }
/** The coded size is only for the decode check. */
export interface VideoHeader extends VideoInfo { width: number; height: number }

export const VIDEO_LOAD_FAILED = "Video failed to load";
export const VIDEO_PLAYBACK_BLOCKED = "Video playback blocked";
export const VIDEO_LOAD_TIMEOUT_MS = 10_000;
const HAVE_METADATA = 1;
/** The session clock step (1/60 s). */
export const FRAME_MS = 1000 / 60;
/** The drift limit of a playing entry (R14). */
export const DRIFT_LIMIT_MS = 250;
const SEEK_REFRESH_FRAMES = 6;
const CODEC_NAME: Record<VideoCodec, string> = { h264: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1" };
const AUDIO_NAME: Record<VideoAudioCodec, string> = { aac: "AAC", mp3: "MP3", opus: "Opus", vorbis: "Vorbis" };
export const videoCodecMessage = (codec: VideoCodec) => `Video codec not supported: ${CODEC_NAME[codec]}`;
export const audioCodecMessage = (codec: VideoAudioCodec) => `Audio codec not supported: ${AUDIO_NAME[codec]}`;
const AUDIO_STRING: Record<VideoAudioCodec, string> = { aac: "mp4a.40.2", mp3: "mp3", opus: "opus", vorbis: "vorbis" };
export const videoContentType = (info: Pick<VideoInfo, "format" | "codecString">) => `video/${info.format}; codecs="${info.codecString}"`;
export const audioContentType = (info: Pick<VideoInfo, "format">, codec: VideoAudioCodec) => `audio/${info.format}; codecs="${AUDIO_STRING[codec]}"`;

const MAX_SIZE = 4096;
const WEBM_HEADER_LIMIT = 16 * 1024 * 1024;
const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
const hex = (value: number) => value.toString(16).toUpperCase();
const hex2 = (value: number) => value.toString(16).toUpperCase().padStart(2, "0");
const pad2 = (value: number) => String(value).padStart(2, "0");

// The AV1 codec string from an av1C record (the AV1 ISO BMFF binding, also the WebM CodecPrivate).
function av1String(bytes: Uint8Array, at: number, end: number): string | null {
    if (end - at < 4 || bytes[at] !== 0x81) return null;
    const profile = bytes[at + 1]! >> 5, level = bytes[at + 1]! & 31, flags = bytes[at + 2]!;
    const tier = flags & 0x80 ? "H" : "M";
    const depth = flags & 0x40 ? (flags & 0x20 ? 12 : 10) : 8;
    return `av01.${profile}.${pad2(level)}${tier}.${pad2(depth)}`;
}

// ISO BMFF boxes. A box body runs from `body` to `end`. A bad size gives null.
type Box = { type: string; body: number; end: number };
function boxes(bytes: Uint8Array, view: DataView, start: number, end: number): Box[] | null {
    const found: Box[] = [];
    let pos = start;
    while (pos < end) {
        if (pos + 8 > end) return null;
        let size = view.getUint32(pos), header = 8;
        const type = ascii(bytes, pos + 4, 4);
        if (size === 1) {
            if (pos + 16 > end) return null;
            const large = view.getBigUint64(pos + 8);
            if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
            size = Number(large); header = 16;
        } else if (size === 0) size = end - pos;
        if (size < header || pos + size > end) return null;
        found.push({ type, body: pos + header, end: pos + size });
        pos += size;
    }
    return found;
}

function readMp4(bytes: Uint8Array, view: DataView): VideoHeader | null {
    const top = boxes(bytes, view, 0, bytes.byteLength);
    if (!top || top[0]?.type !== "ftyp" || top[0].end - top[0].body < 4 || ascii(bytes, top[0].body, 4) === "qt  ") return null;
    const moovs = top.filter(box => box.type === "moov");
    if (moovs.length !== 1) return null;
    const child = (parent: Box | undefined, type: string, offset = 0) => parent ? boxes(bytes, view, parent.body + offset, parent.end)?.find(box => box.type === type) : undefined;
    const traks = boxes(bytes, view, moovs[0]!.body, moovs[0]!.end)?.filter(box => box.type === "trak");
    if (!traks) return null;
    let video: VideoHeader | null = null, audio: VideoAudioCodec | null | undefined;
    for (const trak of traks) {
        const mdia = child(trak, "mdia");
        const hdlr = child(mdia, "hdlr");
        if (!hdlr || hdlr.end - hdlr.body < 12) continue;
        const handler = ascii(bytes, hdlr.body + 8, 4);
        if ((handler === "vide" && video) || (handler === "soun" && audio !== undefined) || (handler !== "vide" && handler !== "soun")) continue;
        const stsd = child(child(child(mdia, "minf"), "stbl"), "stsd");
        if (!stsd || stsd.end - stsd.body < 8) return null;
        const entry = boxes(bytes, view, stsd.body + 8, stsd.end)?.[0];
        if (!entry) return null;
        if (handler === "vide") {
            // A visual sample entry has 78 bytes before its child boxes.
            if (entry.end - entry.body < 78) return null;
            const width = view.getUint16(entry.body + 24), height = view.getUint16(entry.body + 26);
            const config = (type: string) => child(entry, type, 78);
            let codec: VideoCodec, codecString: string | null = null;
            if (entry.type === "avc1" || entry.type === "avc3") {
                codec = "h264";
                const avcC = config("avcC");
                if (avcC && avcC.end - avcC.body >= 4) codecString = `${entry.type}.${hex2(bytes[avcC.body + 1]!)}${hex2(bytes[avcC.body + 2]!)}${hex2(bytes[avcC.body + 3]!)}`;
            } else if (entry.type === "hvc1" || entry.type === "hev1") {
                codec = "hevc";
                const hvcC = config("hvcC");
                if (hvcC && hvcC.end - hvcC.body >= 13) {
                    const at = hvcC.body, first = bytes[at + 1]!;
                    let flags = view.getUint32(at + 2), reversed = 0;
                    for (let bit = 0; bit < 32; bit++) { reversed = (reversed << 1) | (flags & 1); flags >>>= 1; }
                    const constraints = [...bytes.subarray(at + 6, at + 12)];
                    while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
                    codecString = [`${entry.type}`, `${["", "A", "B", "C"][first >> 6]}${first & 31}`, hex(reversed >>> 0), `${first & 0x20 ? "H" : "L"}${bytes[at + 12]}`, ...constraints.map(hex)].join(".");
                }
            } else if (entry.type === "av01") {
                codec = "av1";
                const av1C = config("av1C");
                if (av1C) codecString = av1String(bytes, av1C.body, av1C.end);
            } else return null;
            if (!codecString) return null;
            video = { format: "mp4", codec, codecString, audioCodec: null, alpha: false, width, height };
        } else {
            // An audio sample entry has 28 bytes (version 0), 44 (version 1), or 64 (version 2) before its child boxes.
            if (entry.end - entry.body < 28) return null;
            const offset = [28, 44, 64][view.getUint16(entry.body + 8)];
            if (offset === undefined) return null;
            if (entry.type === "Opus") audio = "opus";
            else if (entry.type === "mp4a") {
                const esds = child(entry, "esds", offset);
                const type = esds ? esdsObjectType(bytes, esds.body + 4, esds.end) : null;
                audio = type === 0x40 ? "aac" : type === 0x69 || type === 0x6b ? "mp3" : null;
                if (audio === null) return null;
            } else return null;
        }
    }
    if (!video) return null;
    return { ...video, audioCodec: audio ?? null };
}

// The object type of the DecoderConfigDescriptor (tag 0x04) inside the ES_Descriptor (tag 0x03).
function esdsObjectType(bytes: Uint8Array, start: number, end: number): number | null {
    const descriptor = (at: number, tag: number): { body: number; end: number } | null => {
        if (at >= end || bytes[at] !== tag) return null;
        let size = 0, pos = at + 1;
        for (let i = 0; i < 4; i++) {
            if (pos >= end) return null;
            const byte = bytes[pos++]!;
            size = (size << 7) | (byte & 0x7f);
            if (!(byte & 0x80)) break;
        }
        return pos + size <= end ? { body: pos, end: pos + size } : null;
    };
    const es = descriptor(start, 0x03);
    if (!es || es.end - es.body < 3) return null;
    const flags = bytes[es.body + 2]!;
    let pos = es.body + 3;
    if (flags & 0x80) pos += 2;
    if (flags & 0x40) { if (pos >= es.end) return null; pos += 1 + bytes[pos]!; }
    if (flags & 0x20) pos += 2;
    const config = descriptor(pos, 0x04);
    return config && config.end > config.body ? bytes[config.body]! : null;
}

// EBML: element IDs keep their marker bits; sizes do not. An unknown size is -1.
const UNKNOWN = -1;
function vint(bytes: Uint8Array, at: number, max: number, keepMarker: boolean): { value: number; length: number } | null {
    const first = bytes[at];
    if (first === undefined || first === 0) return null;
    const length = Math.clz32(first) - 23;
    if (length > max || at + length > bytes.byteLength) return null;
    let value = keepMarker ? first : first & (0xff >> length), allOnes = (first & (0xff >> length)) === 0xff >> length;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[at + i]!; if (bytes[at + i] !== 0xff) allOnes = false; }
    return { value: !keepMarker && allOnes ? UNKNOWN : value, length };
}
type Element = { id: number; body: number; end: number; unknown: boolean };
function element(bytes: Uint8Array, at: number, end: number): Element | null {
    const id = vint(bytes, at, 4, true);
    if (!id) return null;
    const size = vint(bytes, at + id.length, 8, false);
    if (!size) return null;
    const body = at + id.length + size.length;
    if (size.value === UNKNOWN) return { id: id.value, body, end, unknown: true };
    if (body + size.value > end) return null;
    return { id: id.value, body, end: body + size.value, unknown: false };
}
function elements(bytes: Uint8Array, start: number, end: number): Element[] | null {
    const found: Element[] = [];
    for (let pos = start; pos < end;) {
        const next = element(bytes, pos, end);
        if (!next || next.unknown) return null;
        found.push(next);
        pos = next.end;
    }
    return found;
}
const uint = (bytes: Uint8Array, e: Element) => { let value = 0; for (let i = e.body; i < e.end; i++) value = value * 256 + bytes[i]!; return value; };

const EBML = 0x1a45dfa3, DOC_TYPE = 0x4282, SEGMENT = 0x18538067, INFO = 0x1549a966, TRACKS = 0x1654ae6b, CLUSTER = 0x1f43b675;
const TRACK_ENTRY = 0xae, TRACK_TYPE = 0x83, CODEC_ID = 0x86, CODEC_PRIVATE = 0x63a2, VIDEO = 0xe0, ALPHA_MODE = 0x53c0, PIXEL_WIDTH = 0xb0, PIXEL_HEIGHT = 0xba, CONTENT_ENCODINGS = 0x6d80;

// The VP9 codec string from the WebM CodecPrivate feature list, when it has the profile, the level, and the bit depth.
function vp9String(bytes: Uint8Array, e: Element | undefined): string {
    if (!e) return "vp9";
    const features = new Map<number, number>();
    for (let pos = e.body; pos + 2 <= e.end;) {
        const id = bytes[pos]!, length = bytes[pos + 1]!;
        if (pos + 2 + length > e.end) break;
        if (length === 1) features.set(id, bytes[pos + 2]!);
        pos += 2 + length;
    }
    const [profile, level, depth] = [features.get(1), features.get(2), features.get(3)];
    return profile === undefined || level === undefined || depth === undefined ? "vp9" : `vp09.${pad2(profile)}.${pad2(level)}.${pad2(depth)}`;
}

function readWebm(bytes: Uint8Array): VideoHeader | null {
    const header = element(bytes, 0, bytes.byteLength);
    if (!header || header.unknown || header.id !== EBML) return null;
    const docType = elements(bytes, header.body, header.end)?.find(e => e.id === DOC_TYPE);
    if (!docType || ascii(bytes, docType.body, docType.end - docType.body).replace(/\0+$/, "") !== "webm") return null;
    const segment = element(bytes, header.end, bytes.byteLength);
    if (!segment || segment.id !== SEGMENT) return null;
    const limit = Math.min(segment.end, segment.body + WEBM_HEADER_LIMIT);
    let info = false, tracks: Element | undefined;
    for (let pos = segment.body; pos < limit && !(info && tracks);) {
        const next = element(bytes, pos, segment.end);
        if (!next || next.id === CLUSTER || (next.unknown)) return null;
        if (next.id === INFO) info = true;
        if (next.id === TRACKS) tracks = next;
        pos = next.end;
    }
    if (!info || !tracks) return null;
    const entries = elements(bytes, tracks.body, tracks.end)?.filter(e => e.id === TRACK_ENTRY);
    if (!entries) return null;
    let video: VideoHeader | null = null, audio: VideoAudioCodec | null | undefined;
    for (const entry of entries) {
        const fields = elements(bytes, entry.body, entry.end);
        if (!fields) return null;
        const field = (id: number) => fields.find(e => e.id === id);
        const type = field(TRACK_TYPE), codecId = field(CODEC_ID);
        const kind = type ? uint(bytes, type) : 0;
        if ((kind === 1 && video) || (kind === 2 && audio !== undefined) || (kind !== 1 && kind !== 2)) continue;
        if (field(CONTENT_ENCODINGS) || !codecId) return null;
        const id = ascii(bytes, codecId.body, codecId.end - codecId.body).replace(/\0+$/, "");
        if (kind === 1) {
            const settings = field(VIDEO);
            const videoFields = settings ? elements(bytes, settings.body, settings.end) : [];
            if (!videoFields) return null;
            const setting = (sid: number) => { const e = videoFields.find(item => item.id === sid); return e ? uint(bytes, e) : undefined; };
            const privateData = field(CODEC_PRIVATE);
            let codec: VideoCodec, codecString: string;
            if (id === "V_VP8") { codec = "vp8"; codecString = "vp8"; }
            else if (id === "V_VP9") { codec = "vp9"; codecString = vp9String(bytes, privateData); }
            else if (id === "V_AV1") { codec = "av1"; codecString = (privateData && av1String(bytes, privateData.body, privateData.end)) ?? "av01"; }
            else return null;
            video = { format: "webm", codec, codecString, audioCodec: null, alpha: setting(ALPHA_MODE) === 1, width: setting(PIXEL_WIDTH) ?? 0, height: setting(PIXEL_HEIGHT) ?? 0 };
        } else {
            if (id === "A_OPUS") audio = "opus";
            else if (id === "A_VORBIS") audio = "vorbis";
            else return null;
        }
    }
    if (!video) return null;
    return { ...video, audioCodec: audio ?? null };
}

/** The container read of R13, for the decode check. A GLB, a VRM, an image, or another file gives null. */
export function readVideoHeader(bytes: Uint8Array): VideoHeader | null {
    try {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const header = bytes.byteLength >= 8 && ascii(bytes, 4, 4) === "ftyp" ? readMp4(bytes, view) : bytes.byteLength >= 4 && view.getUint32(0) === EBML ? readWebm(bytes) : null;
        if (!header || header.width < 1 || header.height < 1 || header.width > MAX_SIZE || header.height > MAX_SIZE) return null;
        return header;
    } catch { return null; }
}
/** The format, the codec family, the RFC 6381 codec string, the audio codec, and the alpha flag (R13). */
export function readVideoInfo(bytes: Uint8Array): VideoInfo | null {
    const header = readVideoHeader(bytes);
    if (!header) return null;
    const { format, codec, codecString, audioCodec, alpha } = header;
    return { format, codec, codecString, audioCodec, alpha };
}

export interface MediaSupport {
    decodingInfo?: (configuration: MediaDecodingConfiguration) => Promise<{ supported: boolean }>;
    canPlayType: (type: string) => string;
}
// Chromium answers `supported: false` for a codec string without the profile and the level ("vp9", "av01"), so the
// short forms use canPlayType. The element error after the load still catches a codec that the check passes.
const qualified = (codecString: string) => codecString === "vp8" || codecString.includes(".");
/** The R15 decode check before the element loads. It gives the failure message, or null. */
export async function decodeFailure(header: VideoHeader, media: MediaSupport): Promise<string | null> {
    const contentType = videoContentType(header);
    const videoOk = media.decodingInfo && qualified(header.codecString)
        ? (await media.decodingInfo({ type: "file", video: { contentType, width: header.width, height: header.height, bitrate: 1, framerate: 30 } })).supported
        : media.canPlayType(contentType) !== "";
    if (!videoOk) return videoCodecMessage(header.codec);
    if (header.audioCodec) {
        const type = audioContentType(header, header.audioCodec);
        const audioOk = media.decodingInfo ? (await media.decodingInfo({ type: "file", audio: { contentType: type } })).supported : media.canPlayType(type) !== "";
        if (!audioOk) return audioCodecMessage(header.audioCodec);
    }
    return null;
}

const browserMedia = (): MediaSupport => {
    const probe = document.createElement("video");
    const capabilities = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
    return { decodingInfo: capabilities ? configuration => capabilities.decodingInfo(configuration) : undefined, canPlayType: type => probe.canPlayType(type) };
};

export interface VideoSource { url: string; header: VideoHeader; dispose(): void }
/**
 * Reads, checks, and wraps one video asset as one object URL (R13). The read buffer goes when this returns; the Blob
 * stays until the URL is revoked. Each failure has one message of R15.
 */
export async function loadVideoSource(read: () => Promise<ArrayBuffer>, media: () => MediaSupport = browserMedia, urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL): Promise<VideoSource> {
    let header: VideoHeader | null, bytes: Uint8Array;
    try {
        bytes = new Uint8Array(await read());
        header = readVideoHeader(bytes);
    } catch (error) { throw Object.assign(failure("UNAVAILABLE", VIDEO_LOAD_FAILED), { cause: error }); }
    if (!header) throw failure("INVALID_INPUT", VIDEO_LOAD_FAILED);
    let message: string | null;
    try { message = await decodeFailure(header, media()); }
    catch (error) { throw Object.assign(failure("UNAVAILABLE", VIDEO_LOAD_FAILED), { cause: error }); }
    if (message) throw failure("UNSUPPORTED", message);
    const url = urls.createObjectURL(new Blob([bytes as BlobPart], { type: `video/${header.format}` }));
    let revoked = false;
    return { url, header, dispose() { if (!revoked) { revoked = true; urls.revokeObjectURL(url); } } };
}

/** R16: only the OBS page plays sound. */
export const audioState = (audio: boolean, volume: number) => ({ muted: !audio, volume });

export interface PlaybackDecision { targetMs: number; run: boolean; seek: boolean }
/**
 * The R14 decision for one element. `durationMs` is the element duration; without a finite duration the position is
 * not wrapped or clamped.
 */
export function decidePlayback(entry: Pick<ScreenPlayback, "playing" | "positionMs">, loop: boolean, durationMs: number, currentMs: number): PlaybackDecision {
    const known = Number.isFinite(durationMs) && durationMs > 0;
    const end = known ? Math.max(0, durationMs - FRAME_MS) : Infinity;
    const targetMs = !known ? entry.positionMs : loop ? entry.positionMs % durationMs : Math.min(entry.positionMs, end);
    const run = entry.playing && (loop || entry.positionMs < end);
    const gap = Math.abs(currentMs - targetMs);
    const distance = known && loop ? Math.min(gap, durationMs - gap) : gap;
    return { targetMs, run, seek: distance > (run ? DRIFT_LIMIT_MS : FRAME_MS) };
}

/** `element`: three.js VideoTexture (the element is the upload source). `bitmap`: one ImageBitmap copy for each new frame. */
export type VideoUpload = "element" | "bitmap";
export interface ScreenVideoPlayer {
    texture: Texture; width: number; height: number; alpha: boolean;
    /** Applies one frame. It gives the frame warning of R14, or null. */
    sync(entry: Pick<ScreenPlayback, "playing" | "positionMs"> | undefined, content: { loop: boolean; volume: number }, visible: boolean): AppError | null;
    pause(): void;
    /** The R15 message of an element error after the load, or undefined. */
    failure(): string | undefined;
    /** Test only: resolves when the last seek or play has a new frame in the texture. */
    settled(): Promise<void>;
    dispose(): void;
}
type VideoElement = Pick<HTMLVideoElement, "playsInline" | "preload" | "loop" | "muted" | "volume" | "src" | "currentTime" | "duration" | "paused" | "seeking" | "error" | "readyState" | "videoWidth" | "videoHeight" | "play" | "pause" | "addEventListener" | "removeEventListener" | "removeAttribute" | "load"> & Partial<Pick<HTMLVideoElement, "requestVideoFrameCallback" | "cancelVideoFrameCallback">>;
export interface PlayerOptions { audio: boolean; loop: boolean; volume: number; upload: VideoUpload; timeoutMs?: number; element?: () => VideoElement; bitmap?: (source: VideoElement) => Promise<ImageBitmap> }

const elementMessage = (element: VideoElement, codec: VideoCodec) => {
    const code = element.error?.code;
    return code === 3 || code === 4 ? videoCodecMessage(codec) : VIDEO_LOAD_FAILED;
};

/**
 * One element for one screen (R13). It resolves at `loadeddata` and fails at an element error or after 10 s.
 * macOS WebKit reads the metadata of an AV1 WebM, then decodes no frame and sends no error, so a timeout after the metadata names the codec (R15).
 */
export async function openScreenVideo(source: VideoSource, options: PlayerOptions): Promise<ScreenVideoPlayer> {
    const element = options.element?.() ?? document.createElement("video");
    element.playsInline = true;
    element.preload = "auto";
    element.loop = options.loop;
    Object.assign(element, audioState(options.audio, options.volume));
    const detach: (() => void)[] = [];
    const listen = (type: string, handler: () => void) => { element.addEventListener(type, handler); detach.push(() => element.removeEventListener(type, handler)); };
    const release = () => { for (const off of detach.splice(0)) off(); element.pause(); element.removeAttribute("src"); element.load(); };
    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(element.readyState >= HAVE_METADATA ? failure("UNSUPPORTED", videoCodecMessage(source.header.codec)) : failure("TIMEOUT", VIDEO_LOAD_FAILED)), options.timeoutMs ?? VIDEO_LOAD_TIMEOUT_MS);
            listen("loadeddata", () => { clearTimeout(timer); resolve(); });
            listen("error", () => { clearTimeout(timer); reject(failure("UNSUPPORTED", elementMessage(element, source.header.codec))); });
            element.src = source.url;
        });
    } catch (error) { release(); throw error; }
    for (const off of detach.splice(0)) off();

    let disposed = false, lateFailure: string | undefined, playing = false, blocked = false;
    let pending = false, waiters: (() => void)[] = [], frameCallback = 0, refreshFrames = 0;
    const settle = () => { if (!pending || element.seeking || refreshFrames > 0) return; pending = false; for (const done of waiters.splice(0)) done(); };
    // Headless Chromium does not call requestVideoFrameCallback for a paused element outside the DOM after a seek, and a
    // read right at `seeked` can still give the frame before the seek. So after a seek the texture is read again on the
    // next SEEK_REFRESH_FRAMES applied frames.
    let texture: Texture, refresh: () => void, closeBitmap = () => {};
    if (options.upload === "element") {
        const video = new VideoTexture(element as HTMLVideoElement);
        texture = video;
        refresh = () => { video.needsUpdate = true; settle(); };
        video.needsUpdate = true;
    } else {
        // WebGPU: a copy of the element itself fails on the software adapter (spike, Operation 5 step 1), so each new
        // frame becomes one ImageBitmap, which three.js copies with copyExternalImageToTexture.
        const makeBitmap = options.bitmap ?? (video => createImageBitmap(video as HTMLVideoElement));
        let current = await makeBitmap(element).catch((error: unknown) => { release(); throw Object.assign(failure("UNAVAILABLE", VIDEO_LOAD_FAILED), { cause: error }); });
        texture = new Texture(current);
        let busy = false, again = false;
        refresh = () => {
            if (busy) { again = true; return; }
            busy = true;
            void makeBitmap(element).then(next => {
                if (disposed) { next.close(); return; }
                const old = current;
                current = next; texture.image = next; texture.needsUpdate = true;
                old.close();
                settle();
            }, () => {}).finally(() => { busy = false; if (again && !disposed) { again = false; refresh(); } });
        };
        closeBitmap = () => current.close();
        texture.needsUpdate = true;
    }
    texture.colorSpace = SRGBColorSpace;
    // The quad UVs put row 0 at the top, as for an image (B28 R12).
    texture.flipY = false;
    texture.premultiplyAlpha = false;
    const onFrame = () => { if (disposed) return; if (options.upload === "bitmap") refresh(); else settle(); frameCallback = element.requestVideoFrameCallback?.(onFrame) ?? 0; };
    frameCallback = element.requestVideoFrameCallback?.(onFrame) ?? 0;
    listen("seeked", () => { if (!disposed) { refreshFrames = SEEK_REFRESH_FRAMES; refresh(); } });
    listen("error", () => { lateFailure = elementMessage(element, source.header.codec); });

    const play = () => {
        if (playing) return;
        playing = true;
        pending = true;
        // A pause during a pending play() rejects with AbortError; only a refused play() is blocked.
        void element.play().then(() => { blocked = false; }, (error: unknown) => { playing = false; if ((error as { name?: string } | null)?.name !== "AbortError") blocked = true; });
    };
    const pause = () => { playing = false; if (!element.paused) element.pause(); };
    return {
        texture, width: element.videoWidth, height: element.videoHeight, alpha: source.header.alpha,
        sync(entry, content, visible) {
            if (disposed) return null;
            element.loop = content.loop;
            Object.assign(element, audioState(options.audio, content.volume));
            if (refreshFrames > 0 && !element.seeking) { refreshFrames--; refresh(); }
            if (!visible || !entry) { pause(); return null; }
            const decision = decidePlayback(entry, content.loop, element.duration * 1000, element.currentTime * 1000);
            if (decision.seek && !element.seeking) { element.currentTime = decision.targetMs / 1000; pending = true; }
            if (decision.run) { if (element.paused) playing = false; play(); }
            else pause();
            return decision.run && blocked ? { code: "UNSUPPORTED", message: VIDEO_PLAYBACK_BLOCKED, ids: [] } : null;
        },
        pause,
        failure: () => lateFailure,
        settled: () => pending ? new Promise<void>(resolve => waiters.push(resolve)) : Promise.resolve(),
        dispose() {
            if (disposed) return;
            disposed = true;
            if (frameCallback) element.cancelVideoFrameCallback?.(frameCallback);
            for (const done of waiters.splice(0)) done();
            texture.dispose();
            closeBitmap();
            release();
        },
    };
}
