import { afterEach, expect, it, vi } from 'vitest';
import { Texture } from 'three/webgpu';
import { createTexturePool } from '../src/texture-sharing';

function decoded() {
    const image = { close: vi.fn() };
    const texture = new Texture(image as unknown as ImageBitmap);
    const dispose = vi.spyOn(texture, 'dispose');
    return { image, texture, dispose };
}

it('shares an in-flight decode while texture wrappers remain independent', async () => {
    const pool = createTexturePool();
    const first = pool.acquire('asset'), second = pool.acquire('asset');
    let resolve!: (texture: Texture) => void;
    const load = vi.fn(() => new Promise<Texture>(r => { resolve = r; }));
    const a = first.load(0, load), b = second.load(0, load);
    const value = decoded();
    await Promise.resolve();
    resolve(value.texture);
    const [ta, tb] = await Promise.all([a, b]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(ta).not.toBe(tb);
    expect(ta.source).toBe(tb.source);
    ta.offset.x = 0.5;
    expect(tb.offset.x).toBe(0);
    first.release();
    expect(value.image.close).not.toHaveBeenCalled();
    second.release();
    second.release();
    expect(value.image.close).toHaveBeenCalledTimes(1);
    expect(value.dispose).toHaveBeenCalledTimes(1);
    expect(pool.size()).toBe(0);
});

it('reuses a completed decode until the final lease releases and then reloads', async () => {
    const pool = createTexturePool(), value = decoded();
    const load = vi.fn(async () => value.texture);
    const first = pool.acquire('asset');
    await first.load(0, load);
    const second = pool.acquire('asset');
    await second.load(0, load);
    expect(load).toHaveBeenCalledTimes(1);
    first.release(); second.release();
    const next = pool.acquire('asset');
    await next.load(0, load);
    expect(load).toHaveBeenCalledTimes(2);
    next.release();
});

it('releases late decoded resources after cancellation', async () => {
    const pool = createTexturePool(), lease = pool.acquire('asset'), value = decoded();
    let resolve!: (texture: Texture) => void;
    const pending = lease.load(0, () => new Promise<Texture>(r => {resolve = r;}));
    await Promise.resolve();
    lease.release();
    resolve(value.texture);
    await expect(pending).rejects.toMatchObject({code:'CANCELLED'});
    expect(value.image.close).toHaveBeenCalledTimes(1);
    expect(pool.size()).toBe(0);
});

it('removes failed promises for retry and separates assets and image indices', async () => {
    const pool = createTexturePool(), lease = pool.acquire('asset');
    const load = vi.fn().mockRejectedValueOnce(new Error('decode failed')).mockImplementation(async () => decoded().texture);
    await expect(lease.load(0, load)).rejects.toThrow('decode failed');
    await lease.load(0, load); await lease.load(1, load);
    const other = pool.acquire('other'); await other.load(0, load);
    expect(load).toHaveBeenCalledTimes(4);
    lease.release(); other.release();
    expect(pool.size()).toBe(0);
});

import { createAssetLoader } from '../src/assets';
import type { Mesh, MeshStandardMaterial } from 'three/webgpu';
afterEach(() => vi.unstubAllGlobals());

function texturedGlb() {
    const json = {
        asset: {version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
        meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],
        accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]}],
        buffers:[{byteLength:40}], bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:4}],
        images:[{bufferView:1,mimeType:'image/png'}], textures:[{source:0}],
        materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const bytes = new ArrayBuffer(20 + jsonLength + 8 + 40), view = new DataView(bytes);
    view.setUint32(0,0x46546c67,true); view.setUint32(4,2,true); view.setUint32(8,bytes.byteLength,true);
    view.setUint32(12,jsonLength,true); view.setUint32(16,0x4e4f534a,true);
    new Uint8Array(bytes,20,jsonLength).fill(32); new Uint8Array(bytes,20,text.length).set(text);
    view.setUint32(20+jsonLength,40,true); view.setUint32(24+jsonLength,0x004e4942,true);
    new Float32Array(bytes,28+jsonLength,9).set([0,0,0,1,0,0,0,1,0]);
    return bytes;
}

it('real GLTF parsers decode once and retain independent material state until final removal', async () => {
    class Bitmap { width=1; height=1; close=vi.fn(); }
    const bitmap = new Bitmap();
    const decode = vi.fn(async () => bitmap);
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('ImageBitmap', Bitmap);
    vi.stubGlobal('createImageBitmap', decode);
    const bytes = texturedGlb();
    const load = createAssetLoader({readAsset: async () => bytes});
    const [first, second] = await Promise.all([load('same'),load('same')]);
    const a = (first.scene.children[0] as Mesh).material as MeshStandardMaterial;
    const b = (second.scene.children[0] as Mesh).material as MeshStandardMaterial;
    expect(decode).toHaveBeenCalledTimes(1);
    expect(a).not.toBe(b);
    expect(a.map).not.toBe(b.map);
    expect(a.map!.source).toBe(b.map!.source);
    a.opacity = 0.2;
    expect(b.opacity).toBe(1);
    const secondDispose = vi.spyOn(b.map!, 'dispose');
    first.dispose();
    expect(bitmap.close).not.toHaveBeenCalled();
    expect(secondDispose).not.toHaveBeenCalled();
    expect(b.map!.image).toBe(bitmap);
    second.dispose();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
    const third = await load('same');
    expect(decode).toHaveBeenCalledTimes(2);
    third.dispose();
});

it('cancelled owner does not close a pending decode needed by another instance', async () => {
    const pool = createTexturePool(), first = pool.acquire('asset'), second = pool.acquire('asset');
    const value = decoded();
    let resolve!: (texture: Texture) => void;
    const a = first.load(0, () => new Promise<Texture>(r => { resolve=r; }));
    const b = second.load(0, () => { throw new Error('must share decode'); });
    await Promise.resolve(); first.release(); resolve(value.texture);
    await expect(a).rejects.toMatchObject({code:'CANCELLED'});
    const survivor = await b;
    expect(survivor.image).toBe(value.image);
    expect(value.image.close).not.toHaveBeenCalled();
    second.release();
    expect(value.image.close).toHaveBeenCalledTimes(1);
});

it('caps a real GLTF embedded image before sharing and rejects resize failure without a blank asset', async () => {
    class Bitmap { close=vi.fn(); width:number; height:number; constructor(width:number, height:number) {this.width=width;this.height=height;} }
    const original = new Bitmap(8192,4096), resized = new Bitmap(1024,512);
    const decode = vi.fn(async (_source: unknown, options?: ImageBitmapOptions) => options?.resizeWidth ? resized : original);
    vi.stubGlobal('self',globalThis);vi.stubGlobal('ImageBitmap',Bitmap);vi.stubGlobal('createImageBitmap',decode);
    const load = createAssetLoader({readAsset:async()=>texturedGlb()},{maxTextureSize:1024});
    const [first,second]=await Promise.all([load('same'),load('same')]);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(original.close).toHaveBeenCalledTimes(1);
    const material=(first.scene.children[0] as Mesh).material as MeshStandardMaterial;
    expect(material.map!.image).toBe(resized);
    first.dispose();expect(resized.close).not.toHaveBeenCalled();second.dispose();expect(resized.close).toHaveBeenCalledTimes(1);
    const failingOriginal=new Bitmap(8192,4096);
    decode.mockImplementation(async (_source, options)=>{if(options?.resizeWidth)throw new Error('resize failed');return failingOriginal;});
    await expect(load('same')).rejects.toMatchObject({code:'UNSUPPORTED'});
    expect(failingOriginal.close).toHaveBeenCalledTimes(1);
});
