// Image screens (B28 R11 to R15): one unlit quad for each screen, with one shared texture for each image asset.
import { DoubleSide, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SRGBColorSpace, Texture, type Object3D } from "three/webgpu";
import { failure } from "./apply-frame";

export type ImageFormat = "png" | "jpeg" | "webp" | "gif";
export interface ImageHeader { format: ImageFormat; width: number; height: number }
export const IMAGE_LOAD_FAILED = "Image failed to load";
const JPEG_SCAN_LIMIT = 1024 * 1024;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((value, i) => bytes[at + i] === value);
const ascii = (text: string) => [...text].map(c => c.charCodeAt(0));
/** The image type from the signature only. A GLB, a VRM, or any other file gives null. */
export function imageFormatOf(bytes: Uint8Array): ImageFormat | null {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
    if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
    if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "gif";
    return null;
}

// The JPEG EXIF orientation (TIFF tag 0x0112 in IFD0), or null. A bad value reads as absent, as in the host.
function exifOrientation(view: DataView, start: number, end: number): number | null {
    if (end - start < 8) return null;
    const order = view.getUint16(start);
    if (order !== 0x4949 && order !== 0x4d4d) return null;
    const little = order === 0x4949;
    const read16 = (offset: number) => start + offset + 2 <= end ? view.getUint16(start + offset, little) : null;
    const read32 = (offset: number) => start + offset + 4 <= end ? view.getUint32(start + offset, little) : null;
    if (read16(2) !== 42) return null;
    const ifd = read32(4);
    if (ifd === null) return null;
    const count = read16(ifd);
    if (count === null) return null;
    for (let index = 0; index < count; index++) {
        const entry = ifd + 2 + index * 12;
        if (read16(entry) === 0x0112 && read16(entry + 2) === 3) {
            const value = read16(entry + 8);
            return value !== null && value >= 1 && value <= 8 ? value : null;
        }
    }
    return null;
}

/**
 * The type and the display size from the header, with the same rules as `parse_image` in the host (B28 R4).
 * The host checks that they equal the record before it serves the file; the renderer has no record.
 */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
    const format = imageFormatOf(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = bytes.byteLength;
    const fits = (at: number, length: number) => at >= 0 && at + length <= size;
    let width = 0, height = 0;
    if (format === "png") {
        if (size < 33 || view.getUint32(8) !== 13 || !startsWith(bytes, ascii("IHDR"), 12)) return null;
        width = view.getUint32(16); height = view.getUint32(20);
    } else if (format === "jpeg") {
        const limit = Math.min(size, JPEG_SCAN_LIMIT);
        let pos = 2, orientation: number | null = null, found = false;
        while (!found) {
            if (pos >= limit || bytes[pos] !== 0xff) return null;
            while (pos < limit && bytes[pos] === 0xff) pos++;
            if (pos >= limit) return null;
            const marker = bytes[pos++]!;
            if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) continue;
            if (marker === 0xda || marker === 0xd9 || marker === 0x00) return null;
            if (pos + 2 > limit) return null;
            const length = view.getUint16(pos);
            if (length < 2 || pos + length > limit) return null;
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                if (length < 7) return null;
                height = view.getUint16(pos + 3); width = view.getUint16(pos + 5);
                if (orientation !== null && orientation >= 5) [width, height] = [height, width];
                found = true;
            } else if (marker === 0xe1 && orientation === null && length >= 8 && startsWith(bytes, [...ascii("Exif"), 0, 0], pos + 2)) {
                orientation = exifOrientation(view, pos + 8, pos + length);
            }
            pos += length;
        }
    } else if (format === "webp") {
        if (size < 20 || view.getUint32(4, true) !== size - 8) return null;
        const length = view.getUint32(16, true), data = 20;
        if (!fits(data, length)) return null;
        const chunk = String.fromCharCode(...bytes.subarray(12, 16));
        if (chunk === "VP8 ") {
            if (length < 10 || !startsWith(bytes, [0x9d, 0x01, 0x2a], data + 3)) return null;
            width = view.getUint16(data + 6, true) & 0x3fff; height = view.getUint16(data + 8, true) & 0x3fff;
        } else if (chunk === "VP8L") {
            if (length < 5 || bytes[data] !== 0x2f) return null;
            const bits = view.getUint32(data + 1, true);
            width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
        } else if (chunk === "VP8X") {
            if (length < 10) return null;
            const u24 = (at: number) => bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16);
            width = u24(data + 4) + 1; height = u24(data + 7) + 1;
        } else return null;
    } else if (format === "gif") {
        // The renderer draws the first frame; the size is the logical screen. The host walks the blocks.
        if (size < 13) return null;
        width = view.getUint16(6, true); height = view.getUint16(8, true);
    } else return null;
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 33554432) return null;
    return { format, width, height };
}

