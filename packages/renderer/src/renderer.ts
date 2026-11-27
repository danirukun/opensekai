import { assertEditorScope, createEditorViewport, createHazeHelper, createLightHelper, updateHazeHelper, updateLightHelper } from './editor-viewport';
import type { EditorOptions, EditorHandle } from './editor-viewport';
import { Scene, Mesh, BoxGeometry, MeshStandardNodeMaterial, PerspectiveCamera, Object3D, Box3, Matrix4, Sphere, DataTexture, EquirectangularReflectionMapping, HalfFloatType as THalfFloatType, LinearFilter, Texture as ThreeTexture, SRGBColorSpace } from "three/webgpu";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { RuntimeFrame, FrameApplied, RendererDiagnostics, CaptureBytes, Id, ResourceHost, AppError, AssetDebug, SceneEntity, QualityProfile, ScreenshotBytes, OutputSpec, Vec3 } from "@opensekai/contracts";
import { DEFAULT_CAMERA_EFFECTS, LIMITS, RuntimeFrameSchema, avatarLighting } from "@opensekai/contracts";
import { distance, focusCharacterId, focusedLens, headFallbackPosition, smoothFocusDistance } from "./autofocus";
import { selectFrame, failure, createRenderQueue } from "./apply-frame";
import { applyHiddenMeshes, createAssetCache, createAssetLoader, disposeObject } from "./assets";
import { createAvatarBinding } from "./avatar-pose";
import type { SpringClock } from "./spring-grid";
import { countLiveMaterials } from "./diagnostics";
import { initializeBackend } from "./backend";
import { createGpuTimer, type TimestampBackend } from "./gpu-timer";
import { createCapturePolicy, readPng } from "./capture";
import { createLoadJobs, type AssetLoadStatus, type LoadReport, type LoadRequest } from "./load-jobs";
import { createEnvironmentLight, roomEnvironmentMap, roomIrradiance, type InstanceMaterials } from "./environment-light";
import { copyUnlitMaterials, createMaterialBinding, type MaterialBinding } from "./material-values";
import { createSceneLights, groupOf, isLitMaterial, roomLight, withDrafts, capFileLightShadows, collectFileLights, type LightGroup } from "./scene-lights";
import { characterRadius, shadowDirty, shadowLights, type Caster, type ShadowState, type Sphere as CasterSphere } from "./shadow-cache";
import { characterFill, normalizeRoom } from "./character-lighting-math";
import { createCharacterShare, setRoomFill } from "./character-mtoon";
import { logPipelineFailure, watchPipelineErrors, type PipelineDevice } from "./pipeline-diagnostics";
import { afterRebuild, blameFrame, initialBlame } from "./pipeline-blame";
import { freshModulePerPipeline, isWebKit } from "./webkit-shader-modules";
import { createDiagnosticMarker } from "./diagnostic-marker";
import { serialize } from "./serial";
import { createPostChain } from "./post-chain";
import { createHaze, type Haze } from "./haze";
import { createBeams } from "./beam";
import { createSnow, type Snow, type SnowAvatar } from "./snow";
import { SNOW_LAYER } from "./snow-flakes";
import type { SnowEntity } from "./snow-sky";
import { renderScreenshot, SCREENSHOT_HEIGHT, SCREENSHOT_WIDTH } from "./screenshot";
import { applyPerspectiveLens } from "./lens";
import { IMAGE_LOAD_FAILED, createScreenImagePool, createScreenMesh, loadScreenImage } from "./screen";
import { createCameraEffects, createDirtSource } from "./camera-effects";
import { applySky, clearSky, restoreSky, saveSky, skyNeedsTexture, type SkyTextures } from "./sky";
import { activeEffects, effectsKey } from "./camera-effects-math";
import { createLensLook, lookChainKey, lookQuality, needsLook } from "./lens-look";
import { createWebLayers, createWebQuad, webQuadWidth, webScreenPlan, type WebLayers } from "./web-screen";
import { loadVideoSource, openScreenVideo, type ScreenVideoPlayer, type VideoSource } from "./video-screen";
import { createCaptureScreens, probeVideoDecoder, type CaptureHost } from "./capture-screen";
import type { VideoDecoderSupport } from "@opensekai/contracts";
export interface RendererHandle {
    editor?: EditorHandle;
    applyFrame(frame: RuntimeFrame): Promise<FrameApplied>;
    capture(): Promise<CaptureBytes>;
    /** One 1920 × 1080 transparent PNG of `cameraId` after a frame with `expectedRevision` is displayed. The frame loop continues. */
    screenshot(cameraId: Id, expectedRevision: number): Promise<ScreenshotBytes>;
    diagnostics?(rendererEpoch: string): RendererDiagnostics | null;
    onLoadStatus(listener: (entries: AssetLoadStatus[]) => void): () => void;
    /** Character Debug R3: what the last load of this avatar asset read from its file, or null. */
    modelInfo(assetId: string): AssetDebug | null;
    dismissLoad(entityId: string): void;
    /**
     * Pauses each video element and closes each capture socket; the next applied frame seeks and plays the videos again
     * and opens the sockets again (B29 R14, B31 R14: the preview pump stop).
     */
    pauseVideos(): void;
    /** B31 R14: whether this view has VideoDecoder and decodes avc1.4d0029 at 1920 x 1080; null until the check ends. */
    videoDecoder(): VideoDecoderSupport | null;
    /** One diagnostics snapshot also without the diagnostics option, for the one decoder report at start (B31 R14); null until the check ends. */
    decoderReport(rendererEpoch: string): RendererDiagnostics | null;
    /** Test only: the capture stream IDs with an open socket. */
    captureSockets(): string[];
    /** Test only: resolves when the last seek or play of the screen's video has a new frame in its texture (B29 R14). */
    videoSettled(entityId: Id): Promise<void>;
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
    /** The page layers behind and in front of the canvas (B30 R5). Without them, the instance shows no web pages. */
    webLayers?: WebLayers;
    /** Only the OBS page plays video sound (B29 R16). Without it, each video element is muted. */
    audio?: boolean;
    /** The capture status and the capture route of the renderer client (B31 R14). Without it, a capture screen draws nothing. */
    capture?: CaptureHost;
}
// The output render scale multiplies the quality profile scale; the canvas CSS size does not change (B22 R5).
export const drawingBufferSize = (output: Pick<OutputSpec, "width" | "height" | "renderScale">, quality: Pick<QualityProfile, "resolutionScale">) => {
    const scale = (output.renderScale ?? 1) * quality.resolutionScale;
    return { width: Math.round(output.width * scale), height: Math.round(output.height * scale) };
};
export async function createRenderer(options: RendererOptions): Promise<RendererHandle> {
    if (options.editor) assertEditorScope(options.outputId, options.diagnostics);
    const { quality } = options;
    const { renderer, backend, gpuTimer: timerSupport } = await initializeBackend(options.canvas, options.mode, quality.msaaSamples);
    // The GPU pass time of applied frames (light scale R3–R6). Each render outside an applied frame taints its batch (R4).
    const gpuTimer = createGpuTimer(renderer.backend as unknown as TimestampBackend | undefined);
    const outsideFrame = <T>(render: () => T): T => { gpuTimer.taint(); return render(); };
    const camera = new PerspectiveCamera();
    camera.layers.enable(SNOW_LAYER);
    const scene = new Scene();
    scene.background = null;
    const sceneLights = createSceneLights(scene, renderer);
    // A failed pipeline compile is logged with its WGSL and named in frame warnings until the next light-set rebuild.
    let pipelineFailed = false;
    // The labels of the failure reports since the last drawn frame, and the state that gives each one to a pass (R15a).
    let failureReports: (string | null)[] = [], blame = initialBlame();
    const device = backend === "webgpu" ? (renderer.backend as unknown as { device?: PipelineDevice }).device : undefined;
    const unwatchPipelines = device ? watchPipelineErrors(device, (failure, first) => { pipelineFailed = true; failureReports.push(failure.label ?? null); if (first) logPipelineFailure(failure); }) : null;
    // After the watch, so that each new module still has its WGSL for the failure log (R9b).
    const restoreModules = device && isWebKit(navigator.userAgent) ? freshModulePerPipeline(device) : null;
    const loadAsset = createAssetLoader(options.resources, {maxTextureSize: quality.maxTextureSize});
    const postChain = createPostChain(renderer);
    // The haze volume (B13 R7). A pipeline failure while it draws stops it until the next node-set rebuild (R9).
    let haze: Haze | null = null, hazeFailed = false;
    // The cone beams of spot lights (stage beams R10). A new failure that `pipeline-blame.ts` gives to the beams stops them (R15, R15a).
    // The cone root is in the scene only while a beam draws, so a scene without a beam keeps its objects.
    const beams = createBeams();
    let beamsFailed = false;
    // The snow facade exists only while a snow entity does. A snow failure stops it until the entity or the scene revision changes.
    // `snowProven` is true after a draw with the current snow materials: a later draw failure is not a snow failure.
    let snow: Snow | null = null, snowFailed: { id: Id; revision: number; message: string } | null = null, snowProven = false;
    const assets = createAssetCache(loadAsset);
    const debugs = new Map<string, AssetDebug>();
    // One texture for each image asset in this client, shared by all screens that show it (B28 R12). Each quad holds a
    // lease, so the texture closes only when no quad uses it.
    const images = createScreenImagePool(id => loadScreenImage(() => options.resources.readAsset(id), quality.maxTextureSize));
    // One object URL for each video asset in this client (B29 R13). Each screen has its own element, so two screens with
    // one asset keep their own positions; the URL is revoked when no screen holds it.
    const videos = createScreenImagePool<VideoSource>(id => loadVideoSource(() => options.resources.readAsset(id)));
    // The camera effects of the output camera (B37 R17), and its lens dirt image with one lease from the image pool (R20).
    const cameraEffects = createCameraEffects();
    const lensLook = createLensLook();
    const lookTier = lookQuality(quality.id);
    const dirt = createDirtSource(images);
    // Sky textures: image (LDR equirect) and HDR equirect, keyed by asset ID.
    const skyTextures = new Map<string, { texture: DataTexture | import("three/webgpu").Texture; dispose(): void }>();
    const skyLoading = new Map<string, Promise<void>>();
    const skyFailed = new Set<string>();
    const hdrParser = new HDRLoader();
    const loadSkyTexture = (assetId: string): Promise<void> => {
        if (skyTextures.has(assetId)) return Promise.resolve();
        const pending = skyLoading.get(assetId);
        if (pending) return pending;
        const job = options.resources.readAsset(assetId).then(buffer => {
            const bytes = new Uint8Array(buffer);
            // Radiance HDR: starts with "#?" (magic bytes 0x23 0x3f)
            if (bytes[0] === 0x23 && bytes[1] === 0x3f) {
                const parsed = hdrParser.parse(buffer);
                if (!parsed) { skyFailed.add(assetId); return; }
                const tex = new DataTexture(parsed.data, parsed.width, parsed.height, undefined, parsed.type ?? THalfFloatType);
                tex.minFilter = LinearFilter;
                tex.magFilter = LinearFilter;
                tex.mapping = EquirectangularReflectionMapping;
                tex.needsUpdate = true;
                skyFailed.delete(assetId);
                skyTextures.set(assetId, { texture: tex, dispose: () => tex.dispose() });
            } else {
                // LDR image: decode via ImageBitmap
                const blob = new Blob([buffer]);
                return createImageBitmap(blob).then(bitmap => {
                    const tex = new ThreeTexture(bitmap);
                    tex.colorSpace = SRGBColorSpace;
                    tex.mapping = EquirectangularReflectionMapping;
                    tex.needsUpdate = true;
                    skyFailed.delete(assetId);
                    skyTextures.set(assetId, { texture: tex, dispose: () => { tex.dispose(); bitmap.close(); } });
                });
            }
        }).catch(() => { skyFailed.add(assetId); }).finally(() => skyLoading.delete(assetId));
        skyLoading.set(assetId, job);
        return job;
    };
    const skyTextureAdapter: SkyTextures = { get: (id) => skyTextures.get(id)?.texture as import("three/webgpu").Texture ?? null };
    const audio = options.audio === true;
    // One socket and one decoder for each capture stream (B31 R14). WebGL 2 uploads the VideoFrame; WebGPU an ImageBitmap.
    const captures = createCaptureScreens({ host: options.capture, upload: backend === "webgpu" ? "bitmap" : "frame" });
    let decoderSupport: VideoDecoderSupport | null = null;
    void probeVideoDecoder().then(value => { decoderSupport = value; });
    const makeRoomMap = roomEnvironmentMap(renderer);
    const environmentLight = createEnvironmentLight(renderer, () => outsideFrame(makeRoomMap));
    // The fill color and the room irradiance of all avatars of this renderer (character lighting R4). The share starts with the flat
    // fill. The room irradiance is made once, on the first avatar build, and is never tried again. The promise gives the reason
    // when it fails, or null.
    const characterShare = createCharacterShare();
    let roomFill: Promise<string | null> | null = null;
    const loadRoomFill = () => roomFill ??= outsideFrame(() => roomIrradiance(renderer)).then(coefficients => {
        if (!coefficients.every(c => c.every(Number.isFinite)) || coefficients.every(c => c.every(x => x === 0))) throw new Error("the room irradiance is zero or not finite");
        setRoomFill(characterShare, normalizeRoom(coefficients));
        return null;
    }).catch((error: unknown) => error instanceof Error ? error.message : String(error));
    type Ready = { root: Object3D; video?: ScreenVideoPlayer; avatar?: ReturnType<typeof createAvatarBinding>; meshes?: ReadonlyMap<string, Object3D>; binding?: MaterialBinding; assetId?: string; assetDispose?: () => void; instanceDispose?: () => void; materials?: InstanceMaterials; lit: number; radius?: number; warnings: AppError[]; dispose(): void };
    const loadListeners = new Set<(entries: AssetLoadStatus[]) => void>();
    // three r187 keeps one precompile state per renderer across awaits; overlapping compileAsync calls clear it.
    const compileOnce = serialize();
    const prepare = async (root: Object3D, report: (r: LoadReport) => void, cancelled: () => boolean) => {
        if (cancelled() || disposed) throw failure("CANCELLED", "Asset load cancelled");
        report({ stage: "prepare", progress: null });
        const culled: Object3D[] = [];
        root.traverse(object => { if (object.frustumCulled) { culled.push(object); object.frustumCulled = false; } });
        // The load can end while this run waits in the queue behind another compile.
        try { await compileOnce(() => { if (cancelled() || disposed) throw failure("CANCELLED", "Asset load cancelled"); return renderer.compileAsync(root, camera, scene); }); }
        finally { for (const object of culled) object.frustumCulled = true; }
    };
    const build = async (request: LoadRequest, report: (r: LoadReport) => void, cancelled: () => boolean): Promise<Ready> => {
        if (request.kind === "video") {
            const lease = await videos.acquire(request.assetId);
            if (cancelled() || disposed) { lease.release(); throw failure("CANCELLED", "Asset load cancelled"); }
            let player: ScreenVideoPlayer;
            // The loop and the volume come from the first frame sync, before the element plays.
            try { player = await openScreenVideo(lease.image, { audio, loop: true, volume: 1, upload: backend === "webgpu" ? "bitmap" : "element" }); }
            catch (error) { lease.release(); throw error; }
            const quad = createScreenMesh(player);
            const release = () => { quad.dispose(); player.dispose(); lease.release(); };
            if (cancelled() || disposed) { release(); throw failure("CANCELLED", "Asset load cancelled"); }
            try { await prepare(quad.root, report, cancelled); }
            catch (error) { release(); throw error; }
            return { root: quad.root, video: player, assetId: request.assetId, instanceDispose: release, lit: 0, warnings: [], dispose: release };
        }
        if (request.kind === "screen") {
            const lease = await images.acquire(request.assetId);
            if (cancelled() || disposed) { lease.release(); throw failure("CANCELLED", "Asset load cancelled"); }
            const quad = createScreenMesh(lease.image);
            const release = () => { quad.dispose(); lease.release(); };
            try { await prepare(quad.root, report, cancelled); }
            catch (error) { release(); throw error; }
            return { root: quad.root, assetId: request.assetId, instanceDispose: release, lit: 0, warnings: [], dispose: release };
        }
        if (request.kind === "avatar") {
            const asset = await loadAsset(request.assetId, report);
            // Keep the debug data of the last 8 avatar assets.
            debugs.delete(request.assetId);
            debugs.set(request.assetId, asset.debug);
            for (const id of [...debugs.keys()].slice(0, -8)) debugs.delete(id);
            try {
                if (!asset.vrm) throw failure("INVALID_INPUT", "Avatar asset has no VRM");
                const avatar = createAvatarBinding(asset.vrm);
                // The shadow cache sphere of the character, from its rest pose (light scale R25).
                const rest = meshBounds(avatar.root, true);
                const radius = characterRadius(rest.min.toArray(), rest.max.toArray());
                // The material builds read the share, so it goes on before GPU preparation, with the room irradiance in its uniforms.
                const unavailable = await loadRoomFill();
                for (const material of avatar.characters) material.characterShare = characterShare;
                // The group node set goes on before GPU preparation, so the compiled pipelines are the ones the frame draws (R6).
                sceneLights.assign(avatar.root, "characters");
                const lit = sceneLights.generation();
                await prepare(avatar.root, report, cancelled);
                const binding = asset.materials?.length ? createMaterialBinding(asset.materials, avatar.root, asset.materialIndex) : undefined;
                return { root: avatar.root, avatar, meshes: asset.meshes, binding, assetDispose: asset.dispose, lit, radius, warnings: unavailable ? [...asset.warnings, { code: "UNAVAILABLE", message: "Room fill unavailable: " + unavailable, ids: [request.assetId] }] : asset.warnings, dispose: asset.dispose };
            } catch (error) { asset.dispose(); throw error; }
        }
        const asset = await assets.get(request.assetId);
        if (cancelled() || disposed) throw failure("CANCELLED", "Asset load cancelled");
        const root = clone(asset.scene);
        // Each instance owns a copy of every material, so a saved material value changes one instance only (B38 R28).
        const unlit = copyUnlitMaterials(root, isLitMaterial);
        const lit = environmentLight.apply(root);
        const binding = asset.materials?.length ? createMaterialBinding(asset.materials, root, asset.materialIndex, new Map([...unlit.originals, ...lit.originals])) : undefined;
        const materials: InstanceMaterials = { ...lit, dispose() { lit.dispose(); unlit.dispose(); } };
        const release = () => { disposeInstance(root); materials.dispose(); };
        // ENV-01: cap file-light shadows on loaded environment models.
        if (request.kind === "environment") capFileLightShadows(root);
        sceneLights.assign(root, request.kind === "environment" ? "environment" : "props");
        const generation = sceneLights.generation();
        try { await prepare(root, report, cancelled); }
        catch (error) { release(); throw error; }
        return { root, assetId: request.assetId, warnings: asset.warnings, instanceDispose: materials.dispose, materials, binding, lit: generation, dispose: release };
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
        video?: ScreenVideoPlayer;
        avatar?: ReturnType<typeof createAvatarBinding>;
        // The mesh nodes of an avatar by mesh name (B26 R7); avatars are not cloned, so the map holds the drawn objects.
        meshes?: ReadonlyMap<string, Object3D>;
        binding?: MaterialBinding;
        assetDispose?: () => void;
        instanceDispose?: () => void;
        materials?: InstanceMaterials;
        group?: LightGroup;
        lit?: number;
        // The shadow cache data (light scale R25): the rest radius of a character, or the last key and world sphere of a prop or environment.
        radius?: number;
        shadowKey?: string;
        sphere?: CasterSphere | null;
        warnings?: AppError[];
    }>();
    const editor = options.editor ? createEditorViewport(options.canvas, camera, scene, objects, options.editor) : null;
    const webLayers = options.webLayers ? createWebLayers(options.webLayers) : null;
    let disposed = false, cleaned = false, accepted: RuntimeFrame | null = null, displayed: FrameApplied | null = null, displayFrame: RuntimeFrame | null = null;
    // Autofocus (#343 R7): the smoothed focus distance of each camera, and the elapsed time of the last frame it saw.
    const focusDistances = new Map<Id, number>();
    let previousElapsedMs: number | null = null;
    // The Focus Character is the Orbit Character target; its head bone (or the fallback offset) gives the distance.
    const focusTargetDistance = (sceneView: RuntimeFrame["scene"], camera: Extract<SceneEntity, { kind: "camera" }>, position: Vec3): number | null => {
        const targetId = camera.lens.autofocus ? focusCharacterId(camera.navigation) : null;
        const target = targetId ? sceneView.entities.find(entity => entity.id === targetId) : undefined;
        return target ? distance(position, objects.get(target.id)?.avatar?.headWorldPosition() ?? headFallbackPosition(target.transform.position)) : null;
    };
    // The shadow map cache (light scale R22–R26). `shadowForce` marks each shadow light in the next applied frame, after a screenshot or a capture render.
    let shadowState: ShadowState | null = null, shadowForce = false;
    const casters = (entities: readonly SceneEntity[]): Map<Id, Caster> => {
        const out = new Map<Id, Caster>();
        for (const entity of entities) {
            const value = objects.get(entity.id);
            if (!value?.group) continue;
            const root = value.root;
            // A character moves in each frame; its sphere is at its root (R25).
            if (value.radius !== undefined) { out.set(entity.id, { key: "", moving: true, sphere: root.visible ? { center: root.position.toArray(), radius: value.radius * maxScale(root) } : null }); continue; }
            const key = JSON.stringify([root.uuid, root.position.toArray(), root.quaternion.toArray(), root.scale.toArray(), root.visible, entity.kind === "mesh" ? entity.materials ?? null : null]);
            if (value.shadowKey !== key) {
                value.shadowKey = key;
                const box = root.visible ? meshBounds(root, false) : null;
                const sphere = box && !box.isEmpty() ? box.getBoundingSphere(new Sphere()) : null;
                value.sphere = sphere ? { center: sphere.center.toArray(), radius: sphere.radius } : null;
            }
            out.set(entity.id, { key, moving: false, sphere: value.sphere ?? null });
        }
        return out;
    };
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
        webLayers?.dispose();
        for (const value of objects.values()) releaseObject(value);
        captures.dispose();
        objects.clear();
        focusDistances.clear();
        jobs.dispose();
        assets.dispose();
        dirt.dispose();
        for (const entry of skyTextures.values()) entry.dispose();
        skyTextures.clear();
        cameraEffects.dispose();
        lensLook.dispose();
        images.dispose();
        videos.dispose();
        environmentLight.dispose();
        sceneLights.dispose();
        restoreModules?.();
        unwatchPipelines?.();
        postChain.dispose();
        haze?.dispose();
        snow?.dispose();
        beams.dispose();
        marker?.dispose();
        scene.clear();
        gpuTimer.dispose();
        renderer.dispose();
    };
    const queue = createRenderQueue(() => { if (disposed)
        cleanup(); });
    // `applied` is false for the render of a capture, which draws the displayed frame again (R4).
    const submit = async (frame: RuntimeFrame, applied = true): Promise<FrameApplied> => {
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
        const { width, height } = drawingBufferSize(output, quality);
        if (options.canvas.width !== width || options.canvas.height !== height)
            renderer.setSize(width, height, false);
        const warnings: AppError[] = [];
        // A dragged light or haze follows the gizmo on each frame, between the throttled commits (B12 R7).
        const drawn = editor ? withDrafts(frame.scene.entities, id => editor.draftTransform(id)) : frame.scene.entities;
        environmentLight.room(roomLight(drawn));
        characterShare.fill.value.setRGB(...characterFill(drawn));
        // Cameras, lights, and the haze have a scene object only in the editor viewport, as a pick target and helper (R14, B13 R13).
        // An FPS counter is a DOM overlay and a VMC sender sends UDP; neither has a scene object (B19 R7, B21). A snow entity has none either.
        const wanted = new Set(frame.scene.entities.filter(x => x.kind !== "tracking" && x.kind !== "fpsCounter" && x.kind !== "snow" && x.kind !== "vmcSender" && (editor || (x.kind !== "camera" && x.kind !== "light" && x.kind !== "haze"))).map(x => x.id));
        for (const [id, value] of objects) {
            if (!wanted.has(id)) {
                releaseObject(value);
                objects.delete(id);
            }
        }
        const syncVideo = (player: ScreenVideoPlayer, entityId: string, content: { loop: boolean; volume: number }, visible: boolean, assetId: string) => {
            const warning = player.sync(frame.screenPlayback?.find(entry => entry.entityId === entityId), content, visible);
            if (warning) warnings.push({ ...warning, ids: [assetId] });
        };
        // The Reflections Intensity of the environment applies to the props too, as in Warudo (prop import R4).
        const reflections = frame.scene.entities.find((x): x is Extract<SceneEntity, { kind: "environment" }> => x.kind === "environment")?.reflectionsIntensity ?? 1;
        const needed = new Map<string, LoadRequest>();
        const webPlans = webScreenPlan(frame.scene);
        const captureViews = captures.apply(frame.scene.entities);
        for (const entity of frame.scene.entities) {
            if (entity.kind === "tracking" || entity.kind === "fpsCounter" || entity.kind === "snow" || entity.kind === "vmcSender") continue;
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
            // A web screen has no asset and no load job (B30 R10). Its quad is the hole or a pick target (R8, R9); the page is in a DOM layer.
            if (entity.kind === "screen" && entity.content.kind === "web") {
                const plan = webPlans.find(item => item.entityId === entity.id);
                let value = objects.get(entity.id);
                if (!plan && !editor) {
                    if (value) { releaseObject(value); objects.delete(entity.id); }
                    continue;
                }
                const aspect = plan ? webQuadWidth(plan) : 1280 / 720, hole = !!plan && !plan.onTop;
                const signature = `web:${aspect}:${hole}`;
                if (value?.signature !== signature) {
                    if (value) releaseObject(value);
                    const quad = createWebQuad(aspect, hole);
                    value = { signature, root: quad.root, owned: false, instanceDispose: quad.dispose };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                }
                if (!editor?.frozen(entity.id)) place(value.root, entity);
                continue;
            }
            // A capture screen has no asset and no load job (B31 R14). It draws the newest decoded frame of its stream while
            // the host state is live; otherwise the editor keeps an undrawn quad as the pick and gizmo target (R16).
            if (entity.kind === "screen" && entity.content.kind === "capture") {
                const view = captureViews.get(entity.id);
                if (view?.warning) warnings.push(view.warning);
                let value = objects.get(entity.id);
                const aspect = view?.aspect ?? 16 / 9, texture = view?.texture ?? null;
                if (!texture && !editor) {
                    if (value) { releaseObject(value); objects.delete(entity.id); }
                    continue;
                }
                const signature = `capture:${aspect}:${texture?.uuid ?? "pick"}`;
                if (value?.signature !== signature) {
                    if (value) releaseObject(value);
                    const quad = texture ? createScreenMesh({ texture, width: aspect, height: 1, alpha: false }) : createWebQuad(aspect, false);
                    value = { signature, root: quad.root, owned: false, instanceDispose: quad.dispose };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                }
                if (!editor?.frozen(entity.id)) place(value.root, entity);
                continue;
            }
            // A screen is never read as a mesh: an image screen and a video screen each have their own load kind (B28 R13,
            // B29 R15), so a video is never read as an image either.
            const assetId = entity.kind === "avatar" || entity.kind === "environment" ? entity.assetId : entity.kind === "screen" ? (entity.content.kind === "web" || entity.content.kind === "capture" ? null : entity.content.assetId) : entity.source.kind === "asset" ? entity.source.assetId : null;
            const videoContent = entity.kind === "screen" && entity.content.kind === "video" ? entity.content : null;
            const request: LoadRequest | null = assetId === null ? null : videoContent ? { kind: "video", assetId, retryKey: JSON.stringify(videoContent) } : { kind: entity.kind === "avatar" ? "avatar" : entity.kind === "environment" ? "environment" : entity.kind === "screen" ? "screen" : "mesh", assetId };
            let value = objects.get(entity.id);
            // An element error after the load draws nothing and becomes a failed job, so the retry rule applies (B29 R15).
            const lateFailure = value?.video?.failure();
            if (value && lateFailure && request) {
                releaseObject(value); objects.delete(entity.id); value = undefined;
                jobs.fail(entity.id, request, lateFailure);
            }
            if (assetId === null && (entity.kind !== "mesh" || entity.source.kind === "asset")) {
                if (value) { releaseObject(value); objects.delete(entity.id); }
                continue;
            }
            const signature = entity.kind + ":" + (videoContent ? "video:" : "") + (assetId ?? "box");
            if (value?.signature !== signature) {
                if (assetId === null) {
                    if (value) releaseObject(value);
                    value = { signature, root: new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({ color: 0x55aacc })), owned: true, group: "props" };
                    scene.add(value.root);
                    objects.set(entity.id, value);
                } else {
                    // The new model is still loading: keep posing the old model, if any, until the job installs the new one.
                    needed.set(entity.id, request!);
                    if (!value) continue;
                }
            }
            for (const warning of value.warnings ?? [])
                if (!warnings.some(x => x.message === warning.message && x.ids[0] === warning.ids[0])) warnings.push(warning);
            value.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entity.id));
            if (value.meshes && entity.kind === "avatar") applyHiddenMeshes(value.meshes, entity.hiddenMeshes);
            // After the expression update of `apply`, so the saved value wins over an expression color bind (B38 R28).
            value.binding?.apply(entity.kind === "avatar" || entity.kind === "mesh" ? entity.materials : undefined);
            value.avatar?.uv(frame.elapsedMs);
            value.avatar?.lighting(avatarLighting(entity));
            value.materials?.reflections(reflections);
            if (!editor?.frozen(entity.id)) place(value.root, entity);
            // After place, also for a dragged avatar: the stage reads the root transform (B43 R11).
            value.avatar?.advanceSprings(springClock(frame, entity.id));
            if (value.video && videoContent) syncVideo(value.video, entity.id, videoContent, entity.visible, assetId!);
        }
        jobs.reconcile(needed, frame.scene.revision, new Set(frame.scene.entities.filter(entity => entity.kind === "screen" && entity.content.kind === "video").map(entity => entity.id)));
        for (const [entityId, request] of needed) {
            const ready = jobs.take(entityId);
            if (!ready) continue;
            const entity = frame.scene.entities.find(item => item.id === entityId)!;
            const old = objects.get(entityId);
            if (old) releaseObject(old);
            const installedVideo = entity.kind === "screen" && entity.content.kind === "video" ? entity.content : null;
            const installed = { signature: entity.kind + ":" + (installedVideo ? "video:" : "") + request.assetId, root: ready.root, video: ready.video, owned: false, avatar: ready.avatar, meshes: ready.meshes, binding: ready.binding, assetId: ready.assetId, assetDispose: ready.assetDispose, instanceDispose: ready.instanceDispose, materials: ready.materials, group: groupOf(entity) ?? undefined, lit: ready.lit, radius: ready.radius, warnings: ready.warnings, pickable: entity.kind !== "environment" };
            scene.add(installed.root);
            objects.set(entityId, installed);
            installed.avatar?.apply(frame.avatarPoses?.find(pose => pose.avatarId === entityId));
            if (installed.meshes && entity.kind === "avatar") applyHiddenMeshes(installed.meshes, entity.hiddenMeshes);
            installed.binding?.apply(entity.kind === "avatar" || entity.kind === "mesh" ? entity.materials : undefined);
            installed.avatar?.uv(frame.elapsedMs);
            installed.avatar?.lighting(avatarLighting(entity));
            installed.materials?.reflections(reflections);
            if (!editor?.frozen(entityId)) place(installed.root, entity);
            installed.avatar?.advanceSprings(springClock(frame, entityId));
            if (installed.video && installedVideo) syncVideo(installed.video, entityId, installedVideo, entity.visible, request.assetId);
            warnings.push(...ready.warnings);
        }
        for (const [entityId, request] of needed) {
            const message = jobs.failure(entityId);
            if (!message) continue;
            warnings.push({ code: "UNAVAILABLE", message: "Asset load failed: " + message, ids: [request.assetId] });
            // A failed screen draws nothing, so the image of an earlier asset goes too (B28 R13).
            const old = request.kind === "screen" || request.kind === "video" ? objects.get(entityId) : undefined;
            if (old) { releaseObject(old); objects.delete(entityId); }
        }
        for (const entry of jobs.status()) if (entry.stage !== "failed") warnings.push({ code: "BUSY", message: "Asset loading", ids: [entry.assetId] });
        // ENV-01: collect file lights after env install so the first lit frame sees them.
        const envEntity = drawn.find((e): e is Extract<SceneEntity, { kind: "environment" }> => e.kind === "environment");
        const envObject = envEntity ? objects.get(envEntity.id) : undefined;
        const envFileLights = envObject && envEntity?.visible !== false ? collectFileLights(envObject.root) : [];
        const envAffectChars = envEntity?.allowLightsToAffectCharacters === true;
        sceneLights.setFileLights(envFileLights, envAffectChars);
        const lightsRebuilt = sceneLights.apply(drawn);
        if (lightsRebuilt) { pipelineFailed = false; hazeFailed = false; beamsFailed = false; blame = afterRebuild(blame); }
        if (pipelineFailed) warnings.push({ code: "UNSUPPORTED", message: "Pipeline compile failed", ids: [] });
        const hazeEntity = drawn.find(x => x.kind === "haze");
        if (hazeEntity?.kind === "haze") {
            if (!haze) { haze = createHaze(); scene.add(haze.mesh); }
            haze.update(hazeEntity, frame.elapsedMs / 1000);
            haze.setLights(sceneLights.node("haze"));
        } else if (haze) { haze.dispose(); haze = null; }
        const hazeDrawn = haze && hazeEntity?.visible && !hazeFailed ? haze : null;
        const snowEntity = drawn.find((x): x is SnowEntity => x.kind === "snow");
        // A snow failure does not stop the frame: the facade goes, and the frame carries the warning.
        const failSnow = (id: Id, error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            snow?.dispose();
            snow = null;
            snowFailed = { id, revision: frame.scene.revision, message };
            warnings.push({ code: "UNSUPPORTED", message: "Snow failed: " + message, ids: [id] });
        };
        if (snowFailed && (snowFailed.id !== snowEntity?.id || snowFailed.revision !== frame.scene.revision)) snowFailed = null;
        if (snowFailed) warnings.push({ code: "UNSUPPORTED", message: "Snow failed: " + snowFailed.message, ids: [snowFailed.id] });
        else if (snowEntity) {
            try {
                if (!snow) { snow = createSnow({ tint: characterShare.fill, compute: backend === "webgpu" }); scene.add(snow.flakes); snowProven = false; }
                // Only installed content: an avatar that still loads has no binding yet.
                const avatars = drawn.flatMap((entity): SnowAvatar[] => {
                    const value = entity.kind === "avatar" ? objects.get(entity.id) : undefined;
                    return value?.avatar ? [{ id: entity.id, root: value.root, materials: value.avatar.characters, clock: springClock(frame, entity.id) }] : [];
                });
                const casters = drawn.flatMap(entity => {
                    const value = entity.kind === "avatar" || entity.kind === "mesh" || entity.kind === "environment" ? objects.get(entity.id) : undefined;
                    return value ? [value.root] : [];
                });
                if (snow.update(snowEntity, frame.elapsedMs / 1000, avatars, casters)) snowProven = false;
                warnings.push(...snow.warnings());
            }
            catch (error) { failSnow(snowEntity.id, error); }
        } else if (snow) { snow.dispose(); snow = null; }
        let snowDrawn = snowEntity && snow ? { entity: snowEntity, snow } : null;
        // `drawn` has the gizmo drafts, so a dragged light moves its beam.
        const beamsDrawn = beams.update(drawn) && !beamsFailed ? beams : null;
        if (!beamsDrawn) beams.root.removeFromParent();
        else if (!beams.root.parent) scene.add(beams.root);
        // A change of the light set gives each lit material its new group node set (R6, R7).
        const generation = sceneLights.generation();
        for (const value of objects.values()) if (value.group && value.lit !== generation) { sceneLights.assign(value.root, value.group); value.lit = generation; }
        // Each shadow map draws only in a frame that changes its contents (R22, R23). A capture render marks each map (R26).
        const shadowed = shadowLights(drawn);
        if (shadowed.size) {
            const marks = shadowDirty(shadowState, { lights: shadowed, casters: casters(frame.scene.entities), renderEnvironment: showEnvironment, force: lightsRebuilt || shadowForce || !applied });
            shadowState = marks.state;
            sceneLights.markShadows(marks.dirty);
        } else shadowState = null;
        shadowForce = !applied;
        editor?.refresh();
        const used = new Set([...objects.values()].flatMap(x => x.assetId ? [x.assetId] : []));
        for (const id of jobs.assetIds()) used.add(id);
        assets.retainOnly(used);
        const dirtId = cameraEntity.effects?.lensDirt?.assetId ?? null;
        const dirtState = dirt.texture(dirtId);
        if (dirtState === "failed" && dirtId !== null) {
            const message = "Asset load failed: " + IMAGE_LOAD_FAILED;
            if (!warnings.some(x => x.message === message && x.ids[0] === dirtId)) warnings.push({ code: "UNAVAILABLE", message, ids: [dirtId] });
        }
        const dirtImage = dirtState === "failed" ? null : dirtState;
        const active = activeEffects(cameraEntity.effects, dirtImage !== null);
        const fxKey = effectsKey(active, dirtId);
        if (fxKey !== "") cameraEffects.update(cameraEntity.effects, { width, height }, dirtImage);
        const effectsDrawn = fxKey === "" ? null : { key: fxKey, active, runtime: cameraEffects, dirt: dirtImage };
        // Autofocus (#343 R7): the target distance, smoothed at `focusSpeed`, is the focus of the lens the look stack reads.
        const autofocusDtSeconds = previousElapsedMs === null ? 0 : Math.max(0, (frame.elapsedMs - previousElapsedMs) / 1000);
        previousElapsedMs = frame.elapsedMs;
        // An orbit drag moves the editor camera before it commits, so autofocus measures from the navigated position.
        const navigated = editor?.cameraTransform(cameraEntity.id);
        const target = focusTargetDistance(frame.scene, cameraEntity, (navigated ?? cameraEntity.transform).position);
        if (target !== null) {
            const focusSpeed = cameraEntity.effects?.depthOfField?.focusSpeed ?? DEFAULT_CAMERA_EFFECTS.depthOfField.focusSpeed;
            const previous = focusDistances.get(cameraEntity.id) ?? cameraEntity.lens.focusDistance;
            focusDistances.set(cameraEntity.id, smoothFocusDistance(previous, target, focusSpeed, autofocusDtSeconds));
        } else focusDistances.delete(cameraEntity.id);
        const lens = focusedLens(cameraEntity.lens, focusDistances.get(cameraEntity.id));
        const lookKey = lookChainKey(cameraEntity.effects, lookTier);
        if (lookKey !== "") lensLook.update(cameraEntity.effects, lens, lookTier);
        const lookDrawn = lookKey === "" || !cameraEntity.effects ? null : { key: lookKey, effects: cameraEntity.effects, quality: lookTier, runtime: lensLook };
        camera.aspect = width / height;
        applyPerspectiveLens(camera, cameraEntity.lens);
        applyTransform(camera, navigated ? { ...cameraEntity, transform: navigated } : cameraEntity);
        // ENV-02: load and apply the camera sky before the draw; restore after.
        const neededSkyAsset = skyNeedsTexture(cameraEntity.sky);
        if (neededSkyAsset) {
            void loadSkyTexture(neededSkyAsset);
            if (skyFailed.has(neededSkyAsset) && !warnings.some(x => x.message.startsWith("Sky texture load failed") && x.ids[0] === neededSkyAsset))
                warnings.push({ code: "UNAVAILABLE", message: "Sky texture load failed", ids: [neededSkyAsset] });
        }
        const savedSky = saveSky(scene);
        applySky(scene, cameraEntity.sky, skyTextureAdapter);
        // ENV-02 IBL: PMREM onto env/prop copies only; never scene.environment.
        const sky = cameraEntity.sky;
        if (sky?.ibl && sky.kind === 'color' && sky.color) environmentLight.iblFromColor(sky.color);
        else if (sky?.ibl && (sky.kind === 'image' || sky.kind === 'hdr') && sky.assetId) {
            const tex = skyTextureAdapter.get(sky.assetId);
            if (tex) environmentLight.iblFromEquirect(tex, sky.assetId);
            else environmentLight.clearIbl();
        } else environmentLight.clearIbl();
        try {
            // three.js 0.180: on WebGPU a shadow first set up during a draw stays empty, so compile first; on WebGL 2 this compile leaves the shadow empty.
            if (lightsRebuilt && sceneLights.shadows() && backend === "webgpu") await compileOnce(() => renderer.compileAsync(scene, camera));
            // The sky pass and the build-up steps come before the scene draw.
            if (snowDrawn) {
                try { await snowDrawn.snow.render(renderer, scene); }
                catch (error) { failSnow(snowDrawn.entity.id, error); snowDrawn = null; }
            }
            const draw = () => postChain.render(scene, camera, cameraEntity.antiAliasing, hazeDrawn, cameraEntity.grading ?? null, beamsDrawn, effectsDrawn, lookDrawn);
            try { await draw(); }
            catch (error) {
                // The first draw with new snow materials builds their nodes. A failure there is a snow failure: draw again without the snow.
                if (!snowDrawn || snowProven) throw error;
                failSnow(snowDrawn.entity.id, error);
                snowDrawn = null;
                await draw();
            }
            if (snowDrawn) snowProven = true;
            const blamed = blameFrame(blame, { haze: hazeDrawn !== null, beams: beamsDrawn !== null }, failureReports);
            blame = blamed.state;
            failureReports = [];
            if (blamed.stop.includes("haze")) hazeFailed = true;
            if (blamed.stop.includes("beams")) beamsFailed = true;
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
            // The passes of a failed frame are not a sample (R4).
            gpuTimer.taint();
            restoreSky(scene, savedSky);
            environmentLight.clearIbl();
            warnings.push({ code: "UNSUPPORTED", message: "Material/render submission failed: " + (error instanceof Error ? error.message : String(error)), ids: [] });
            throw Object.assign(failure("UNSUPPORTED", "Render submission failed"), { warnings });
        }
        restoreSky(scene, savedSky);
        if (applied) gpuTimer.frameDone();
        if (disposed)
            throw failure("CANCELLED", "Renderer disposed");
        // The pages follow the camera that drew the canvas, in the logical output size stretched as the canvas is (B30 R7).
        webLayers?.render({ plans: webPlans, root: id => objects.get(id)?.root, camera, width: output.width, height: output.height, cssWidth: options.canvas.clientWidth, cssHeight: options.canvas.clientHeight, selectedId: editor?.selectedId() ?? null });
        displayFrame = frame;
        displayed = { outputId: options.outputId, sessionId: frame.sessionId, sequence: frame.sequence, tick: frame.tick, revision: frame.scene.revision, cameraId: cameraEntity.id, backend, cpuMs: performance.now() - started, gpuMs: applied ? gpuTimer.take() : null, warnings, qualityProfile: quality.id };
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
            const shotCamera = new PerspectiveCamera();
            // The flakes as in the output, with the height target and the amounts of the last applied frame.
            shotCamera.layers.enable(SNOW_LAYER);
            shotCamera.aspect = SCREENSHOT_WIDTH / SCREENSHOT_HEIGHT;
            applyPerspectiveLens(shotCamera, entity.lens);
            applyTransform(shotCamera, entity);
            // Visibility comes from the frame; cameras and editor helpers are not drawn. A root that a gizmo drag holds keeps its draft pose.
            const show = new Map<Object3D, boolean>();
            for (const [id, value] of objects) {
                const source = frame.scene.entities.find(x => x.id === id);
                show.set(value.root, !!source && source.kind !== "camera" && source.kind !== "light" && source.kind !== "haze" && source.kind !== "fpsCounter" && source.kind !== "vmcSender" && source.visible && (source.kind !== "environment" || entity.renderEnvironment !== false));
            }
            // The haze draws in the screenshot as in the output (B13 R10).
            const shotHaze = haze && !hazeFailed && frame.scene.entities.some(x => x.kind === "haze" && x.visible) ? haze : null;
            const shotBeams = beams.root.parent && !beamsFailed ? beams : null;
            // The camera effects as in the output (B37 R21). A dirt image that the output does not hold gets its own lease for this shot.
            const shotDirtId = entity.effects?.lensDirt?.assetId ?? null;
            const held = shotDirtId === null ? null : dirt.peek(shotDirtId);
            const lease = shotDirtId !== null && !held ? await images.acquire(shotDirtId).catch(() => null) : null;
            const shotEffects = entity.effects ? { effects: entity.effects, dirt: held ?? lease?.image ?? null } : null;
            // The output camera uses its live smoothed focus; another autofocus camera focuses on its target now.
            const shotLens = focusedLens(entity.lens, focusDistances.get(cameraId) ?? focusTargetDistance(frame.scene, entity, entity.transform.position));
            const shotLook = entity.effects && needsLook(entity.effects) ? { effects: entity.effects, lens: shotLens, quality: lookTier } : null;
            // ENV-02: await sky texture so the shot matches the camera sky (not a cleared fallback).
            const shotNeeded = skyNeedsTexture(entity.sky);
            if (shotNeeded) await loadSkyTexture(shotNeeded);
            const shotSavedSky = saveSky(scene);
            applySky(scene, entity.sky, skyTextureAdapter);
            const shotSky = entity.sky;
            if (shotSky?.ibl && shotSky.kind === 'color' && shotSky.color) environmentLight.iblFromColor(shotSky.color);
            else if (shotSky?.ibl && (shotSky.kind === 'image' || shotSky.kind === 'hdr') && shotSky.assetId) {
                const tex = skyTextureAdapter.get(shotSky.assetId);
                if (tex) environmentLight.iblFromEquirect(tex, shotSky.assetId);
                else environmentLight.clearIbl();
            } else environmentLight.clearIbl();
            // The screenshot draws each shadow map with its own visibility, and the next applied frame draws each again (R26).
            sceneLights.markShadows(new Set(shadowState?.frame.lights.keys()));
            shadowForce = true;
            let png: Uint8Array;
            try { png = await outsideFrame(() => renderScreenshot({ renderer, backend, scene, camera: shotCamera, show, antiAliasing: entity.antiAliasing ?? "none", msaaSamples: quality.msaaSamples, haze: shotHaze, grading: entity.grading ?? null, beams: shotBeams, effects: shotEffects, look: shotLook })); }
            finally { restoreSky(scene, shotSavedSky); environmentLight.clearIbl(); lease?.release(); }
            if (disposed) throw failure("CANCELLED", "Renderer disposed");
            if (png.byteLength > LIMITS.screenshotPngBytes) throw failure("INVALID_INPUT", "Screenshot PNG exceeds 8 MiB");
            return { sessionId: frame.sessionId, revision: expectedRevision, cameraId, width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT, png };
        });
    };
    return { screenshot, ...(editor ? { editor: { sync: editor.sync, cancel: editor.cancel } } : {}), diagnostics(rendererEpoch) {
        if (!options.diagnostics || !displayed || disposed) return null;
        return {sessionId: displayed.sessionId, outputId: displayed.outputId, rendererEpoch, sequence: displayed.sequence, revision: displayed.revision, backend, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, liveMaterials: countLiveMaterials(marker ? [scene,marker.scene] : [scene]), assetCacheEntries: assets.size(), ...queue.snapshot(), ...(decoderSupport ? { videoDecoder: decoderSupport } : {}), gpuTimer: timerSupport};
    },
    onLoadStatus(listener) { loadListeners.add(listener); listener(jobs.status()); return () => { loadListeners.delete(listener); }; },
    modelInfo: assetId => debugs.get(assetId) ?? null,
    dismissLoad(entityId) { jobs.dismiss(entityId); },
    pauseVideos() { for (const value of objects.values()) value.video?.pause(); captures.pause(); },
    videoDecoder: () => decoderSupport,
    decoderReport(rendererEpoch) {
        if (!displayed || disposed || decoderSupport === null) return null;
        return {sessionId: displayed.sessionId, outputId: displayed.outputId, rendererEpoch, sequence: displayed.sequence, revision: displayed.revision, backend, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, liveMaterials: countLiveMaterials(marker ? [scene,marker.scene] : [scene]), assetCacheEntries: assets.size(), ...queue.snapshot(), videoDecoder: decoderSupport, gpuTimer: timerSupport};
    },
    captureSockets: () => captures.sockets(),
    videoSettled(entityId) { const player = objects.get(entityId)?.video; return player ? player.settled() : Promise.reject(failure("NOT_FOUND", "Video not loaded", [entityId])); },
    applyFrame(raw) { const frame = RuntimeFrameSchema.parse(raw); const selected = selectFrame(accepted, frame); if (!selected.ok)
            return Promise.reject(failure(selected.error.code, selected.error.message)); accepted = frame; return queue.enqueue("frame", () => submit(frame)); }, capture() { return queue.enqueue("capture", async () => { policy.reserve(performance.now()); if (!displayed || !displayFrame)
            throw failure("UNAVAILABLE", "No displayed frame"); const metadata = structuredClone(displayed); const frame = displayFrame; await outsideFrame(() => submit(frame, false)); const png = await readPng(options.canvas); policy.checkBytes(png.byteLength); return { frame: metadata, png, width: options.canvas.width, height: options.canvas.height }; }); }, dispose() { if (disposed)
            return; disposed = true; for (const waiter of [...revisionWaiters]) waiter.cancel(); editor?.dispose(); queue.dispose(); } };
}
function springClock(frame: RuntimeFrame, avatarId: Id): SpringClock {
    return { sessionId: frame.sessionId, tick: frame.tick, elapsedMs: frame.elapsedMs, resets: frame.springResets?.find(entry => entry.avatarId === avatarId)?.count ?? 0 };
}
// The box of the meshes of `root` from their geometry boxes (the rest pose of a skinned mesh), in world space or in the space of `root`.
function meshBounds(root: Object3D, local: boolean): Box3 {
    root.updateMatrixWorld(true);
    const box = new Box3(), part = new Box3(), matrix = new Matrix4(), toLocal = local ? new Matrix4().copy(root.matrixWorld).invert() : null;
    root.traverse(object => {
        const mesh = object as Mesh & { isInstancedMesh?: boolean; boundingBox?: Box3 | null; computeBoundingBox?: () => void };
        if (!mesh.isMesh) return;
        // An instanced mesh has its own box that holds every instance.
        if (mesh.isInstancedMesh && !mesh.boundingBox) mesh.computeBoundingBox!();
        if (!mesh.isInstancedMesh && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        part.copy(mesh.isInstancedMesh ? mesh.boundingBox! : mesh.geometry.boundingBox!).applyMatrix4(toLocal ? matrix.multiplyMatrices(toLocal, mesh.matrixWorld) : mesh.matrixWorld);
        box.union(part);
    });
    return box;
}
const maxScale = (object: Object3D) => Math.max(Math.abs(object.scale.x), Math.abs(object.scale.y), Math.abs(object.scale.z));
function applyTransform(object: Object3D, entity: SceneEntity) { object.position.fromArray(entity.transform.position); object.quaternion.fromArray(entity.transform.rotation); object.scale.fromArray(entity.transform.scale); object.visible = entity.visible; object.updateMatrixWorld(true); }
function disposeInstance(root: Object3D) { root.traverse(object => { const skeleton = (object as import("three/webgpu").SkinnedMesh).skeleton; if (skeleton)
    skeleton.dispose(); }); }
