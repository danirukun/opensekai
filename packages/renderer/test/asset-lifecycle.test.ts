import { it, expect, vi } from "vitest";
import { createAssetCache } from "../src/assets";
it("shares loads and releases once", async () => { const release = vi.fn(); const load = vi.fn(async () => ({ dispose: release })); const cache = createAssetCache(load); const [a, b] = await Promise.all([cache.get("x"), cache.get("x")]); expect(a).toBe(b); expect(load).toHaveBeenCalledTimes(1); cache.release("x"); cache.release("x"); cache.dispose(); expect(release).toHaveBeenCalledTimes(1); });
it("disposes cancelled load", async () => { let resolve!: (v: {
    dispose: () => void;
}) => void; const release = vi.fn(); const cache = createAssetCache(() => new Promise<{
    dispose: () => void;
}>(r => resolve = r)); const pending = cache.get("x"); cache.dispose(); resolve({ dispose: release }); await expect(pending).rejects.toMatchObject({ code: "CANCELLED" }); expect(release).toHaveBeenCalledTimes(1); });
it("reports missing asset and permits retry", async () => { const load = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue({ dispose: vi.fn() }); const cache = createAssetCache(load); await expect(cache.get("x")).rejects.toThrow("missing"); await cache.get("x"); expect(load).toHaveBeenCalledTimes(2); cache.dispose(); });

import { inspectContainer, disposeObject } from "../src/assets";
import { Group, Mesh, BoxGeometry, MeshStandardNodeMaterial, Texture } from "three/webgpu";
it("rejects external resource references before loading",()=>{const json=new TextEncoder().encode(JSON.stringify({asset:{version:"2.0"},images:[{uri:"https://example.invalid/image.png"}]}));const bytes=new ArrayBuffer(20+json.length);const view=new DataView(bytes);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,json.length,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20).set(json);expect(()=>inspectContainer(bytes)).toThrow("resources are not supported");});
it("disposes shared geometry material and texture once",()=>{const geometry=new BoxGeometry();const texture=new Texture();const material=new MeshStandardNodeMaterial({map:texture});const root=new Group();root.add(new Mesh(geometry,material),new Mesh(geometry,material));const a=vi.spyOn(geometry,"dispose"),b=vi.spyOn(material,"dispose"),c=vi.spyOn(texture,"dispose");disposeObject(root);expect(a).toHaveBeenCalledTimes(1);expect(b).toHaveBeenCalledTimes(1);expect(c).toHaveBeenCalledTimes(1);});