/** True when any alpha value is below 255. */
export function hasAlpha(pixels: Uint8ClampedArray | Uint8Array): boolean {
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 255) return true;
    return false;
}

/** The decode size: the display size, scaled down so that the longest side is at most `maxTextureSize`. */
export function decodeSize(header: Pick<ImageHeader, "width" | "height">, maxTextureSize: number): { width: number; height: number } | null {
    const longest = Math.max(header.width, header.height);
    if (longest <= maxTextureSize) return null;
    return { width: Math.max(1, Math.round(header.width * maxTextureSize / longest)), height: Math.max(1, Math.round(header.height * maxTextureSize / longest)) };
}

/** The one `createImageBitmap` options object of R12. */
export function bitmapOptions(header: ImageHeader, maxTextureSize: number): ImageBitmapOptions {
    const resize = decodeSize(header, maxTextureSize);
    return { premultiplyAlpha: "none", colorSpaceConversion: "default", imageOrientation: "from-image", ...(resize ? { resizeWidth: resize.width, resizeHeight: resize.height, resizeQuality: "high" } : {}) };
}

const MIME: Record<ImageFormat, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
/** Reads the decoded bitmap once. A failed read counts as alpha, so the image blends. */
export function bitmapHasAlpha(bitmap: ImageBitmap): boolean {
    try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) return true;
        context.drawImage(bitmap, 0, 0);
        return hasAlpha(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
    } catch { return true; }
}

export interface ScreenImage { texture: Texture; width: number; height: number; alpha: boolean; dispose(): void }
type Decode = (blob: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;
/** Reads, checks, and decodes one image asset. Each failure has the one message of R13. */
export async function loadScreenImage(read: () => Promise<ArrayBuffer>, maxTextureSize: number, decode: Decode = (blob, options) => createImageBitmap(blob, options), alphaOf: (bitmap: ImageBitmap) => boolean = bitmapHasAlpha): Promise<ScreenImage> {
    let bitmap: ImageBitmap | undefined;
    try {
        const bytes = new Uint8Array(await read());
        const header = readImageHeader(bytes);
        if (!header) throw new Error("bad signature or header");
        bitmap = await decode(new Blob([bytes], { type: MIME[header.format] }), bitmapOptions(header, maxTextureSize));
        const alpha = alphaOf(bitmap);
        const texture = new Texture(bitmap);
        texture.colorSpace = SRGBColorSpace;
        // The quad UVs put image row 0 at the top, so no upload flip is needed on WebGL 2 or WebGPU (R12).
        texture.flipY = false;
        texture.premultiplyAlpha = false;
        texture.needsUpdate = true;
        const image = bitmap;
        let disposed = false;
        return { texture, width: header.width, height: header.height, alpha, dispose() { if (disposed) return; disposed = true; texture.dispose(); image.close(); } };
    } catch (error) {
        bitmap?.close();
        throw Object.assign(failure("INVALID_INPUT", IMAGE_LOAD_FAILED), { cause: error });
    }
}

/** One quad, 1 m high, centered on the origin in the local XY plane, facing +Z (R11). The material is unlit (R14). */
export function createScreenMesh(image: Pick<ScreenImage, "texture" | "width" | "height" | "alpha">): { root: Object3D; dispose(): void } {
    const geometry = new PlaneGeometry(image.width / image.height, 1);
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const material = new MeshBasicNodeMaterial({ map: image.texture, side: DoubleSide, transparent: image.alpha, depthWrite: !image.alpha });
    material.toneMapped = false;
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return { root: mesh, dispose() { geometry.dispose(); material.dispose(); mesh.removeFromParent(); } };
}
