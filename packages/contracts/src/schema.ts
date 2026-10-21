import {TrackingConfigSchema,TrackingSmoothingSchema,TrackingCalibrationSchema,TrackingMappingSchema,AvatarIdleSchema,AvatarTrackingSchema,AvatarPoseSchema,TrackingStatusSchema,TrackingUpdateSchema} from './tracking';
import { BlueprintGraphSchema, BlueprintSetSchema } from './blueprint';
import { BlueprintBatchSchema } from './blueprint-ops';
import { BlueprintDebugParamsSchema, BlueprintDebugSchema } from './blueprint-debug';
import { KEYSTROKE_CODES } from './blueprint-nodes';
import { DeviceKindListSchema, DeviceUpdateSchema } from './devices';
import { ScalarValueSchema } from './blueprint-values';
import { z } from "zod";
import { CameraAntiAliasingSchema, QualityProfileIdSchema } from './quality';
import { AssetExpressionsSchema, AvatarExpressionsSchema, ExpressionNameSchema, ExpressionSettingsSchema, ExpressionStateSchema } from './expressions';
import type { AppApi, Capability, Reply, ValidatedCall } from "./types";
export const LIMITS = {
    jsonBytes: 262144,
    diagnosticsBytes: 2048,
    clockBytes: 2048,
    trackingClockBytes: 65536,
    captureEnvelopeBytes: 3145728,
    pngBytes: 2097152,
    pendingCalls: 32,
    queuedFrames: 2,
    rpcTimeoutMs: 2000,
    screenshotPngBytes: 8388608,
    screenshotEnvelopeBytes: 12582912,
    screenshotTimeoutMs: 5000,
    cameras: 8,
    lights: 8,
    shadowLights: 2,
    hazes: 1,
    fpsCounters: 1
} as const;
export const IdSchema = z.string().min(1).max(256);
const n = z.number().finite(), u = n.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const Vec3Schema = z.tuple([
    n,
    n,
    n
]);
export const QuatSchema = z.tuple([
    n,
    n,
    n,
    n
]).refine(q => Math.abs(Math.hypot(...q) - 1) <= 0.001);
export const BackendSchema = z.enum([
    "webgpu",
    "webgl2"
]);
export const CapabilitySchema = z.enum([
    "read",
    "edit",
    "capture",
    "benchmark"
]);
export const CapabilitiesSchema = z.array(CapabilitySchema).refine(values => new Set(values).size === values.length, "Duplicate capabilities");
export const ErrorCodeSchema = z.enum([
    "INVALID_INPUT",
    "CONFLICT",
    "FORBIDDEN",
    "UNAVAILABLE",
    "NOT_FOUND",
    "UNSUPPORTED",
    "TIMEOUT",
    "RATE_LIMITED",
    "BUSY",
    "CANCELLED",
    "VERSION_MISMATCH",
    "STALE_FRAME"
]);
export const AppErrorSchema = z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    ids: z.array(IdSchema)
});
export const replySchema = <T extends z.ZodType>(data: T) => z.union([
    z.strictObject({
        ok: z.literal(true),
        data
    }),
    z.strictObject({
        ok: z.literal(false),
        error: AppErrorSchema
    })
]);
export const TransformSchema = z.strictObject({
    position: Vec3Schema,
    rotation: QuatSchema,
    scale: z.tuple([
        n.positive(),
        n.positive(),
        n.positive()
    ])
});
export const EntityBaseSchema = z.strictObject({
    id: IdSchema,
    name: z.string(),
    visible: z.boolean(),
    transform: TransformSchema
});
export const LensSchema = z.strictObject({
    fovDegrees: n.min(1).max(179),
    near: n.positive(),
    far: n.positive()
}).refine(l => l.far > l.near);
// Warudo Control Mode. A missing field means `none`, so an old show does not change.
export const CameraNavigationSchema = z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("none") }),
    z.strictObject({ mode: z.literal("freeLook"), sensitivity: n.min(0.1).max(10) }),
    z.strictObject({
        mode: z.literal("orbitCharacter"),
        sensitivity: n.min(0.1).max(10),
        targetId: IdSchema.nullable(),
        pivotOffset: z.tuple([n.min(-1000).max(1000), n.min(-1000).max(1000), n.min(-1000).max(1000)])
    })
]);
export const LightColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export const LightShadowSchema = z.strictObject({
    enabled: z.boolean(),
    intensity: n.min(0).max(1),
    soft: z.boolean(),
    bias: n.min(-0.01).max(0.01),
    normalBias: n.min(0).max(1)
});
// The full cone angle in degrees, as Warudo and Unity show it (B13 R1).
export const LightConeSchema = z.strictObject({
    angleDegrees: n.min(1).max(170),
    penumbra: n.min(0).max(1)
});
export const LightSettingsSchema = z.strictObject({
    type: z.enum(["directional", "point", "spot", "ambient"]),
    color: LightColorSchema,
    intensity: n.min(0).max(1000),
    range: n.min(0).max(1000),
    affectCharacters: z.boolean(),
    affectProps: z.boolean(),
    affectEnvironment: z.boolean(),
    shadow: LightShadowSchema,
    cone: LightConeSchema.optional(),
    volumetric: z.boolean().optional()
}).refine(l => l.type !== "spot" || l.cone !== undefined, "A spot light needs a cone")
    .refine(l => l.type !== "ambient" || !l.shadow.enabled, "An ambient light has no shadow")
    .refine(l => l.volumetric !== true || l.type === "point" || l.type === "spot", "Only point and spot lights scatter in haze");