const rendererPorts = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), dispose: vi.fn(), setSize: vi.fn() }));
vi.mock("../src/backend", () => ({ initializeBackend: async (canvas: HTMLCanvasElement) => ({
    backend: "webgl2",
    renderer: { shadowMap: { enabled: false }, info: {memory: {geometries: 7, textures: 9}}, setSize: rendererPorts.setSize.mockImplementation((width: number, height: number) => {canvas.width = width; canvas.height = height;}), renderAsync: rendererPorts.render, compileAsync: vi.fn(async () => {}), dispose: rendererPorts.dispose }
}) }));
vi.mock("../src/assets", async importOriginal => ({
    ...await importOriginal<typeof import("../src/assets")>(),
    createAssetLoader: () => rendererPorts.load
}));
import { createRenderer } from "../src/renderer";
import { QUALITY_PROFILES, makeSmokeFrame } from "@opensekai/contracts";
it("releases an asset removed after failed render submission", async () => {
    const disposeAsset = vi.fn();
    rendererPorts.load.mockReset().mockImplementation(async () => ({ scene: new Group(), warnings: [], dispose: disposeAsset }));
    rendererPorts.render.mockReset().mockRejectedValueOnce(new Error("material compile failed")).mockResolvedValue(undefined);
    const renderer = await createRenderer({canvas: {} as HTMLCanvasElement, outputId: "output_main", mode: "force-webgl2", resources: {readAsset: vi.fn()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    const first = makeSmokeFrame({sequence: 1, tick: 1});
    first.scene.entities = first.scene.entities.filter(entity => entity.kind !== "mesh");
    await expect(renderer.applyFrame(first)).rejects.toMatchObject({code: "UNSUPPORTED"});
    await new Promise(r => setTimeout(r, 0));
    expect(rendererPorts.load).toHaveBeenCalledTimes(1);
    const removed = structuredClone(first);
    removed.sequence = 2;
    removed.tick = 2;
    removed.scene.entities = removed.scene.entities.filter(entity => entity.kind !== "avatar");
    await renderer.applyFrame(removed);
    expect(disposeAsset).toHaveBeenCalledTimes(1);
    renderer.dispose();
    expect(disposeAsset).toHaveBeenCalledTimes(1);
});

it("resizes only when physical canvas dimensions change", async () => {
    rendererPorts.setSize.mockClear();
    rendererPorts.render.mockReset().mockResolvedValue(undefined);
    const canvas = {width: 0, height: 0} as HTMLCanvasElement;
    const renderer = await createRenderer({canvas, outputId: "output_main", mode: "force-webgl2", resources: {readAsset: vi.fn()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    const frame = makeSmokeFrame({sequence: 1, tick: 1});
    frame.scene.entities = frame.scene.entities.filter(entity => entity.kind === "camera");
    await renderer.applyFrame(frame);
    expect(rendererPorts.setSize).toHaveBeenCalledExactlyOnceWith(1920, 1080, false);
    await renderer.applyFrame({...frame, sequence: 2, tick: 2});
    expect(rendererPorts.setSize).toHaveBeenCalledTimes(1);
    canvas.width = 960;
    canvas.height = 540;
    await renderer.applyFrame({...frame, sequence: 3, tick: 3});
    expect(rendererPorts.setSize).toHaveBeenCalledTimes(2);
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    renderer.dispose();
});


it("keeps one render camera while applying live lens and camera selections", async () => {
    rendererPorts.render.mockReset().mockResolvedValue(undefined);
    const renderer = await createRenderer({canvas: {width: 1920, height: 1080} as HTMLCanvasElement, outputId: "output_main", mode: "force-webgl2", resources: {readAsset: vi.fn()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    const frame = makeSmokeFrame({sequence: 1, tick: 1});
    frame.scene.entities = frame.scene.entities.filter(entity => entity.kind === "camera");
    await renderer.applyFrame(frame);
    const camera = rendererPorts.render.mock.calls[0]![1];
    const next = structuredClone(frame);
    next.sequence = 2;
    next.tick = 2;
    next.scene.outputs.find(output => output.id === "output_main")!.cameraId = "camera_close";
    const selected = next.scene.entities.find(entity => entity.id === "camera_close")!;
    if (selected.kind !== "camera") throw new Error("Camera fixture required");
    selected.lens.fovDegrees = 36;
    selected.lens.near = 0.2;
    selected.lens.far = 200;
    selected.transform.position = [2, 3, 4];
    const applied = await renderer.applyFrame(next);
    expect(rendererPorts.render.mock.calls[1]![1]).toBe(camera);
    expect(camera.fov).toBe(36);
    expect(camera.near).toBe(0.2);
    expect(camera.far).toBe(200);
    expect(camera.position.toArray()).toEqual([2, 3, 4]);
    expect(applied.cameraId).toBe("camera_close");
    renderer.dispose();
});
it('returns no diagnostics before display or when diagnostics are disabled',async()=>{
 const renderer=await createRenderer({canvas:{width:1920,height:1080} as HTMLCanvasElement,outputId:'output_main',mode:'force-webgl2',resources:{readAsset:vi.fn()},diagnostics:false,quality: QUALITY_PROFILES.production_v1});expect(renderer.diagnostics!('epoch')).toBeNull();renderer.dispose();expect(renderer.diagnostics!('epoch')).toBeNull();
});

it("reports renderer allocations with bounded queue/cache metadata after display",async()=>{
 rendererPorts.render.mockReset().mockResolvedValue(undefined);
 const renderer=await createRenderer({canvas:{width:1920,height:1080} as HTMLCanvasElement,outputId:"output_main",mode:"force-webgl2",resources:{readAsset:vi.fn()},diagnostics:true,quality: QUALITY_PROFILES.production_v1});
 expect(renderer.diagnostics!("epoch_1")).toBeNull();const frame=makeSmokeFrame({sequence:1,tick:1});frame.scene.entities=frame.scene.entities.filter(entity=>entity.kind==="camera");await renderer.applyFrame(frame);
 expect(renderer.diagnostics!("epoch_1")).toMatchObject({sessionId:frame.sessionId,outputId:"output_main",rendererEpoch:"epoch_1",sequence:1,revision:0,backend:"webgl2",geometries:7,textures:9,assetCacheEntries:0,queuedFrames:0,queuedCaptures:0});renderer.dispose();expect(renderer.diagnostics!("epoch_1")).toBeNull();
});
