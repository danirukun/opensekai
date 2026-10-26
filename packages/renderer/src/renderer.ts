import { assertEditorScope, createEditorViewport, createHazeHelper, createLightHelper, updateHazeHelper, updateLightHelper } from './editor-viewport';
import type { EditorOptions, EditorHandle } from './editor-viewport';
import { Scene, Mesh, BoxGeometry, MeshStandardNodeMaterial, PerspectiveCamera, Object3D } from "three/webgpu";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import type { RuntimeFrame, FrameApplied, RendererDiagnostics, CaptureBytes, Id, ResourceHost, AppError, SceneEntity, QualityProfile, ScreenshotBytes } from "@opensekai/contracts";
import { LIMITS, RuntimeFrameSchema } from "@opensekai/contracts";
import { selectFrame, failure, createRenderQueue } from "./apply-frame";
import { createAssetCache, createAssetLoader, disposeObject } from "./assets";
import { createAvatarBinding } from "./avatar-pose";
import { countLiveMaterials } from "./diagnostics";
import { initializeBackend } from "./backend";
import { createCapturePolicy, readPng } from "./capture";
import { createLoadJobs, type AssetLoadStatus, type LoadReport, type LoadRequest } from "./load-jobs";
import { createEnvironmentLight, roomEnvironmentMap, type InstanceMaterials } from "./environment-light";
import { createSceneLights, groupOf, roomLight, withDrafts, type LightGroup } from "./scene-lights";
import { logPipelineFailure, watchPipelineErrors, type PipelineDevice } from "./pipeline-diagnostics";
import { freshModulePerPipeline, isWebKit } from "./webkit-shader-modules";
import { createDiagnosticMarker } from "./diagnostic-marker";
import { createPostChain } from "./post-chain";
import { createHaze, type Haze } from "./haze";
import { renderScreenshot, SCREENSHOT_HEIGHT, SCREENSHOT_WIDTH } from "./screenshot";
export interface RendererHandle {
    editor?: EditorHandle;
    applyFrame(frame: RuntimeFrame): Promise<FrameApplied>;
    capture(): Promise<CaptureBytes>;
    /** One 1920 × 1080 transparent PNG of `cameraId` after a frame with `expectedRevision` is displayed. The frame loop continues. */
    screenshot(cameraId: Id, expectedRevision: number): Promise<ScreenshotBytes>;
    diagnostics?(rendererEpoch: string): RendererDiagnostics | null;
    onLoadStatus(listener: (entries: AssetLoadStatus[]) => void): () => void;
    dismissLoad(entityId: string): void;
    dispose(): void;
}
export interface RendererOptions {
    editor?: EditorOptions;
    canvas: HTMLCanvasElement;
    outputId: Id;
    mode: "auto" | "force-webgl2";
    resources: ResourceHost;
    diagnostics: boolean;
    quality: QualityProfile;
}
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
    if (options.editor) assertEditorScope(options.outputId, options.diagnostics);
    const { quality } = options;
    const { renderer, backend } = await initializeBackend(options.canvas, options.mode, quality.msaaSamples);
    const camera = new PerspectiveCamera();
    const scene = new Scene();
    scene.background = null;
    const sceneLights = createSceneLights(scene, renderer);
    // A failed pipeline compile is logged with its WGSL and named in frame warnings until the next light-set rebuild.
    let pipelineFailed = false;
    const device = backend === "webgpu" ? (renderer.backend as unknown as { device?: PipelineDevice }).device : undefined;
    const unwatchPipelines = device ? watchPipelineErrors(device, (failure, first) => { pipelineFailed = true; if (first) logPipelineFailure(failure); }) : null;
    // After the watch, so that each new module still has its WGSL for the failure log (R9b).
    const restoreModules = device && isWebKit(navigator.userAgent) ? freshModulePerPipeline(device) : null;
    const loadAsset = createAssetLoader(options.resources, {maxTextureSize: quality.maxTextureSize});
    const postChain = createPostChain(renderer);
    // The haze volume (B13 R7). A pipeline failure while it draws stops it until the next node-set rebuild (R9).
    let haze: Haze | null = null, hazeFailed = false;
    const assets = createAssetCache(loadAsset);
    const environmentLight = createEnvironmentLight(roomEnvironmentMap(renderer));
    type Ready = { root: Object3D; avatar?: ReturnType<typeof createAvatarBinding>; assetId?: string; assetDispose?: () => void; instanceDispose?: () => void; materials?: InstanceMaterials; lit: number; warnings: AppError[]; dispose(): void };
    const loadListeners = new Set<(entries: AssetLoadStatus[]) => void>();
    const prepare = async (root: Object3D, report: (r: LoadReport) => void, cancelled: () => boolean) => {
        if (cancelled() || disposed) throw failure("CANCELLED", "Asset load cancelled");
        report({ stage: "prepare", progress: null });
        const culled: Object3D[] = [];
        root.traverse(object => { if (object.frustumCulled) { culled.push(object); object.frustumCulled = false; } });
        try { await renderer.compileAsync(root, camera, scene); }
        finally { for (const object of culled) object.frustumCulled = true; }
    };
    const build = async (request: LoadRequest, report: (r: LoadReport) => void, cancelled: () => boolean): Promise<Ready> => {
        if (request.kind === "avatar") {
            const asset = await loadAsset(request.assetId, report);
            try {
                if (!asset.vrm) throw failure("INVALID_INPUT", "Avatar asset has no VRM");
                const avatar = createAvatarBinding(asset.vrm);
                // The group node set goes on before GPU preparation, so the compiled pipelines are the ones the frame draws (R6).
                sceneLights.assign(avatar.root, "characters");
                const lit = sceneLights.generation();
                await prepare(avatar.root, report, cancelled);
                return { root: avatar.root, avatar, assetDispose: asset.dispose, lit, warnings: asset.warnings, dispose: asset.dispose };
            } catch (error) { asset.dispose(); throw error; }
        }
        const asset = await assets.get(request.assetId);
        if (cancelled() || disposed) throw failure("CANCELLED", "Asset load cancelled");
        const root = clone(asset.scene);
        const materials = environmentLight.apply(root, request.kind === "environment");
        const release = () => { disposeInstance(root); materials.dispose(); };
        sceneLights.assign(root, request.kind === "environment" ? "environment" : "props");
        const lit = sceneLights.generation();
        try { await prepare(root, report, cancelled); }
        catch (error) { release(); throw error; }
        return { root, assetId: request.assetId, warnings: asset.warnings, instanceDispose: materials.dispose, materials, lit, dispose: release };
    };
    const jobs = createLoadJobs<Ready>(build, entries => { for (const listener of loadListeners) listener(entries); });
    const marker = options.diagnostics ? createDiagnosticMarker() : null;
    const policy = createCapturePolicy();
    const objects = new Map<string, {
        signature: string;
        root: Object3D;
        owned: boolean;
        assetId?: string;
        pickable?: boolean;
        avatar?: ReturnType<typeof createAvatarBinding>;
        assetDispose?: () => void;
        instanceDispose?: () => void;
        materials?: InstanceMaterials;
        group?: LightGroup;
        lit?: number;
        warnings?: AppError[];
    }>();
    const editor = options.editor ? createEditorViewport(options.canvas, camera, scene, objects, options.editor) : null;
    let disposed = false, cleaned = false, accepted: RuntimeFrame | null = null, displayed: FrameApplied | null = null, displayFrame: RuntimeFrame | null = null;
    const releaseObject = (value: {root: Object3D; owned: boolean; assetDispose?: () => void; instanceDispose?: () => void}) => {
        value.instanceDispose?.();
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
        jobs.dispose();
        assets.dispose();
        environmentLight.dispose();
        sceneLights.dispose();
        restoreModules?.();
        unwatchPipelines?.();
        postChain.dispose();
        haze?.dispose();
        marker?.dispose();
        scene.clear();
        renderer.dispose();
    };
    const queue = createRenderQueue(() => { if (disposed)
        cleanup(); });
    const submit = async (frame: RuntimeFrame): Promise<FrameApplied> => {
        editor?.frame(frame.scene);
        const started = performance.now();
        const output = frame.scene.outputs.find(x => x.id === options.outputId);
        if (!output)
            throw failure("NOT_FOUND", "Output not found", [options.outputId]);
        const cameraEntity = frame.scene.entities.find(x => x.id === output.cameraId && x.kind === "camera");
        if (!cameraEntity || cameraEntity.kind !== "camera")
            throw failure("NOT_FOUND", "Output camera not found", [output.cameraId]);
        const showEnvironment = cameraEntity.renderEnvironment !== false;
        const place = (root: Object3D, entity: SceneEntity) => { applyTransform(root, entity); if (entity.kind === "environment" && !showEnvironment) root.visible = false; };
        const width = output.width * quality.resolutionScale, height = output.height * quality.resolutionScale;
        if (options.canvas.width !== width || options.canvas.height !== height)
            renderer.setSize(width, height, false);
        const warnings: AppError[] = [];
        // A dragged light or haze follows the gizmo on each frame, between the throttled commits (B12 R7).
        const drawn = editor ? withDrafts(frame.scene.entities, id => editor.draftTransform(id)) : frame.scene.entities;
        const lightsRebuilt = sceneLights.apply(drawn);
        if (lightsRebuilt) { pipelineFailed = false; hazeFailed = false; }
        environmentLight.room(roomLight(drawn));
        // Cameras, lights, and the haze have a scene object only in the editor viewport, as a pick target and helper (R14, B13 R13).
        // An FPS counter is a DOM overlay and a VMC sender sends UDP; neither has a scene object (B19 R7, B21).
        const wanted = new Set(frame.scene.entities.filter(x => x.kind !== "tracking" && x.kind !== "fpsCounter" && x.kind !== "vmcSender" && (editor || (x.kind !== "camera" && x.kind !== "light" && x.kind !== "haze"))).map(x => x.id));
        for (const [id, value] of objects) {
            if (!wanted.has(id)) {
                releaseObject(value);
                objects.delete(id);
            }
        }
        const needed = new Map<string, LoadRequest>();
        for (const entity of frame.scene.entities) {
            if (entity.kind === "tracking" || entity.kind === "fpsCounter" || entity.kind === "vmcSender") continue;
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
            if (entity.kind === "light") {
                if (editor) {
                    let value = objects.get(entity.id);
                    const signature = "light:" + entity.light.type;
                    if (value?.signature !== signature) {
                        if (value) releaseObject(value);
                        value = { signature, root: createLightHelper(entity.light), owned: true };
                        objects.set(entity.id, value);
                        scene.add(value.root);
                    }
                    updateLightHelper(value.root, entity.light);
                    if (!editor.frozen(entity.id)) applyTransform(value.root, entity);
                }
                continue;
            }
            if (entity.kind === "haze") {
                if (editor) {
                    let value = objects.get(entity.id);
                    if (!value) {
                        value = { signature: "haze", root: createHazeHelper(), owned: true };
                        objects.set(entity.id, value);
                        scene.add(value.root);
                    }
                    if (!editor.frozen(entity.id)) applyTransform(value.root, entity);
                    updateHazeHelper(value.root);
                }
                continue;
            }
            const assetId = entity.kind === "avatar" || entity.kind === "environment" ? entity.assetId : entity.source.kind === "asset" ? entity.source.assetId : null;
            let value = objects.get(entity.id);
            if ((entity.kind === "avatar" || entity.kind === "environment") && assetId === null) {
                if (value) { releaseObject(value); objects.delete(entity.id); }
                continue;
            }
            const signature = entity.kind + ":" + (assetId ?? "box");
            if (value?.signature !== signature) {
                if (assetId === null) {
                    if (value) releaseObject(value);
                    value = { signature, root: new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({ color: 0x55aacc })), owned: true, group: "props" };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                } else {
                    // The new model is still loading: keep posing the old model, if any, until the job installs the new one.
                    needed.set(entity.id, { kind: entity.kind === "avatar" ? "avatar" : entity.kind === "environment" ? "environment" : "mesh", assetId });
                    if (!value) continue;
                }
            }
            for (const warning of value.warnings ?? [])
                if (!warnings.some(x => x.message === warning.message && x.ids[0] === warning.ids[0])) warnings.push(warning);
            value.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entity.id));
            if (entity.kind === "environment") value.materials?.reflections(entity.reflectionsIntensity ?? 1);
            if (!editor?.frozen(entity.id)) place(value.root, entity);
        }
        jobs.reconcile(needed, frame.scene.revision);
        for (const [entityId, request] of needed) {
            const ready = jobs.take(entityId);
            if (!ready) continue;
            const entity = frame.scene.entities.find(item => item.id === entityId)!;
            const old = objects.get(entityId);
            if (old) releaseObject(old);
            const installed = { signature: entity.kind + ":" + request.assetId, root: ready.root, owned: false, avatar: ready.avatar, assetId: ready.assetId, assetDispose: ready.assetDispose, instanceDispose: ready.instanceDispose, materials: ready.materials, group: groupOf(entity) ?? undefined, lit: ready.lit, warnings: ready.warnings, pickable: entity.kind !== "environment" };
            scene.add(installed.root);
            objects.set(entityId, installed);
            installed.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entityId));
            if (entity.kind === "environment") installed.materials?.reflections(entity.reflectionsIntensity ?? 1);
            if (!editor?.frozen(entityId)) place(installed.root, entity);
            warnings.push(...ready.warnings);
        }
        for (const [entityId, request] of needed) {
            const message = jobs.failure(entityId);
            if (message) warnings.push({ code: "UNAVAILABLE", message: "Asset load failed: " + message, ids: [request.assetId] });
        }
        for (const entry of jobs.status()) if (entry.stage !== "failed") warnings.push({ code: "BUSY", message: "Asset loading", ids: [entry.assetId] });
        if (pipelineFailed) warnings.push({ code: "UNSUPPORTED", message: "Pipeline compile failed", ids: [] });
        const hazeEntity = drawn.find(x => x.kind === "haze");
        if (hazeEntity?.kind === "haze") {
            if (!haze) { haze = createHaze(); scene.add(haze.mesh); }
            haze.update(hazeEntity, frame.elapsedMs / 1000);
            haze.setLights(sceneLights.node("haze"));
        } else if (haze) { haze.dispose(); haze = null; }
        const hazeDrawn = haze && hazeEntity?.visible && !hazeFailed ? haze : null;
        // A change of the light set gives each lit material its new group node set (R6, R7).
        const generation = sceneLights.generation();
        for (const value of objects.values()) if (value.group && value.lit !== generation) { sceneLights.assign(value.root, value.group); value.lit = generation; }
        editor?.refresh();
        const used = new Set([...objects.values()].flatMap(x => x.assetId ? [x.assetId] : []));
        for (const id of jobs.assetIds()) used.add(id);
        assets.retainOnly(used);
        camera.fov = cameraEntity.lens.fovDegrees;
        camera.aspect = width / height;
        camera.near = cameraEntity.lens.near;
        camera.far = cameraEntity.lens.far;
        camera.updateProjectionMatrix();
        const navigated = editor?.cameraTransform(cameraEntity.id);
        applyTransform(camera, navigated ? { ...cameraEntity, transform: navigated } : cameraEntity);
        try {
            // three.js 0.180: on WebGPU a shadow first set up during a draw stays empty, so compile first; on WebGL 2 this compile leaves the shadow empty.
            if (lightsRebuilt && sceneLights.shadows() && backend === "webgpu") await renderer.compileAsync(scene, camera);
            await postChain.render(scene, camera, cameraEntity.antiAliasing, hazeDrawn);
            if (hazeDrawn && pipelineFailed) hazeFailed = true;
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
        displayed = { outputId: options.outputId, sessionId: frame.sessionId, sequence: frame.sequence, tick: frame.tick, revision: frame.scene.revision, cameraId: cameraEntity.id, backend, cpuMs: performance.now() - started, gpuMs: null, warnings, qualityProfile: quality.id };
        for (const waiter of [...revisionWaiters]) waiter.check(frame.scene.revision);
        return structuredClone(displayed);
    };
    type RevisionWaiter = { check(revision: number): void; cancel(): void };
    const revisionWaiters = new Set<RevisionWaiter>();
    // Resolves when a frame with `revision` is displayed; a newer revision is a conflict.
    const displayedRevision = (revision: number) => new Promise<void>((resolve, reject) => {
        if (displayed?.revision === revision) { resolve(); return; }
        if (displayed && displayed.revision > revision) { reject(failure("CONFLICT", "Displayed revision changed")); return; }
        const timer = setTimeout(() => settle(() => reject(failure("TIMEOUT", "Revision not displayed"))), LIMITS.screenshotTimeoutMs);
        const settle = (done: () => void) => { clearTimeout(timer); revisionWaiters.delete(waiter); done(); };
        const waiter: RevisionWaiter = {
            check(current) { if (current === revision) settle(resolve); else if (current > revision) settle(() => reject(failure("CONFLICT", "Displayed revision changed"))); },
            cancel() { settle(() => reject(failure("CANCELLED", "Renderer disposed"))); }
        };
        revisionWaiters.add(waiter);
    });
    const screenshot = async (cameraId: Id, expectedRevision: number): Promise<ScreenshotBytes> => {
        await displayedRevision(expectedRevision);
        return queue.enqueue("capture", async () => {
            const frame = displayFrame;
            if (!frame || frame.scene.revision !== expectedRevision) throw failure("CONFLICT", "Displayed revision changed");
            const entity = frame.scene.entities.find(x => x.id === cameraId && x.kind === "camera");
            if (!entity || entity.kind !== "camera") throw failure("NOT_FOUND", "Camera not found", [cameraId]);
            const shotCamera = new PerspectiveCamera(entity.lens.fovDegrees, SCREENSHOT_WIDTH / SCREENSHOT_HEIGHT, entity.lens.near, entity.lens.far);
            applyTransform(shotCamera, entity);
            // Visibility comes from the frame; cameras and editor helpers are not drawn. A root that a gizmo drag holds keeps its draft pose.
            const show = new Map<Object3D, boolean>();
            for (const [id, value] of objects) {
                const source = frame.scene.entities.find(x => x.id === id);
                show.set(value.root, !!source && source.kind !== "camera" && source.kind !== "light" && source.kind !== "haze" && source.kind !== "fpsCounter" && source.kind !== "vmcSender" && source.visible && (source.kind !== "environment" || entity.renderEnvironment !== false));
            }
            // The haze draws in the screenshot as in the output (B13 R10).
            const shotHaze = haze && !hazeFailed && frame.scene.entities.some(x => x.kind === "haze" && x.visible) ? haze : null;
            const png = await renderScreenshot({ renderer, backend, scene, camera: shotCamera, show, antiAliasing: entity.antiAliasing ?? "none", msaaSamples: quality.msaaSamples, haze: shotHaze });
            if (disposed) throw failure("CANCELLED", "Renderer disposed");
            if (png.byteLength > LIMITS.screenshotPngBytes) throw failure("INVALID_INPUT", "Screenshot PNG exceeds 8 MiB");
            return { sessionId: frame.sessionId, revision: expectedRevision, cameraId, width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT, png };
        });
    };
    return { screenshot, ...(editor ? { editor: { sync: editor.sync, cancel: editor.cancel } } : {}), diagnostics(rendererEpoch) {
        if (!options.diagnostics || !displayed || disposed) return null;
        return {sessionId: displayed.sessionId, outputId: displayed.outputId, rendererEpoch, sequence: displayed.sequence, revision: displayed.revision, backend, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, liveMaterials: countLiveMaterials(marker ? [scene,marker.scene] : [scene]), assetCacheEntries: assets.size(), ...queue.snapshot()};
    },
    onLoadStatus(listener) { loadListeners.add(listener); listener(jobs.status()); return () => { loadListeners.delete(listener); }; },
    dismissLoad(entityId) { jobs.dismiss(entityId); },
    applyFrame(raw) { const frame = RuntimeFrameSchema.parse(raw); const selected = selectFrame(accepted, frame); if (!selected.ok)
            return Promise.reject(failure(selected.error.code, selected.error.message)); accepted = frame; return queue.enqueue("frame", () => submit(frame)); }, capture() { return queue.enqueue("capture", async () => { policy.reserve(performance.now()); if (!displayed || !displayFrame)
            throw failure("UNAVAILABLE", "No displayed frame"); const metadata = structuredClone(displayed); await submit(displayFrame); const png = await readPng(options.canvas); policy.checkBytes(png.byteLength); return { frame: metadata, png, width: options.canvas.width, height: options.canvas.height }; }); }, dispose() { if (disposed)
            return; disposed = true; for (const waiter of [...revisionWaiters]) waiter.cancel(); editor?.dispose(); queue.dispose(); } };
}
function applyTransform(object: Object3D, entity: SceneEntity) { object.position.fromArray(entity.transform.position); object.quaternion.fromArray(entity.transform.rotation); object.scale.fromArray(entity.transform.scale); object.visible = entity.visible; object.updateMatrixWorld(true); }
function disposeInstance(root: Object3D) { root.traverse(object => { const skeleton = (object as import("three/webgpu").SkinnedMesh).skeleton; if (skeleton)
    skeleton.dispose(); }); }
