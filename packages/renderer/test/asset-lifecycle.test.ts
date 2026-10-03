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

const rendererPorts = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), dispose: vi.fn() }));
vi.mock("../src/backend", () => ({ initializeBackend: async () => ({
    backend: "webgl2",
    renderer: { setSize: vi.fn(), renderAsync: rendererPorts.render, dispose: rendererPorts.dispose }
}) }));
vi.mock("../src/assets", async importOriginal => ({
    ...await importOriginal<typeof import("../src/assets")>(),
    createAssetLoader: () => rendererPorts.load
}));
import { createRenderer } from "../src/renderer";
import { makeSmokeFrame } from "@opensekai/contracts";
it("releases an asset removed after failed render submission", async () => {
    const disposeAsset = vi.fn();
    rendererPorts.load.mockReset().mockImplementation(async () => ({ scene: new Group(), warnings: [], dispose: disposeAsset }));
    rendererPorts.render.mockReset().mockRejectedValueOnce(new Error("material compile failed")).mockResolvedValue(undefined);
    const renderer = await createRenderer({canvas: {} as HTMLCanvasElement, outputId: "output_main", mode: "force-webgl2", resources: {readAsset: vi.fn()}, diagnostics: false, resolutionScale: 1});
    const first = makeSmokeFrame({sequence: 1, tick: 1});
    first.scene.entities = first.scene.entities.filter(entity => entity.kind !== "mesh");
    await expect(renderer.applyFrame(first)).rejects.toMatchObject({code: "UNSUPPORTED"});
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