export const HazeSettingsSchema = z.strictObject({
    density: n.min(0).max(2),
    smoke: n.min(0).max(3),
    intensity: n.min(0).max(4),
    drift: n.min(0).max(2)
});
export const FpsCounterCornerSchema = z.enum(["topLeft", "topRight", "bottomLeft", "bottomRight"]);
// Size is in pixels of a 1080-pixel output (B19 R1).
export const FpsCounterSettingsSchema = z.strictObject({
    corner: FpsCounterCornerSchema,
    size: n.int().min(8).max(128),
    color: LightColorSchema
});
export const ReflectionsIntensitySchema = n.min(0).max(2);
export const SceneEntitySchema = z.discriminatedUnion("kind", [
    EntityBaseSchema.extend({
        kind: z.literal("mesh"),
        source: z.discriminatedUnion("kind", [
            z.strictObject({
                kind: z.literal("box")
            }),
            z.strictObject({
                kind: z.literal("asset"),
                assetId: IdSchema
            })
        ])
    }),
    EntityBaseSchema.extend({
        kind: z.literal("avatar"),
        assetId: IdSchema.nullable(),
        tracking: AvatarTrackingSchema.optional(),
        idleAnimation: AvatarIdleSchema.optional(),
        expressions: AvatarExpressionsSchema.optional()
    }),
    EntityBaseSchema.extend({kind:z.literal('tracking'),config:TrackingConfigSchema,generation:u,smoothing:TrackingSmoothingSchema.optional(),calibration:TrackingCalibrationSchema.optional(),mapping:TrackingMappingSchema.optional()}),
    EntityBaseSchema.extend({
        kind: z.literal("environment"),
        assetId: IdSchema.nullable(),
        reflectionsIntensity: ReflectionsIntensitySchema.optional()
    }),
    EntityBaseSchema.extend({
        kind: z.literal("light"),
        light: LightSettingsSchema
    }),
    EntityBaseSchema.extend({
        kind: z.literal("haze"),
        haze: HazeSettingsSchema
    }),
    EntityBaseSchema.extend({
        kind: z.literal("fpsCounter"),
        fpsCounter: FpsCounterSettingsSchema
    }),
    EntityBaseSchema.extend({
        kind: z.literal("camera"),
        lens: LensSchema,
        renderEnvironment: z.boolean().optional(),
        antiAliasing: CameraAntiAliasingSchema.optional(),
        navigation: CameraNavigationSchema.optional()
    })
]);
export const OutputSpecSchema = z.strictObject({
    id: IdSchema,
    cameraId: IdSchema,
    width: z.literal(1920),
    height: z.literal(1080),
    fps: z.literal(60)
});
export const SceneViewSchema = z.strictObject({
    schemaVersion: z.literal(1),
    sceneId: IdSchema,
    revision: u,
    entities: z.array(SceneEntitySchema).max(64),
    outputs: z.array(OutputSpecSchema).max(64)
}).refine(s => {
 const sources=s.entities.filter(e=>e.kind==='tracking');
 if(s.entities.filter(e=>e.kind==='environment').length>1)return false;
 if(sources.length>4||s.entities.filter(e=>e.kind==='avatar').length>2||s.entities.filter(e=>e.kind==='camera').length>LIMITS.cameras)return false;
 const lights=s.entities.filter(e=>e.kind==='light');
 if(lights.length>LIMITS.lights||lights.filter(e=>e.light.shadow.enabled).length>LIMITS.shadowLights)return false;
 if(s.entities.filter(e=>e.kind==='haze').length>LIMITS.hazes)return false;
 if(s.entities.filter(e=>e.kind==='fpsCounter').length>LIMITS.fpsCounters)return false;
 if(!s.entities.every(e=>{if(e.kind!=='camera'||e.navigation?.mode!=='orbitCharacter')return true;const target=e.navigation.targetId;return target===null||s.entities.some(a=>a.id===target&&a.kind==='avatar');}))return false;
 if(new Set(s.entities.map(e=>e.id)).size!==s.entities.length||new Set(s.outputs.map(o=>o.id)).size!==s.outputs.length||!s.outputs.every(o=>s.entities.some(e=>e.id===o.cameraId&&e.kind==='camera')))return false;
 // Only the face slot (index 1) accepts an iFacialMocap source.
 return s.entities.every(e=>e.kind!=='avatar'||!e.tracking||[e.tracking.bodySourceId,e.tracking.faceSourceId,e.tracking.fingersSourceId??null].every((id,index)=>id===null||sources.some(source=>source.id===id&&(index===1||source.config.kind!=='ifacialmocap'))));
}, 'Duplicate ID, budget or invalid reference');
export const ShowSceneSchema = SceneViewSchema.refine(scene =>
    ['output_main', 'preview_main'].every(id => scene.outputs.some(output => output.id === id)),
    'Show requires main and preview outputs');
