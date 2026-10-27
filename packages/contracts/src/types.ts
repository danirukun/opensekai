import type {AvatarIdle,AvatarTracking,TrackingConfig,TrackingSmoothing,TrackingCalibration,TrackingMapping,AvatarPose,TrackingStatus,TrackingUpdate,TrackingProbe,TrackingProbeParams} from './tracking';
import type { BlueprintBatch } from './blueprint-ops';
import type { BlueprintInspect, InputUpdate } from './schema';
import type { BlueprintDebug } from './blueprint-debug';
import type { ShowDocument } from './show';
import type { DeviceKind } from './devices';
import type { ScalarValue } from './blueprint-values';
import type { CameraAntiAliasing, OutputFrameLimit, OutputRenderScale, QualityProfileId } from './quality';
import type { AvatarRig, VmcPosesEnvelope, VmcSenderSettings, VmcSenderStatus } from './vmc-sender';
import type { ArkitName, AssetExpression, ExpressionSettings, ExpressionState } from './expressions';
export type Id = string;
export type Vec3 = [
    number,
    number,
    number
];
export type Quat = [
    number,
    number,
    number,
    number
];
export type Backend = "webgpu" | "webgl2";
export type Capability = "read" | "edit" | "capture" | "benchmark";
export type ErrorCode = "INVALID_INPUT" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE" | "NOT_FOUND" | "UNSUPPORTED" | "TIMEOUT" | "RATE_LIMITED" | "BUSY" | "CANCELLED" | "VERSION_MISMATCH" | "STALE_FRAME";
export interface AppError {
    code: ErrorCode;
    message: string;
    ids: Id[];
}
export type Reply<T> = {
    ok: true;
    data: T;
} | {
    ok: false;
    error: AppError;
};
export interface Transform {
    position: Vec3;
    rotation: Quat;
    scale: Vec3;
}
export interface EntityBase {
    id: Id;
    name: string;
    visible: boolean;
    transform: Transform;
}
export type SceneEntity = (EntityBase & {
    kind: "mesh";
    source: {
        kind: "box";
    } | {
        kind: "asset";
        assetId: Id;
    };
}) | (EntityBase & {
    kind: "avatar";
    assetId: Id | null;
    tracking?: AvatarTracking;
    idleAnimation?: AvatarIdle;
    expressions?: Record<string, ExpressionSettings>;
}) | (EntityBase & {
    kind: "tracking";
    config: TrackingConfig;
    smoothing?: TrackingSmoothing;
    calibration?: TrackingCalibration;
    mapping?: TrackingMapping;
    generation: number;
}) | (EntityBase & {
    kind: "environment";
    assetId: Id | null;
    reflectionsIntensity?: number;
}) | (EntityBase & {
    kind: "light";
    light: LightSettings;
}) | (EntityBase & {
    kind: "haze";
    haze: HazeSettings;
}) | (EntityBase & {
    kind: "fpsCounter";
    fpsCounter: FpsCounterSettings;
}) | (EntityBase & {
    kind: "vmcSender";
    vmcSender: VmcSenderSettings;
}) | (EntityBase & {
    kind: "camera";
    renderEnvironment?: boolean;
    antiAliasing?: CameraAntiAliasing;
    navigation?: CameraNavigation;
    lens: {
        fovDegrees: number;
        near: number;
        far: number;
    };
});
export interface LightShadow { enabled: boolean; intensity: number; soft: boolean; bias: number; normalBias: number; }
export interface LightCone { angleDegrees: number; penumbra: number; }
export interface LightSettings { type: "directional" | "point" | "spot" | "ambient"; color: string; intensity: number; range: number; affectCharacters: boolean; affectProps: boolean; affectEnvironment: boolean; shadow: LightShadow; cone?: LightCone; volumetric?: boolean; }
export interface HazeSettings { density: number; smoke: number; intensity: number; drift: number; }
export type FpsCounterCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export interface FpsCounterSettings { corner: FpsCounterCorner; size: number; color: string; }
export type CameraNavigation = { mode: "none" } | { mode: "freeLook"; sensitivity: number } | { mode: "orbitCharacter"; sensitivity: number; targetId: Id | null; pivotOffset: Vec3 };
export interface CameraScreenshotParams { cameraId: Id; expectedRevision: number; }
export interface CameraScreenshotResult { fileName: string; width: 1920; height: 1080; bytes: number; sha256: string; cameraId: Id; revision: number; }
export interface ScreenshotBytes { sessionId: Id; revision: number; cameraId: Id; width: 1920; height: 1080; png: Uint8Array; }
export interface OutputSpec {
    id: Id;
    cameraId: Id;
    width: number;
    height: number;
    fps: OutputFrameLimit;
    renderScale?: OutputRenderScale;
}
export interface SceneView {
    schemaVersion: 1;
    sceneId: Id;
    revision: number;
    entities: SceneEntity[];
    outputs: OutputSpec[];
}
type ExistingPatchOp = {
    kind: "setTransform";
    entityId: Id;
    transform: Transform;
} | {
    kind: "setVisibility";
    entityId: Id;
    visible: boolean;
};
export type LivePatchOp = {kind:'setTrackingSmoothing';entityId:Id;smoothing:TrackingSmoothing}|{kind:'calibrateTracking';entityId:Id}|{kind:'fitBlendShapeRanges';entityId:Id;neutral:Partial<Record<ArkitName,number>>}|{kind:'setTrackingCalibration';entityId:Id;calibration:TrackingCalibration|null}|{kind:'setTrackingMapping';entityId:Id;mapping:TrackingMapping}| {kind:'setAvatarIdle';entityId:Id;idleAnimation:AvatarIdle}|{kind:'createEntity';entity:SceneEntity}|{kind:'setCameraLens';entityId:Id;lens:Extract<SceneEntity,{kind:'camera'}>['lens']}|{kind:'setAvatarTracking';entityId:Id;tracking:AvatarTracking}|{kind:'setTrackingConfig';entityId:Id;config:TrackingConfig}|{kind:'setAvatarModel';entityId:Id;assetId:Id|null}|{kind:'setEnvironmentModel';entityId:Id;assetId:Id|null}|{kind:'setEnvironmentReflections';entityId:Id;reflectionsIntensity:number}|{kind:'setLight';entityId:Id;light:LightSettings}|{kind:'setHaze';entityId:Id;haze:HazeSettings}|{kind:'setFpsCounter';entityId:Id;fpsCounter:FpsCounterSettings}|{kind:'setVmcSender';entityId:Id;vmcSender:VmcSenderSettings}|{kind:'setCameraRenderEnvironment';entityId:Id;renderEnvironment:boolean}|{kind:'setCameraAntiAliasing';entityId:Id;antiAliasing:CameraAntiAliasing}|{kind:'setCameraNavigation';entityId:Id;navigation:CameraNavigation}|{kind:'setAvatarExpression';entityId:Id;name:string;settings:ExpressionSettings|null};
export type AssetManagementPatchOp = {kind:'renameEntity';entityId:Id;name:string}|{kind:'removeEntity';entityId:Id};
export type OutputPatchOp = {kind:'setOutputFormat';outputId:Id;width:number;height:number;fps:OutputFrameLimit;renderScale:OutputRenderScale};
export type PatchOp = ExistingPatchOp | LivePatchOp | AssetManagementPatchOp | OutputPatchOp;
export interface ScenePatch {
    sceneId: Id;
    expectedRevision: number;
    operations: PatchOp[];
}
export interface AssetCredits { title: string | null; author: string | null; license: string | null; sourceUrl: string | null; }
export interface AssetRecord {
    id: Id;
    format: "glb" | "vrm";
    sha256: string;
    bytes: number;
    sourceUrl: string | null;
    licenseLabel: string;
    importerVersion: 1;
    name: string;
    credits?: AssetCredits;
    expressions: AssetExpression[];
    eyeBones?: boolean;
    rig?: AvatarRig;
}
export interface AssetSummary { id: Id; kind: "avatar" | "scene" | "fixture"; name: string; credits?: AssetCredits; }
export interface AssetList { assets: AssetSummary[]; next: Id | null; }
export interface ConnectionDescriptor {
    schemaVersion: 1;
    sessionId: Id;
    httpOrigin: string;
    wsUrl: string;
    role: "publisher" | "operator" | "renderer";
    token: string;
    capabilities: Capability[];
    outputId: Id | null;
}
export interface RuntimeFrame {
    schemaVersion: 1;
    sessionId: Id;
    sequence: number;
    tick: number;
    elapsedMs: number;
    scene: SceneView;
    avatarPoses?: AvatarPose[];
    trackingStatus?: TrackingStatus[];
    blueprintRevision?: number;
}
export interface FrameApplied {
    outputId: Id;
    sessionId: Id;
    sequence: number;
    tick: number;
    revision: number;
    cameraId: Id;
    backend: Backend;
    cpuMs: number;
    gpuMs: number | null;
    warnings: AppError[];
    qualityProfile?: QualityProfileId;
}
export interface RendererDiagnostics {
 sessionId: Id; outputId: Id; rendererEpoch: Id; sequence: number; revision: number; backend: Backend;
 geometries: number; textures: number; liveMaterials: number; assetCacheEntries: number;
 activeRenderJob: boolean; queuedFrames: number; queuedCaptures: number;
}
export interface AppStatus {
    blueprintRevision?: number;
    localAddresses?: string[];
    trackingStatus?: TrackingStatus[];
    vmcSenders?: VmcSenderStatus[];
    schemaVersion: 1;
    sessionId: Id;
    ready: boolean;
    revision: number | null;
    capabilities: Capability[];
    warnings: AppError[];
    outputs: {
        outputId: Id;
        connected: boolean;
        lastFrame: FrameApplied | null;
    }[];
}
export interface CaptureParams {
    outputId: Id;
    expectedRevision: number;
    preset: "diagnostic_v1";
    maxAgeMs: 500;
}
export interface CaptureRecord {
    id: Id;
    outputId: Id;
    revision: number;
    tick: number;
    sequence: number;
    backend: Backend;
    cameraId: Id;
    width: number;
    height: number;
    mimeType: "image/png";
    bytes: number;
    sha256: string;
    resourceUri: string;
    createdAtUtc: string;
}
export interface BenchmarkParams {
    requestId: Id;
    fixtureId: "smoke_v1";
    profileId: "webgpu_smoke_v1" | "webgl2_smoke_v1";
}
export interface BenchmarkRun {
    id: Id;
    state: "warming" | "measuring" | "complete" | "cancelled" | "failed";
    progress: number;
    summaryResourceUri: string | null;
    error: ErrorCode | null;
}
export interface EvidenceManifest {
    id: Id;
    kind: "capture" | "benchmark";
    sessionId: Id;
    fixtureId: "smoke_v1";
    appCommit: string;
    resources: {
        uri: string;
        mimeType: string;
        sha256: string;
        bytes: number;
    }[];
}
export interface AppApi {
    appStatus(params: Record<string, never>): Promise<Reply<AppStatus>>;
    sceneInspect(params: {
        sceneId: Id;
    }): Promise<Reply<SceneView>>;
    scenePatch(params: ScenePatch): Promise<Reply<{
        revision: number;
    }>>;
    sceneReplace(params: { scene: ShowDocument['scene']; expectedRevision: number }): Promise<Reply<SceneView>>;
    cameraSelect(params: {
        outputId: Id;
        cameraId: Id;
        expectedRevision: number;
    }): Promise<Reply<{
        revision: number;
    }>>;
    blueprintRun(params: { graphId: Id; triggerNodeId: Id } | { event: string; payload?: ScalarValue }): Promise<Reply<{ revision: number }>>;
    blueprintEdit(params: BlueprintBatch): Promise<Reply<{ revision: number; keystrokes: string[]; heldKeys?: string[]; devices?: DeviceKind[] }>>;
    blueprintInspect(params: { sinceRevision?: number }): Promise<Reply<BlueprintInspect>>;
    blueprintDebug(params: { since?: number }): Promise<Reply<BlueprintDebug>>;
    trackingProbe(params: TrackingProbeParams): Promise<Reply<TrackingProbe>>;
    captureFrame(params: CaptureParams): Promise<Reply<CaptureRecord>>;
    benchmarkStart(params: BenchmarkParams): Promise<Reply<BenchmarkRun>>;
    benchmarkStatus(params: {
        runId: Id;
    }): Promise<Reply<BenchmarkRun>>;
    benchmarkCancel(params: {
        runId: Id;
    }): Promise<Reply<BenchmarkRun>>;
    evidenceRead(params: {
        evidenceId: Id;
    }): Promise<Reply<EvidenceManifest>>;
    assetList(params: { after?: Id }): Promise<Reply<AssetList>>;
    expressionGet(params: { avatarId: Id }): Promise<Reply<ExpressionState>>;
    expressionSet(params: { avatarId: Id; name: string; active: boolean }): Promise<Reply<ExpressionState>>;
    cameraScreenshot(params: CameraScreenshotParams): Promise<Reply<CameraScreenshotResult>>;
}
export interface CaptureBytes {
    frame: FrameApplied;
    png: Uint8Array;
    width: number;
    height: number;
}
export interface DiagnosticMarker {
    sessionTag: number;
    sequence: number;
    tick: number;
    revision: number;
    cameraTag: number;
}
export interface Call {
    kind: "call";
    requestId: Id;
    method: keyof AppApi;
    params: unknown;
}
export type ValidatedCall = {
    [Method in keyof AppApi]: {
        method: Method;
        params: Parameters<AppApi[Method]>[0];
    };
}[keyof AppApi];
export interface PublisherClient {
    onClock(listener: (elapsedMs: number, tracking?: TrackingUpdate, input?: InputUpdate) => void): () => void;
    onCall(listener: (call: ValidatedCall & {
        requestId: Id;
    }) => Promise<Reply<unknown>>): () => void;
    publishFrame(frame: RuntimeFrame): void;
    // The poses of the enabled VMC senders, after the frame of the same tick. The host never relays them.
    publishVmcPoses?(envelope: VmcPosesEnvelope): void;
    close(): void;
}
export interface BrowserClient extends ResourceHost {
    api: AppApi;
    onFrame(listener: (frame: RuntimeFrame) => void): () => void;
    sendApplied(frame: FrameApplied): void;
    sendDiagnostics?(diagnostics: RendererDiagnostics): void;
    onCapture(listener: (params: CaptureParams) => Promise<Reply<CaptureBytes>>): () => void;
    onScreenshot(listener: (params: CameraScreenshotParams) => Promise<Reply<ScreenshotBytes>>): () => void;
    readResource(uri: string): Promise<Uint8Array>;
    close(): void;
}
export interface ResourceHost {
    readAsset(assetId: Id, onProgress?: (loaded: number, total: number | null) => void): Promise<ArrayBuffer>;
}
