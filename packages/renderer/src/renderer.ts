import { Scene, Mesh, BoxGeometry, MeshStandardNodeMaterial, PerspectiveCamera, AmbientLight, DirectionalLight } from "three/webgpu";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { Object3D } from "three/webgpu";
import type { RuntimeFrame, FrameApplied, CaptureBytes, Id, ResourceHost, AppError, SceneEntity } from "@opensekai/contracts";
import { RuntimeFrameSchema } from "@opensekai/contracts";
import { selectFrame, failure, createRenderQueue } from "./apply-frame";
import { createAssetCache, createAssetLoader, disposeObject } from "./assets";
import { initializeBackend } from "./backend";
import { createCapturePolicy, readPng } from "./capture";
import { createDiagnosticMarker } from "./diagnostic-marker";
export interface RendererHandle {
    applyFrame(frame: RuntimeFrame): Promise<FrameApplied>;
    capture(): Promise<CaptureBytes>;
    dispose(): void;
}
export interface RendererOptions {
    canvas: HTMLCanvasElement;
    outputId: Id;
    mode: "auto" | "force-webgl2";
    resources: ResourceHost;
    diagnostics: boolean;
    resolutionScale: 1 | 0.5;
}
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
    const { renderer, backend } = await initializeBackend(options.canvas, options.mode);
    const scene = new Scene();
    scene.background = null;
    scene.add(new AmbientLight(0xffffff, 1));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 3);
    scene.add(light);
    const assets = createAssetCache(createAssetLoader(options.resources));
    const marker = options.diagnostics ? createDiagnosticMarker() : null;
    const policy = createCapturePolicy();
    const objects = new Map<string, {
        signature: string;
        root: Object3D;
        owned: boolean;
        assetId?: string;
    }>();
    let disposed = false, cleaned = false, previous: RuntimeFrame | null = null, accepted: RuntimeFrame | null = null, displayed: FrameApplied | null = null, displayFrame: RuntimeFrame | null = null;
    const cleanup = () => { if (cleaned)
        return; cleaned = true; for (const value of objects.values()) {
        if (value.owned)
            disposeObject(value.root);
        else {
            disposeInstance(value.root);
            value.root.removeFromParent();
        }
    } objects.clear(); assets.dispose(); marker?.dispose(); scene.clear(); renderer.dispose(); };
    const queue = createRenderQueue(() => { if (disposed)
        cleanup(); });
    const submit = async (frame: RuntimeFrame): Promise<FrameApplied> => {
        const started = performance.now();
        const output = frame.scene.outputs.find(x => x.id === options.outputId);
        if (!output)
            throw failure("NOT_FOUND", "Output not found", [options.outputId]);
        const cameraEntity = frame.scene.entities.find(x => x.id === output.cameraId && x.kind === "camera");
        if (!cameraEntity || cameraEntity.kind !== "camera")
            throw failure("NOT_FOUND", "Output camera not found", [output.cameraId]);
        const width = output.width * options.resolutionScale, height = output.height * options.resolutionScale;
        renderer.setSize(width, height, false);
        const warnings: AppError[] = [];
        const wanted = new Set(frame.scene.entities.filter(x => x.kind !== "camera").map(x => x.id));
        for (const [id, value] of objects) {
            if (!wanted.has(id)) {
                if (value.owned)
                    disposeObject(value.root);
                else {
                    disposeInstance(value.root);
                    value.root.removeFromParent();
                }
                objects.delete(id);
            }
        }
        for (const entity of frame.scene.entities) {
            if (entity.kind === "camera")
                continue;
            const assetId = entity.kind === "avatar" ? entity.assetId : entity.source.kind === "asset" ? entity.source.assetId : undefined;
            const signature = assetId ?? "box";
            let value = objects.get(entity.id);
            if (value?.signature !== signature) {
                if (value) {
                    if (value.owned)
                        disposeObject(value.root);
                    else {
                        disposeInstance(value.root);
                        value.root.removeFromParent();
                    }
                    objects.delete(entity.id);
                }
                value = undefined;
            }
            if (!value) {
                try {
                    if (assetId) {
                        const asset = await assets.get(assetId);
                        if (disposed)
                            throw failure("CANCELLED", "Renderer disposed");
                        const instance = clone(asset.scene);
                        value = { signature, root: instance, owned: false, assetId };
                        warnings.push(...asset.warnings);
                    }
                    else
                        value = { signature, root: new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({ color: 0x55aacc })), owned: true };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                }
                catch (error) {
                    if (disposed)
                        throw error;
                    warnings.push({ code: "UNAVAILABLE", message: "Asset load failed: " + (error instanceof Error ? error.message : String(error)), ids: assetId ? [assetId] : [entity.id] });
                    continue;
                }
            }
            if (assetId) {
                const asset = await assets.get(assetId);
                for (const warning of asset.warnings)
                    if (!warnings.some(x => x.message === warning.message && x.ids[0] === assetId))
                        warnings.push(warning);
            }
            applyTransform(value.root, entity);
        }
        const used = new Set([...objects.values()].flatMap(x => x.assetId ? [x.assetId] : []));
        const priorAssets = new Set(previous?.scene.entities.flatMap(x => x.kind === "avatar" ? [x.assetId] : x.kind === "mesh" && x.source.kind === "asset" ? [x.source.assetId] : []) ?? []);
        for (const id of priorAssets)
            if (!used.has(id))
                assets.release(id);
        const camera = new PerspectiveCamera(cameraEntity.lens.fovDegrees, width / height, cameraEntity.lens.near, cameraEntity.lens.far);
        applyTransform(camera, cameraEntity);
        try {
            await renderer.renderAsync(scene, camera);
            if (marker) {
                marker.update(frame, cameraEntity.id, width, height);
                renderer.autoClear = false;
                try {
                    await renderer.renderAsync(marker.scene, marker.camera);
                }
                finally {
                    renderer.autoClear = true;
                }
            }
        }
        catch (error) {
            warnings.push({ code: "UNSUPPORTED", message: "Material/render submission failed: " + (error instanceof Error ? error.message : String(error)), ids: [] });
            throw Object.assign(failure("UNSUPPORTED", "Render submission failed"), { warnings });
        }
        if (disposed)
            throw failure("CANCELLED", "Renderer disposed");
        previous = frame;
        displayFrame = frame;
        displayed = { outputId: options.outputId, sessionId: frame.sessionId, sequence: frame.sequence, tick: frame.tick, revision: frame.scene.revision, cameraId: cameraEntity.id, backend, cpuMs: performance.now() - started, gpuMs: null, warnings };
        return structuredClone(displayed);
    };
    return { applyFrame(raw) { const frame = RuntimeFrameSchema.parse(raw); const selected = selectFrame(accepted, frame); if (!selected.ok)
            return Promise.reject(failure(selected.error.code, selected.error.message)); accepted = frame; return queue.enqueue("frame", () => submit(frame)); }, capture() { return queue.enqueue("capture", async () => { policy.reserve(performance.now()); if (!displayed || !displayFrame)
            throw failure("UNAVAILABLE", "No displayed frame"); const metadata = structuredClone(displayed); await submit(displayFrame); const png = await readPng(options.canvas); policy.checkBytes(png.byteLength); return { frame: metadata, png, width: options.canvas.width, height: options.canvas.height }; }); }, dispose() { if (disposed)
            return; disposed = true; queue.dispose(); } };
}
function applyTransform(object: Object3D, entity: SceneEntity) { object.position.fromArray(entity.transform.position); object.quaternion.fromArray(entity.transform.rotation); object.scale.fromArray(entity.transform.scale); object.visible = entity.visible; object.updateMatrixWorld(true); }
function disposeInstance(root: Object3D) { root.traverse(object => { const skeleton = (object as import("three/webgpu").SkinnedMesh).skeleton; if (skeleton)
    skeleton.dispose(); }); }