export const ShowDocumentSchema = z.strictObject({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(128),
    scene: ShowSceneSchema,
    blueprints: BlueprintSetSchema
});
export const EntityNameSchema = z.string().trim().min(1).refine(name=>name.length<=128, 'Name is too long');
export const PatchOpSchema = z.discriminatedUnion("kind", [
    z.strictObject({kind:z.literal('renameEntity'),entityId:IdSchema,name:EntityNameSchema}),
    z.strictObject({kind:z.literal('removeEntity'),entityId:IdSchema}),
    z.strictObject({kind:z.literal('setTrackingSmoothing'),entityId:IdSchema,smoothing:TrackingSmoothingSchema}),
    z.strictObject({kind:z.literal('createEntity'),entity:SceneEntitySchema}),
    z.strictObject({kind:z.literal('setCameraLens'),entityId:IdSchema,lens:LensSchema}),
    z.strictObject({kind:z.literal('setAvatarIdle'),entityId:IdSchema,idleAnimation:AvatarIdleSchema}),
    z.strictObject({kind:z.literal('setAvatarTracking'),entityId:IdSchema,tracking:AvatarTrackingSchema}),
    z.strictObject({kind:z.literal('setAvatarModel'),entityId:IdSchema,assetId:IdSchema.nullable()}),
    z.strictObject({kind:z.literal('setEnvironmentModel'),entityId:IdSchema,assetId:IdSchema.nullable()}),
    z.strictObject({kind:z.literal('setEnvironmentReflections'),entityId:IdSchema,reflectionsIntensity:ReflectionsIntensitySchema}),
    z.strictObject({kind:z.literal('setLight'),entityId:IdSchema,light:LightSettingsSchema}),
    z.strictObject({kind:z.literal('setHaze'),entityId:IdSchema,haze:HazeSettingsSchema}),
    z.strictObject({kind:z.literal('setFpsCounter'),entityId:IdSchema,fpsCounter:FpsCounterSettingsSchema}),
    z.strictObject({kind:z.literal('setAvatarExpression'),entityId:IdSchema,name:ExpressionNameSchema,settings:ExpressionSettingsSchema.nullable()}),
    z.strictObject({kind:z.literal('setCameraRenderEnvironment'),entityId:IdSchema,renderEnvironment:z.boolean()}),
    z.strictObject({kind:z.literal('setCameraAntiAliasing'),entityId:IdSchema,antiAliasing:CameraAntiAliasingSchema}),
    z.strictObject({kind:z.literal('setCameraNavigation'),entityId:IdSchema,navigation:CameraNavigationSchema}),
    z.strictObject({kind:z.literal('setTrackingConfig'),entityId:IdSchema,config:TrackingConfigSchema}),
    z.strictObject({kind:z.literal('calibrateTracking'),entityId:IdSchema}),
    z.strictObject({kind:z.literal('setTrackingCalibration'),entityId:IdSchema,calibration:TrackingCalibrationSchema.nullable()}),
    z.strictObject({kind:z.literal('setTrackingMapping'),entityId:IdSchema,mapping:TrackingMappingSchema}),
    z.strictObject({
        kind: z.literal("setTransform"),
        entityId: IdSchema,
        transform: TransformSchema
    }),
    z.strictObject({
        kind: z.literal("setVisibility"),
        entityId: IdSchema,
        visible: z.boolean()
    })
]);
export const ScenePatchSchema = z.strictObject({
    sceneId: IdSchema,
    expectedRevision: u,
    operations: z.array(PatchOpSchema).min(1).max(32)
});
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const creditText = z.string().nullable();
export const AssetCreditsSchema = z.strictObject({
    title: creditText,
    author: creditText,
    license: creditText,
    sourceUrl: z.url().refine(value => /^https?:\/\//.test(value), 'Invalid source URL').nullable()
});
export const AssetRecordSchema = z.strictObject({
    id: IdSchema,
    format: z.enum([
        "glb",
        "vrm"
    ]),
    sha256: sha,
    bytes: u,
    sourceUrl: z.url().nullable(),
    licenseLabel: z.string(),
    importerVersion: z.literal(1),
    name: z.string().refine(name => name.trim().length > 0 && name.length <= 128, 'Invalid asset name'),
    credits: AssetCreditsSchema.optional(),
    expressions: AssetExpressionsSchema
});
// One page of `assetList`: the host answers it from the asset library, in ascending ID order.
export const AssetSummarySchema = z.strictObject({
    id: IdSchema,
    kind: z.enum(['avatar', 'scene', 'fixture']),
    name: z.string().refine(name => name.trim().length > 0 && name.length <= 128, 'Invalid asset name'),
    credits: AssetCreditsSchema.optional()
});
export const AssetListSchema = z.strictObject({
    assets: z.array(AssetSummarySchema).max(64),
    next: IdSchema.nullable()
});
export const ConnectionDescriptorSchema = z.strictObject({
    schemaVersion: z.literal(1),
    sessionId: IdSchema,
    httpOrigin: z.url().refine(v => {
        const x = new URL(v);
        return x.protocol === "http:" && x.hostname === "127.0.0.1" && x.pathname === "/" && !x.search && !x.hash && !x.username && !x.password;
    }),
    wsUrl: z.url().refine(v => {
        const x = new URL(v);
        return x.protocol === "ws:" && x.pathname === "/ws" && x.hostname === "127.0.0.1" && !x.search && !x.hash && !x.username && !x.password;
    }),
    role: z.enum([
        "publisher",
        "operator",
        "renderer"
    ]),
    token: z.string().min(1),
    capabilities: CapabilitiesSchema,
    outputId: IdSchema.nullable()
}).refine(d => new URL(d.wsUrl).host === new URL(d.httpOrigin).host).refine(d => d.role !== "renderer" || (d.outputId !== null && d.capabilities.every(c => c === "read")));
export const RuntimeFrameSchema = z.strictObject({
    schemaVersion: z.literal(1),
    sessionId: IdSchema,
    sequence: u,
    tick: u,
    elapsedMs: n.nonnegative(),
    scene: SceneViewSchema,
    blueprintRevision: u.optional(),
    avatarPoses:z.array(AvatarPoseSchema).max(2).optional(),
    trackingStatus:z.array(TrackingStatusSchema).max(4).refine(values=>new Set(values.map(value=>value.sourceId)).size===values.length).optional()
});
export const FrameAppliedSchema = z.strictObject({
    outputId: IdSchema,
    sessionId: IdSchema,
    sequence: u,
    tick: u,
    revision: u,
    cameraId: IdSchema,
    backend: BackendSchema,
    cpuMs: n.nonnegative(),
    gpuMs: n.nonnegative().nullable(),
    warnings: z.array(AppErrorSchema),
    qualityProfile: QualityProfileIdSchema.optional()
});
const diagnosticCount = u.max(1_000_000);
export const RendererDiagnosticsSchema = z.strictObject({
 sessionId: IdSchema, outputId: IdSchema, rendererEpoch: IdSchema,
 sequence: u, revision: u, backend: BackendSchema,
 geometries: diagnosticCount, textures: diagnosticCount, liveMaterials: diagnosticCount,
 assetCacheEntries: diagnosticCount, activeRenderJob: z.boolean(), queuedFrames: diagnosticCount, queuedCaptures: diagnosticCount,
});
export const DiagnosticsEnvelopeSchema = z.strictObject({ kind: z.literal("diagnostics"), diagnostics: RendererDiagnosticsSchema });
export const AppStatusSchema = z.strictObject({
    blueprintRevision: u.optional(),
    localAddresses: z.array(z.ipv4()).max(8).optional(),
    trackingStatus:z.array(TrackingStatusSchema).max(4).refine(values=>new Set(values.map(value=>value.sourceId)).size===values.length).optional(),
    schemaVersion: z.literal(1),
    sessionId: IdSchema,
    ready: z.boolean(),
    revision: u.nullable(),
    capabilities: CapabilitiesSchema,
    warnings: z.array(AppErrorSchema),
    outputs: z.array(z.strictObject({
        outputId: IdSchema,
        connected: z.boolean(),
        lastFrame: FrameAppliedSchema.nullable()
    }))
});
export const CaptureParamsSchema = z.strictObject({
    outputId: IdSchema,
    expectedRevision: u,
    preset: z.literal("diagnostic_v1"),
    maxAgeMs: z.literal(500)
});
export const CaptureRecordSchema = z.strictObject({
    id: IdSchema,
    outputId: IdSchema,
    revision: u,
    tick: u,
    sequence: u,
    backend: BackendSchema,
    cameraId: IdSchema,
    width: u.positive().max(1920),
    height: u.positive().max(1080),
    mimeType: z.literal("image/png"),
    bytes: u.max(LIMITS.pngBytes),
    sha256: sha,
    resourceUri: z.string().min(1),
    createdAtUtc: z.iso.datetime()
});
export const CameraScreenshotParamsSchema = z.strictObject({
    cameraId: IdSchema,
    expectedRevision: u
});
// `<UTC yyyyMMdd-HHmmss-SSS>-<camera part>[-1..-9].png`. The host makes the name; no client sends a path.
export const ScreenshotFileNameSchema = z.string().regex(/^\d{8}-\d{6}-\d{3}-[A-Za-z0-9_-]{1,64}(?:-[1-9])?\.png$/);
export const CameraScreenshotResultSchema = z.strictObject({
    fileName: ScreenshotFileNameSchema,
    width: z.literal(1920),
    height: z.literal(1080),
    bytes: u.positive().max(LIMITS.screenshotPngBytes),
    sha256: sha,
    cameraId: IdSchema,
    revision: u
});
export const BenchmarkParamsSchema = z.strictObject({
    requestId: IdSchema,
    fixtureId: z.literal("smoke_v1"),
    profileId: z.enum([
        "webgpu_smoke_v1",
        "webgl2_smoke_v1"
    ])
});
export const BenchmarkRunSchema = z.strictObject({
    id: IdSchema,
    state: z.enum([
        "warming",
        "measuring",
        "complete",
        "cancelled",
        "failed"
    ]),
    progress: n.min(0).max(1),
    summaryResourceUri: z.string().nullable(),
    error: ErrorCodeSchema.nullable()
});
export const EvidenceManifestSchema = z.strictObject({
    id: IdSchema,
    kind: z.enum([
        "capture",
        "benchmark"
    ]),
    sessionId: IdSchema,
    fixtureId: z.literal("smoke_v1"),
    appCommit: z.string(),
    resources: z.array(z.strictObject({
        uri: z.string(),
        mimeType: z.string(),
        sha256: sha,
        bytes: u
    }))
});
export const DiagnosticMarkerSchema = z.strictObject({
    sessionTag: u.max(4294967295),
    sequence: u.max(4294967295),
    tick: u.max(4294967295),
    revision: u.max(4294967295),
    cameraTag: u.max(4294967295)
});
export const CaptureBytesSchema = z.strictObject({
    frame: FrameAppliedSchema,
    png: z.instanceof(Uint8Array).refine(p => p.byteLength <= LIMITS.pngBytes),
    width: u.positive().max(1920),
    height: u.positive().max(1080)
});
export const HeldCodeListSchema = z.array(z.enum(KEYSTROKE_CODES as [string, ...string[]])).min(1).max(16);
export const InputUpdateSchema = z.strictObject({
    events: z.array(z.strictObject({ kind: z.literal('keystroke'), accelerator: z.string().min(1).max(64) })).min(1).max(16).optional(),
    held: HeldCodeListSchema.optional(),
    devices: DeviceUpdateSchema.optional(),
}).refine(update => update.events !== undefined || update.held !== undefined || update.devices !== undefined, 'Input update is empty');
export const BlueprintStatusSchema = z.strictObject({ graphId: IdSchema, kind: z.enum(['compile', 'runtime']), error: AppErrorSchema });
const KeystrokeListSchema = z.array(z.string().min(1).max(64)).max(64);
export const BlueprintInspectSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('snapshot'), revision: u, blueprints: BlueprintSetSchema, errors: z.array(BlueprintStatusSchema).max(16), keystrokes: KeystrokeListSchema.optional(), heldKeys: HeldCodeListSchema.optional(), devices: DeviceKindListSchema.optional() }),
    z.strictObject({ kind: z.literal('delta'), revision: u, batches: z.array(BlueprintBatchSchema.extend({ revision: u })).max(32).refine(batches => batches.every(b => b.ops.every(op => op.kind !== 'replaceAll' && op.kind !== 'createGraph')), 'A delta cannot carry replaceAll or createGraph'), errors: z.array(BlueprintStatusSchema).max(16), keystrokes: KeystrokeListSchema.optional(), heldKeys: HeldCodeListSchema.optional(), devices: DeviceKindListSchema.optional() }),
]);
export type InputUpdate = z.infer<typeof InputUpdateSchema>;
export type BlueprintStatus = z.infer<typeof BlueprintStatusSchema>;
export type BlueprintInspect = z.infer<typeof BlueprintInspectSchema>;
export const ParamSchemas = {
    appStatus: z.strictObject({}),
    sceneInspect: z.strictObject({
        sceneId: IdSchema
    }),
    scenePatch: ScenePatchSchema,
    sceneReplace: z.strictObject({ scene: ShowSceneSchema, expectedRevision: u }),
    cameraSelect: z.strictObject({
        outputId: IdSchema,
        cameraId: IdSchema,
        expectedRevision: u
    }),
    // A Manual Trigger (`graphId`, `triggerNodeId`) or a custom event (`event`, optional `payload`). One object, so MCP gets an object schema.
    blueprintRun: z.strictObject({ graphId: IdSchema.optional(), triggerNodeId: IdSchema.optional(), event: z.string().trim().min(1).max(64).optional(), payload: ScalarValueSchema.optional() })
        .refine(p => p.event === undefined ? p.graphId !== undefined && p.triggerNodeId !== undefined && p.payload === undefined : p.graphId === undefined && p.triggerNodeId === undefined, 'Invalid Blueprint run'),
    blueprintEdit: BlueprintBatchSchema,
    blueprintInspect: z.strictObject({ sinceRevision: u.optional() }),
    blueprintDebug: BlueprintDebugParamsSchema,
    captureFrame: CaptureParamsSchema,
    benchmarkStart: BenchmarkParamsSchema,
    benchmarkStatus: z.strictObject({
        runId: IdSchema
    }),
    benchmarkCancel: z.strictObject({
        runId: IdSchema
    }),
    evidenceRead: z.strictObject({
        evidenceId: IdSchema
    }),
    assetList: z.strictObject({ after: IdSchema.optional() }),
    expressionGet: z.strictObject({ avatarId: IdSchema }),
    expressionSet: z.strictObject({ avatarId: IdSchema, name: ExpressionNameSchema, active: z.boolean() }),
    cameraScreenshot: CameraScreenshotParamsSchema
};
export const ResultSchemas = {
    appStatus: AppStatusSchema,
    sceneInspect: SceneViewSchema,
    scenePatch: z.strictObject({
        revision: u
    }),
    sceneReplace: ShowSceneSchema,
    cameraSelect: z.strictObject({
        revision: u
    }),
    blueprintRun: z.strictObject({ revision: u }),
    blueprintEdit: z.strictObject({ revision: u, keystrokes: KeystrokeListSchema, heldKeys: HeldCodeListSchema.optional(), devices: DeviceKindListSchema.optional() }),
    blueprintInspect: BlueprintInspectSchema,
    blueprintDebug: BlueprintDebugSchema,
    captureFrame: CaptureRecordSchema,
    benchmarkStart: BenchmarkRunSchema,
    benchmarkStatus: BenchmarkRunSchema,
    benchmarkCancel: BenchmarkRunSchema,
    evidenceRead: EvidenceManifestSchema,
    assetList: AssetListSchema,
    expressionGet: ExpressionStateSchema,
    expressionSet: ExpressionStateSchema,
    cameraScreenshot: CameraScreenshotResultSchema
};
export const MethodSchema = z.enum([
    "appStatus",
    "sceneInspect",
    "scenePatch",
    "sceneReplace",
    "cameraSelect",
    "blueprintRun",
    "blueprintEdit",
    "blueprintInspect",
    "blueprintDebug",
    "captureFrame",
    "benchmarkStart",
    "benchmarkStatus",
    "benchmarkCancel",
    "evidenceRead",
    "assetList",
    "expressionGet",
    "expressionSet",
    "cameraScreenshot"
]);
export function validateCall(method: unknown, params: unknown): Reply<ValidatedCall> {
    const m = MethodSchema.safeParse(method);
    if (m.success) {
        const p = ParamSchemas[m.data].safeParse(params);
        if (p.success)
            return {
                ok: true,
                data: {
                    method: m.data,
                    params: p.data
                } as ValidatedCall
            };
    }
    return {
        ok: false,
        error: {
            code: "INVALID_INPUT",
            message: "Invalid method or parameters",
            ids: []
        }
    };
}
export function requiredCapability(method: keyof AppApi): Capability {
    if (method === "scenePatch" || method === "sceneReplace" || method === "cameraSelect" || method === "blueprintRun" || method === "blueprintEdit" || method === "expressionSet" || method === "cameraScreenshot")
        return "edit";
    if (method === "captureFrame")
        return "capture";
    if (method.startsWith("benchmark"))
        return "benchmark";
    return "read";
}
export const CallSchema = z.strictObject({
    kind: z.literal("call"),
    requestId: IdSchema,
    method: MethodSchema,
    params: z.unknown()
}).refine(v => validateCall(v.method, v.params).ok);
// A flat character-class test: a grouped base64 pattern overflows the V8 regex stack above about 5 MB,
// and the wire union tests a screenshot reply against the capture reply schema too.
const base64 = (maxBytes: number) => z.string().max(Math.ceil(maxBytes / 3) * 4)
    .refine(v => v.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v))
    .refine(v => v.length * 3 / 4 - (v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0) <= maxBytes);
