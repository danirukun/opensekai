import { it, expect, vi, beforeEach } from 'vitest';
import { DoubleSide, Mesh, Texture, type Group, type MeshBasicNodeMaterial } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
import { bitmapOptions, createScreenMesh, decodeSize, hasAlpha, imageFormatOf, IMAGE_LOAD_FAILED, readImageHeader } from '../src/screen';
const ports = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), compile: vi.fn(), image: vi.fn() }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: new Texture(), dispose() {} }) }));
vi.mock('../src/screen', async original => ({ ...await original<typeof import('../src/screen')>(), loadScreenImage: (read: () => Promise<ArrayBuffer>, max: number) => ports.image(read, max) }));
import { createRenderer } from '../src/renderer';

// Headers in the same shapes as the host parser tests (apps/desktop/src-tauri/src/assets/image.rs).
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const text = (s: string) => [...s].map(c => c.charCodeAt(0));
const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...be32(13), ...text('IHDR'), ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
const exif = (orientation: number) => { const tiff = [...text('MM'), 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]; const seg = [...text('Exif'), 0, 0, ...tiff]; return [0xff, 0xe1, (seg.length + 2) >> 8, (seg.length + 2) & 255, ...seg]; };
const jpeg = (w: number, h: number, orientation?: number) => new Uint8Array([0xff, 0xd8, ...(orientation ? exif(orientation) : []), 0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
const riff = (chunk: string, data: number[]) => { const body = [...text('WEBP'), ...text(chunk), ...le32(data.length), ...data]; return new Uint8Array([...text('RIFF'), ...le32(body.length), ...body]); };
const vp8l = (w: number, h: number) => riff('VP8L', [0x2f, ...le32((w - 1) | ((h - 1) << 14)), 0, 0, 0]);
const gif = (w: number, h: number) => new Uint8Array([...text('GIF89a'), ...le16(w), ...le16(h), 0, 0, 0, 0x2c, 0, 0, 0, 0, ...le16(w), ...le16(h), 0, 2, 2, 0x4c, 1, 0, 0x3b]);
const glb = () => new Uint8Array([...text('glTF'), ...le32(2), ...le32(20), ...le32(0), ...le32(0x4e4f534a)]);

it('finds the type from the signature only', () => {
    expect([png(1, 1), jpeg(1, 1), vp8l(1, 1), gif(1, 1)].map(imageFormatOf)).toEqual(['png', 'jpeg', 'webp', 'gif']);
    expect(imageFormatOf(glb())).toBeNull();
    expect(imageFormatOf(new Uint8Array())).toBeNull();
    expect(imageFormatOf(new Uint8Array(text('RIFF....WAVE')))).toBeNull();
});
it('reads the display size of each type, with the JPEG orientation', () => {
    expect(readImageHeader(png(40, 20))).toEqual({ format: 'png', width: 40, height: 20 });
    expect(readImageHeader(jpeg(40, 30))).toEqual({ format: 'jpeg', width: 40, height: 30 });
    expect(readImageHeader(jpeg(40, 30, 6))).toEqual({ format: 'jpeg', width: 30, height: 40 });
    expect(readImageHeader(jpeg(40, 30, 3))).toEqual({ format: 'jpeg', width: 40, height: 30 });
    expect(readImageHeader(vp8l(7, 9))).toEqual({ format: 'webp', width: 7, height: 9 });
    expect(readImageHeader(gif(3, 2))).toEqual({ format: 'gif', width: 3, height: 2 });
});
it('rejects a model, a truncated header, and a size out of range', () => {
    expect(readImageHeader(glb())).toBeNull();
    for (const bytes of [png(4, 3), jpeg(4, 3, 6), vp8l(4, 3), gif(4, 3)])
        for (let end = 0; end < 13; end++) expect(readImageHeader(bytes.subarray(0, end))).toBeNull();
    expect(readImageHeader(png(0, 3))).toBeNull();
    expect(readImageHeader(png(8193, 1))).toBeNull();
    expect(readImageHeader(png(8192, 4097))).toBeNull();
    expect(readImageHeader(png(8192, 4096))).not.toBeNull();
    const sized = vp8l(4, 3); sized[4] = 0;
    expect(readImageHeader(sized)).toBeNull();
});
it('finds alpha when any alpha value is below 255', () => {
    expect(hasAlpha(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
    expect(hasAlpha(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
    expect(hasAlpha(new Uint8Array([0, 0, 0, 0]))).toBe(true);
});
it('decodes once, at the profile limit, with straight alpha and the image orientation', () => {
    expect(decodeSize({ width: 2048, height: 1024 }, 2048)).toBeNull();
    expect(decodeSize({ width: 4096, height: 1000 }, 2048)).toEqual({ width: 2048, height: 500 });
    expect(bitmapOptions({ format: 'png', width: 100, height: 50 }, 1024)).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'default', imageOrientation: 'from-image' });
    expect(bitmapOptions({ format: 'jpeg', width: 3000, height: 4000 }, 1024)).toEqual({ premultiplyAlpha: 'none', colorSpaceConversion: 'default', imageOrientation: 'from-image', resizeWidth: 768, resizeHeight: 1024, resizeQuality: 'high' });
});
it('gives one message for each load failure', async () => {
    const { loadScreenImage } = await vi.importActual<typeof import('../src/screen')>('../src/screen');
    const bitmap = { width: 2, height: 1, close: vi.fn() } as unknown as ImageBitmap;
    const decode = vi.fn(async (_blob: Blob, _options: ImageBitmapOptions) => bitmap);
    const read = (bytes: Uint8Array) => async () => bytes.buffer as ArrayBuffer;
    for (const failing of [() => Promise.reject(new Error('404')), read(glb()), read(new Uint8Array([1, 2, 3]))])
        await expect(loadScreenImage(failing, 2048, decode, () => false)).rejects.toMatchObject({ message: IMAGE_LOAD_FAILED });
    expect(decode).not.toHaveBeenCalled();
    await expect(loadScreenImage(read(png(2, 1)), 2048, async () => { throw new Error('decode'); }, () => false)).rejects.toMatchObject({ message: IMAGE_LOAD_FAILED });
    const loaded = await loadScreenImage(read(png(2, 1)), 2048, decode, () => true);
    expect(decode.mock.lastCall![0]).toBeInstanceOf(Blob);
    expect((decode.mock.lastCall![0] as Blob).type).toBe('image/png');
    expect(loaded).toMatchObject({ width: 2, height: 1, alpha: true });
    expect(loaded.texture.flipY).toBe(false);
    expect(loaded.texture.colorSpace).toBe('srgb');
    loaded.dispose(); loaded.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
});
it('makes a 1 m high quad with the image aspect, an unlit double-sided material, and row 0 at the top', () => {
    const texture = new Texture();
    const opaque = createScreenMesh({ texture, width: 400, height: 200, alpha: false }).root as Mesh;
    opaque.geometry.computeBoundingBox();
    expect(opaque.geometry.boundingBox!.max.toArray()).toEqual([1, 0.5, 0]);
    const material = opaque.material as MeshBasicNodeMaterial;
    expect(material.type).toBe('MeshBasicNodeMaterial');
    expect([material.side, material.transparent, material.depthWrite, material.toneMapped, opaque.castShadow, opaque.receiveShadow]).toEqual([DoubleSide, false, true, false, false, false]);
    // The top-left vertex samples v = 0: the first image row with flipY false.
    const uv = opaque.geometry.getAttribute('uv'), position = opaque.geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), uv.getX(0), uv.getY(0)]).toEqual([-1, 0.5, 0, 0]);
    const blended = createScreenMesh({ texture, width: 1, height: 1, alpha: true }).root as Mesh;
    expect([(blended.material as MeshBasicNodeMaterial).transparent, (blended.material as MeshBasicNodeMaterial).depthWrite]).toEqual([true, false]);
    expect(blended.renderOrder).toBe(0);
});

// The renderer paths of R11 to R13, with a stand-in image load.
const settle = () => new Promise(r => setTimeout(r, 0));
let sequence = 0;
const placed = { visible: true, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] } };
const screen = (id: string, assetId: string | null): SceneEntity => ({ id, name: id, ...placed, kind: 'screen', content: { kind: 'image', assetId } });
function frame(entities: SceneEntity[]): RuntimeFrame {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...entities];
    f.scene.revision = sequence;
    return f;
}
const quads = () => { const found: Mesh[] = []; (ports.render.mock.lastCall![0] as Group).traverse(o => { if ((o as Mesh).isMesh) found.push(o as Mesh); }); return found; };
const image = (alpha = false) => ({ texture: new Texture(), width: 2, height: 1, alpha, dispose: vi.fn() });
beforeEach(() => { ports.load.mockReset(); ports.image.mockReset(); ports.render.mockReset().mockResolvedValue(undefined); ports.compile.mockReset().mockResolvedValue(undefined); });
const make = () => createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
it('draws one quad for each screen with one shared texture, and none for a screen without an image', async () => {
    const shared = image();
    ports.image.mockResolvedValue(shared);
    const r = await make();
    await r.applyFrame(frame([screen('a', 'image_x'), screen('b', 'image_x'), screen('empty', null)]));
    await settle();
    const applied = await r.applyFrame(frame([screen('a', 'image_x'), screen('b', 'image_x'), screen('empty', null)]));
    expect(ports.image).toHaveBeenCalledTimes(1);
    expect(ports.image.mock.lastCall![1]).toBe(QUALITY_PROFILES.production_v1.maxTextureSize);
    expect(ports.load).not.toHaveBeenCalled();
    expect(quads().map(q => (q.material as MeshBasicNodeMaterial).map)).toEqual([shared.texture, shared.texture]);
    expect(applied.warnings).toEqual([]);
    // When no screen uses the image, the texture and the bitmap go.
    await r.applyFrame(frame([screen('a', null)]));
    expect(shared.dispose).toHaveBeenCalledTimes(1);
    expect(quads()).toEqual([]);
    r.dispose();
});
it('draws nothing for a screen whose new image fails, also when an older image was drawn (R13)', async () => {
    ports.image.mockImplementation(async (_read: unknown) => image());
    const r = await make();
    await r.applyFrame(frame([screen('a', 'image_good')]));
    await settle();
    await r.applyFrame(frame([screen('a', 'image_good')]));
    expect(quads()).toHaveLength(1);
    ports.image.mockReset().mockImplementation(async () => { throw Object.assign(new Error(IMAGE_LOAD_FAILED), { code: 'INVALID_INPUT', ids: [] }); });
    await r.applyFrame(frame([screen('a', 'scene_room')]));
    await settle();
    const applied = await r.applyFrame(frame([screen('a', 'scene_room')]));
    expect(applied.warnings).toContainEqual({ code: 'UNAVAILABLE', message: 'Asset load failed: Image failed to load', ids: ['scene_room'] });
    expect(quads()).toEqual([]);
    r.dispose();
});
it('names a failed image in the frame warning and still draws the other screens', async () => {
    const r = await make();
    ports.image.mockImplementation(async () => { throw Object.assign(new Error(IMAGE_LOAD_FAILED), { code: 'INVALID_INPUT', ids: [] }); });
    await r.applyFrame(frame([screen('bad', 'scene_room')]));
    await settle();
    ports.image.mockReset().mockResolvedValue(image(true));
    const applied = await r.applyFrame(frame([screen('bad', 'scene_room'), screen('good', 'image_y')]));
    expect(applied.warnings).toContainEqual({ code: 'UNAVAILABLE', message: 'Asset load failed: Image failed to load', ids: ['scene_room'] });
    expect(ports.load).not.toHaveBeenCalled();
    await settle();
    await r.applyFrame(frame([screen('bad', 'scene_room'), screen('good', 'image_y')]));
    expect(quads()).toHaveLength(1);
    expect((quads()[0]!.material as MeshBasicNodeMaterial).transparent).toBe(true);
    r.dispose();
});
