import type {AvatarIdle,AvatarTracking,TrackingConfig,TrackingSmoothing,AvatarPose,TrackingStatus,TrackingUpdate} from './tracking';
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
    assetId: Id;
    tracking?: AvatarTracking;
    idleAnimation?: AvatarIdle;
}) | (EntityBase & {
    kind: "tracking";
    config: TrackingConfig;
    smoothing?: TrackingSmoothing;
    generation: number;
}) | (EntityBase & {
    kind: "camera";
    lens: {
        fovDegrees: number;
        near: number;
        far: number;
    };
});
export interface OutputSpec {
    id: Id;
    cameraId: Id;
    width: 1920;
    height: 1080;
    fps: 60;
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
export type LivePatchOp = {kind:'setTrackingSmoothing';entityId:Id;smoothing:TrackingSmoothing}| {kind:'setAvatarIdle';entityId:Id;idleAnimation:AvatarIdle}|{kind:'createEntity';entity:SceneEntity}|{kind:'setCameraLens';entityId:Id;lens:Extract<SceneEntity,{kind:'camera'}>['lens']}|{kind:'setAvatarTracking';entityId:Id;tracking:AvatarTracking}|{kind:'setTrackingConfig';entityId:Id;config:TrackingConfig};
export type AssetManagementPatchOp = {kind:'renameEntity';entityId:Id;name:string}|{kind:'removeEntity';entityId:Id};
export type PatchOp = ExistingPatchOp | LivePatchOp | AssetManagementPatchOp;
export interface ScenePatch {
    sceneId: Id;
    expectedRevision: number;
    operations: PatchOp[];
}
export interface AssetRecord {
    id: Id;
    format: "glb" | "vrm";
    sha256: string;
    bytes: number;
    sourceUrl: string | null;
    licenseLabel: string;
    importerVersion: 1;
}
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
}
export interface RendererDiagnostics {
 sessionId: Id; outputId: Id; rendererEpoch: Id; sequence: number; revision: number; backend: Backend;
 geometries: number; textures: number; liveMaterials: number; assetCacheEntries: number;
 activeRenderJob: boolean; queuedFrames: number; queuedCaptures: number;
}
export interface AppStatus {
    trackingStatus?: TrackingStatus[];
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
    cameraSelect(params: {
        outputId: Id;
        cameraId: Id;
        expectedRevision: number;
    }): Promise<Reply<{
        revision: number;
    }>>;
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
    onClock(listener: (elapsedMs: number, tracking?: TrackingUpdate) => void): () => void;
    onCall(listener: (call: ValidatedCall & {
        requestId: Id;
    }) => Promise<Reply<unknown>>): () => void;
    publishFrame(frame: RuntimeFrame): void;
    close(): void;
}
export interface BrowserClient extends ResourceHost {
    api: AppApi;
    onFrame(listener: (frame: RuntimeFrame) => void): () => void;
    sendApplied(frame: FrameApplied): void;
    sendDiagnostics?(diagnostics: RendererDiagnostics): void;
    onCapture(listener: (params: CaptureParams) => Promise<Reply<CaptureBytes>>): () => void;
    readResource(uri: string): Promise<Uint8Array>;
    close(): void;
}
export interface ResourceHost {
    readAsset(assetId: Id): Promise<ArrayBuffer>;
}