export const CaptureReplyDataSchema = z.strictObject({
    metadata: z.strictObject({
        frame: FrameAppliedSchema,
        width: u.positive().max(1920),
        height: u.positive().max(1080)
    }),
    pngBase64: base64(LIMITS.pngBytes)
});
export const ScreenshotReplyDataSchema = z.strictObject({
    sessionId: IdSchema,
    revision: u,
    cameraId: IdSchema,
    width: z.literal(1920),
    height: z.literal(1080),
    pngBase64: base64(LIMITS.screenshotPngBytes)
});
export const AuthSchema = z.strictObject({
    kind: z.literal("auth"),
    role: z.enum([
        "publisher",
        "operator",
        "renderer"
    ]),
    token: z.string().min(1),
    schemaVersion: z.literal(1),
    outputId: IdSchema.nullable()
});
export const AuthReplySchema = z.strictObject({
    kind: z.literal("authReply"),
    sessionId: IdSchema,
    schemaVersion: z.literal(1),
    capabilities: CapabilitiesSchema
});
export const ReplyEnvelopeSchema = z.strictObject({
    kind: z.literal("reply"),
    requestId: IdSchema,
    result: replySchema(z.unknown())
});
export const FrameEnvelopeSchema = z.strictObject({
    kind: z.literal("frame"),
    frame: RuntimeFrameSchema
});
export const AppliedEnvelopeSchema = z.strictObject({
    kind: z.literal("applied"),
    frame: FrameAppliedSchema
});
export const CaptureRequestSchema = z.strictObject({
    kind: z.literal("captureRequest"),
    requestId: IdSchema,
    params: CaptureParamsSchema
});
export const CaptureReplySchema = z.strictObject({
    kind: z.literal("captureReply"),
    requestId: IdSchema,
    result: replySchema(CaptureReplyDataSchema)
});
export const ScreenshotRequestSchema = z.strictObject({
    kind: z.literal("screenshotRequest"),
    requestId: IdSchema,
    params: CameraScreenshotParamsSchema
});
export const ScreenshotReplySchema = z.strictObject({
    kind: z.literal("screenshotReply"),
    requestId: IdSchema,
    result: replySchema(ScreenshotReplyDataSchema)
});
export const PingPongSchema = z.strictObject({
    kind: z.enum([
        "ping",
        "pong"
    ]),
    requestId: IdSchema
});
export const ClockEnvelopeSchema = z.object({ kind: z.literal("clock"), sessionId: IdSchema, elapsedMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), tracking:TrackingUpdateSchema.optional(), input: InputUpdateSchema.optional() }).strict();
export const WireMessageSchema = z.union([
    ClockEnvelopeSchema,
    AuthSchema,
    AuthReplySchema,
    CallSchema,
    ReplyEnvelopeSchema,
    FrameEnvelopeSchema,
    AppliedEnvelopeSchema,
    DiagnosticsEnvelopeSchema,
    CaptureRequestSchema,
    CaptureReplySchema,
    ScreenshotRequestSchema,
    ScreenshotReplySchema,
    PingPongSchema
]);
export type WireMessage = z.infer<typeof WireMessageSchema>;
// The byte limit of a clock message (mirrors `clock_byte_limit` in Rust). A clock with tracking or with device input
// uses the large limit: tracking samples, and 32 device events with 4 pads, do not fit the plain limit.
export const clockByteLimit = (clock: { tracking?: unknown; input?: unknown }): number => {
    const devices = typeof clock.input === 'object' && clock.input !== null && 'devices' in clock.input && clock.input.devices !== undefined;
    return clock.tracking !== undefined || devices ? LIMITS.trackingClockBytes : LIMITS.clockBytes;
};
export function parseWire(text: string): WireMessage {
    const value: unknown = JSON.parse(text);
    const capture = typeof value === "object" && value !== null && "kind" in value && value.kind === "captureReply";
    const diagnostics = typeof value === "object" && value !== null && "kind" in value && value.kind === "diagnostics";
    const clock = typeof value === "object" && value !== null && "kind" in value && value.kind === "clock";
    const screenshot = typeof value === "object" && value !== null && "kind" in value && value.kind === "screenshotReply";
    if (new TextEncoder().encode(text).length > (clock ? clockByteLimit(value as { tracking?: unknown; input?: unknown }) : capture ? LIMITS.captureEnvelopeBytes : screenshot ? LIMITS.screenshotEnvelopeBytes : diagnostics ? LIMITS.diagnosticsBytes : LIMITS.jsonBytes))
        throw new Error("Message too large");
    return WireMessageSchema.parse(value);
}
export const publicJsonSchemas = Object.fromEntries(Object.entries({
    Id: IdSchema,
    Vec3: Vec3Schema,
    Quat: QuatSchema,
    Backend: BackendSchema,
    Capability: CapabilitySchema,
    ErrorCode: ErrorCodeSchema,
    AppError: AppErrorSchema,
    Transform: TransformSchema,
    EntityBase: EntityBaseSchema,
    SceneEntity: SceneEntitySchema,
    OutputSpec: OutputSpecSchema,
    SceneView: SceneViewSchema,
    PatchOp: PatchOpSchema,
    ScenePatch: ScenePatchSchema,
    BlueprintGraph: BlueprintGraphSchema,
    AssetRecord: AssetRecordSchema,
    ConnectionDescriptor: ConnectionDescriptorSchema,
    RuntimeFrame: RuntimeFrameSchema,
    FrameApplied: FrameAppliedSchema,
    RendererDiagnostics: RendererDiagnosticsSchema,
    DiagnosticsEnvelope: DiagnosticsEnvelopeSchema,
    AppStatus: AppStatusSchema,
    CaptureParams: CaptureParamsSchema,
    CaptureRecord: CaptureRecordSchema,
    BenchmarkParams: BenchmarkParamsSchema,
    BenchmarkRun: BenchmarkRunSchema,
    EvidenceManifest: EvidenceManifestSchema,
    DiagnosticMarker: DiagnosticMarkerSchema,
    Call: CallSchema,
    CaptureReplyData: CaptureReplyDataSchema,
    WireMessage: WireMessageSchema,
    Auth: AuthSchema,
    AuthReply: AuthReplySchema,
    ReplyEnvelope: ReplyEnvelopeSchema,
    FrameEnvelope: FrameEnvelopeSchema,
    AppliedEnvelope: AppliedEnvelopeSchema,
    CaptureRequest: CaptureRequestSchema,
    CaptureReply: CaptureReplySchema,
    CameraNavigation: CameraNavigationSchema,
    LightSettings: LightSettingsSchema,
    CameraScreenshotParams: CameraScreenshotParamsSchema,
    CameraScreenshotResult: CameraScreenshotResultSchema,
    ScreenshotRequest: ScreenshotRequestSchema,
    ScreenshotReply: ScreenshotReplySchema,
    PingPong: PingPongSchema
}).map(([key, schema]) => [
    key,
    z.toJSONSchema(schema, {
        unrepresentable: "any"
    })
]));
