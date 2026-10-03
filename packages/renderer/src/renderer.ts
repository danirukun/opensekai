import { assertEditorScope, createEditorViewport } from './editor-viewport';
import type { EditorOptions, EditorHandle } from './editor-viewport';
import { Scene, Mesh, BoxGeometry, MeshStandardNodeMaterial, PerspectiveCamera, AmbientLight, DirectionalLight, Object3D } from "three/webgpu";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { RuntimeFrame, FrameApplied, RendererDiagnostics, CaptureBytes, Id, ResourceHost, AppError, SceneEntity } from "@opensekai/contracts";
import { RuntimeFrameSchema } from "@opensekai/contracts";
import { selectFrame, failure, createRenderQueue } from "./apply-frame";
import { createAssetCache, createAssetLoader, disposeObject } from "./assets";
import { createAvatarBinding } from "./avatar-pose";
import { countLiveMaterials } from "./diagnostics";
import { initializeBackend } from "./backend";
import { createCapturePolicy, readPng } from "./capture";
import { createDiagnosticMarker } from "./diagnostic-marker";
export interface RendererHandle {
    editor?: EditorHandle;
    applyFrame(frame: RuntimeFrame): Promise<FrameApplied>;
    capture(): Promise<CaptureBytes>;
    diagnostics?(rendererEpoch: string): RendererDiagnostics | null;
    dispose(): void;
}
export interface RendererOptions {
    editor?: EditorOptions;
    canvas: HTMLCanvasElement;
    outputId: Id;
    mode: "auto" | "force-webgl2";
    resources: ResourceHost;
    diagnostics: boolean;
    resolutionScale: 1 | 0.5;
}
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
    if (options.editor) assertEditorScope(options.outputId, options.diagnostics);
    const { renderer, backend } = await initializeBackend(options.canvas, options.mode);
    const camera = new PerspectiveCamera();
    const scene = new Scene();
    scene.background = null;
    scene.add(new AmbientLight(0xffffff, 1));
    const light = new DirectionalLight(0xffffff, 3);
    light.position.set(2, 4, 3);
    scene.add(light);
    const loadAsset = createAssetLoader(options.resources);
    const assets = createAssetCache(loadAsset);
    const marker = options.diagnostics ? createDiagnosticMarker() : null;
    const policy = createCapturePolicy();
    const objects = new Map<string, {
        signature: string;
        root: Object3D;
        owned: boolean;
        assetId?: string;
        avatar?: ReturnType<typeof createAvatarBinding>;
        assetDispose?: () => void;
        warnings?: AppError[];
    }>();
    const editor = options.editor ? createEditorViewport(options.canvas, camera, scene, objects, options.editor) : null;
    let disposed = false, cleaned = false, accepted: RuntimeFrame | null = null, displayed: FrameApplied | null = null, displayFrame: RuntimeFrame | null = null;
    const releaseObject = (value: {root: Object3D; owned: boolean; assetDispose?: () => void}) => {
        if (value.assetDispose) {value.root.removeFromParent(); value.assetDispose();}
        else if (value.owned) disposeObject(value.root);
        else {
            disposeInstance(value.root);
            value.root.removeFromParent();
        }
    };
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        editor?.dispose();
        for (const value of objects.values()) releaseObject(value);
        objects.clear();
        assets.dispose();
        marker?.dispose();
        scene.clear();
        renderer.dispose();
    };
    const queue = createRenderQueue(() => { if (disposed)
        cleanup(); });
    const submit = async (frame: RuntimeFrame): Promise<FrameApplied> => {
        editor?.frameRevision(frame.scene.revision);
        const started = performance.now();
        const output = frame.scene.outputs.find(x => x.id === options.outputId);
        if (!output)
            throw failure("NOT_FOUND", "Output not found", [options.outputId]);
        const cameraEntity = frame.scene.entities.find(x => x.id === output.cameraId && x.kind === "camera");
        if (!cameraEntity || cameraEntity.kind !== "camera")
            throw failure("NOT_FOUND", "Output camera not found", [output.cameraId]);
        const width = output.width * options.resolutionScale, height = output.height * options.resolutionScale;
        if (options.canvas.width !== width || options.canvas.height !== height)
            renderer.setSize(width, height, false);
        const warnings: AppError[] = [];
        const wanted = new Set(frame.scene.entities.filter(x => x.kind !== "tracking" && (editor || x.kind !== "camera")).map(x => x.id));
        for (const [id, value] of objects) {
            if (!wanted.has(id)) {
                releaseObject(value);
                objects.delete(id);
            }
        }
        for (const entity of frame.scene.entities) {
            if (entity.kind === "tracking") continue;
            if (entity.kind === "camera") {
                if (editor) {
                    let value = objects.get(entity.id);
                    if (!value) {
                        value = {signature: "camera", root: new Object3D(), owned: true};
                        objects.set(entity.id, value);
                        scene.add(value.root);
                    }
                    if (!editor.frozen(entity.id)) applyTransform(value.root, entity);
                }
                continue;
            }
            const assetId = entity.kind === "avatar" ? entity.assetId : entity.source.kind === "asset" ? entity.source.assetId : undefined;
            const signature = entity.kind + ":" + (assetId ?? "box");
            let value = objects.get(entity.id);
            if (value?.signature !== signature) {
                if (value) {
                    releaseObject(value);
                    objects.delete(entity.id);
                }
                value = undefined;
            }
            if (!value) {
                try {
                    if (assetId) {
                        const asset = entity.kind === "avatar" ? await loadAsset(assetId) : await assets.get(assetId);
                        if (disposed) {if (entity.kind === "avatar") asset.dispose();}
                        if (disposed)
                            throw failure("CANCELLED", "Renderer disposed");
                        if (entity.kind === "avatar") {
                            if (!asset.vrm) {asset.dispose(); throw failure("INVALID_INPUT", "Avatar asset has no VRM");}
                            const avatar = createAvatarBinding(asset.vrm);
                            value = {signature, root: avatar.root, owned: false, avatar, assetDispose: asset.dispose, warnings: asset.warnings};
                        } else {
                            value = { signature, root: clone(asset.scene), owned: false, assetId, warnings: asset.warnings };
                        }
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
            for (const warning of value.warnings ?? [])
                if (!warnings.some(x => x.message === warning.message && x.ids[0] === warning.ids[0])) warnings.push(warning);
            value.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entity.id));
            if (!editor?.frozen(entity.id)) applyTransform(value.root, entity);
        }
        editor?.refresh();
        const used = new Set([...objects.values()].flatMap(x => x.assetId ? [x.assetId] : []));
        assets.retainOnly(used);
        camera.fov = cameraEntity.lens.fovDegrees;
        camera.aspect = width / height;
        camera.near = cameraEntity.lens.near;
        camera.far = cameraEntity.lens.far;
        camera.updateProjectionMatrix();
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
        displayFrame = frame;
        displayed = { outputId: options.outputId, sessionId: frame.sessionId, sequence: frame.sequence, tick: frame.tick, revision: frame.scene.revision, cameraId: cameraEntity.id, backend, cpuMs: performance.now() - started, gpuMs: null, warnings };
        return structuredClone(displayed);
    };
    return { ...(editor ? { editor: { sync: editor.sync, cancel: editor.cancel } } : {}), diagnostics(rendererEpoch) {
        if (!options.diagnostics || !displayed || disposed) return null;
        return {sessionId: displayed.sessionId, outputId: displayed.outputId, rendererEpoch, sequence: displayed.sequence, revision: displayed.revision, backend, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, liveMaterials: countLiveMaterials(marker ? [scene,marker.scene] : [scene]), assetCacheEntries: assets.size(), ...queue.snapshot()};
    }, applyFrame(raw) { const frame = RuntimeFrameSchema.parse(raw); const selected = selectFrame(accepted, frame); if (!selected.ok)
            return Promise.reject(failure(selected.error.code, selected.error.message)); accepted = frame; return queue.enqueue("frame", () => submit(frame)); }, capture() { return queue.enqueue("capture", async () => { policy.reserve(performance.now()); if (!displayed || !displayFrame)
            throw failure("UNAVAILABLE", "No displayed frame"); const metadata = structuredClone(displayed); await submit(displayFrame); const png = await readPng(options.canvas); policy.checkBytes(png.byteLength); return { frame: metadata, png, width: options.canvas.width, height: options.canvas.height }; }); }, dispose() { if (disposed)
            return; disposed = true; editor?.dispose(); queue.dispose(); } };
}
function applyTransform(object: Object3D, entity: SceneEntity) { object.position.fromArray(entity.transform.position); object.quaternion.fromArray(entity.transform.rotation); object.scale.fromArray(entity.transform.scale); object.visible = entity.visible; object.updateMatrixWorld(true); }
function disposeInstance(root: Object3D) { root.traverse(object => { const skeleton = (object as import("three/webgpu").SkinnedMesh).skeleton; if (skeleton)
    skeleton.dispose(); }); }
