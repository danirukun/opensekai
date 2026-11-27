import { fingerprint, lightBudgetIssue, IdSchema, isOverlayClipEntry, ParamSchemas, ProposalApplyParamsSchema, type ProposalApplyResult, type VmcPosesEnvelope, AssetRecordSchema, type AssetRecord, type ExpressionState, meshList, type MeshList, materialList, type MaterialList, ScenePatchSchema, SceneViewSchema, ShowSceneSchema, type ErrorCode, type Id, type Reply, type RuntimeFrame, type ScenePatch, type SceneView, type TrackingUpdate, type AppError, type InputUpdate, type BlueprintInspect, type AvatarPose, type DeviceKind, type ScalarValue, type BlueprintDebug, type TrackingProbe, type TrackingProbeParams, type TrackingStatus, type ArkitName } from "@opensekai/contracts";
import { createTransformAdapter } from "./ecs";
import {createTrackingComposer} from "./tracking";
import { createBlueprintRuntime, logicKey, type BlueprintEvent, type GraphRun, type StepEnv } from './blueprint-runtime';
import { createBlueprintStore } from './blueprint-store';
import { NO_DEVICES, type DeviceEnv } from './blueprint-eval';
import { createDeviceInput } from './devices';
import { applyEffects, applyOperations } from './scene-ops';
import { captureCalibration } from './tracking-calibration';
import { fitRanges, mergeFit } from './blend-shape-fit';
import { isBoneOffsetEffect, isCharacterLayerEffect, isDebugEffect, isExpressionEffect, isOneShotEffect, isOrbitEffect, isOverrideEffect, isSceneEffect } from './blueprint';
import { createDebugLog } from './debug-log';
import { composeBoneOffsets, EMPTY_BONE_OFFSETS, writeBoneOffset, writeBoneScale, writeBoneTranslation, type BoneOffsets } from './bone-offsets';
import { advanceExpressions, composeExpressions, dropExpressionFades, EMPTY_EXPRESSIONS, expressionOwners, expressionView, reconcileExpressions, setExpression, type ExpressionStates } from './expressions';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, evaluatedEntity, materialKey, resolveMaterialWrite, takeIdle, type OverrideKey, type OverrideLayer } from './overrides';
import { advanceTweens, dropGraphTweens, dropTweens, EMPTY_TWEENS, transitionStart, tweenOwners, tweening, writeOrbit, writeTransitioned, type PropertyLayers, type TransitionEnd, type TweenLayer } from './tweens';
import { advanceBlendShapes, blendShapeOwners, composeBlendShapes, dropGraphBlendShapes, EMPTY_BLEND_SHAPES, setBlendShape, type BlendShapeStates } from './blend-shapes';
import { vmcPosesFor, withSendersStopped } from './vmc-send';
import { dropGraphLookAts, EMPTY_LOOK_AT, lookAtOwners, sceneLookup, setLookAt, stepLookAt, type LookAtStates } from './look-at';
import { advanceSpringResets, type SpringResetState } from './spring-resets';
import { advanceSnowCover, type SnowCoverState } from './snow-cover';
import { applyControls as applyVideoControls, checkControl, isControlOp, reconcilePlayback, screenPlayback, type ControlOp, type VideoPlaybacks } from './video-playback';
import { composeAvatarAnimation, type AnimationRuntimes } from './avatar-animation-compose';
import { advanceOneShots, EMPTY_ONE_SHOTS, startOneShot, type OneShotStates } from './one-shot-overlays';
export interface Session {
    inspect(): SceneView;
    replaceScene(scene: SceneView, expectedRevision: number): Reply<SceneView>;
    applyPatch(patch: ScenePatch): Reply<{
        revision: number;
    }>;
    applyProposal(params: unknown): Reply<ProposalApplyResult>;
    selectCamera(params: {
        outputId: Id;
        cameraId: Id;
        expectedRevision: number;
    }): Reply<{
        revision: number;
    }>;
    ingestTracking(update:TrackingUpdate):Reply<null>;
    // The live ARKit values, run peaks, channels, and state of a tracking source (TRK-23).
    probeTracking(params: TrackingProbeParams): Reply<TrackingProbe>;
    // The run peaks of a source, for the blend shape fit.
    runPeaks(sourceId: string): Partial<Record<ArkitName, number>>;
    advance(elapsedMs: number, trackingNowMs?:number, input?: InputUpdate): RuntimeFrame;
    // The poses of the enabled VMC senders for a frame of this session, or null when no sender qualifies (B21 R8).
    vmcPoses(frame: RuntimeFrame): VmcPosesEnvelope | null;
    editBlueprints(batch: unknown): Reply<{ revision: number; keystrokes: string[]; heldKeys?: string[]; devices?: DeviceKind[]; youtube?: true }>;
    inspectBlueprints(sinceRevision?: number): BlueprintInspect;
    debugBlueprints(since?: number): BlueprintDebug;
    runBlueprint(graphId: Id, triggerNodeId: Id): Reply<{revision: number}>;
    // Delivers a custom event to the On Event nodes of the enabled graphs (slice D R12).
    emitBlueprintEvent(name: string, payload?: ScalarValue): Reply<{revision: number}>;
    setAssetRecords(records: readonly AssetRecord[]): void;
    getExpressions(avatarId: Id): Reply<ExpressionState>;
    meshList(avatarId: Id): Reply<MeshList>;
    materialList(entityId: Id): Reply<MaterialList>;
    setExpression(avatarId: Id, name: string, active: boolean): Reply<ExpressionState>;
}
const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });
const writeKey = (entityId: Id, property: string) => `${entityId}\0${property}`;
// The value of an override entry without its write time and graphs: a write of the value that the layer already holds
// compares equal, also when another run wrote it at the same session time (Editor and MCP fixes R7).
const entryValue = (layer: OverrideLayer, entityId: Id, property: OverrideKey) => {
    const entry = layer.get(entityId)?.get(property);
    return entry ? JSON.stringify([entry.value, entry.followRelative === true]) : null;
};
export function createSession(scene: SceneView, sessionId: Id, assets: readonly AssetRecord[] = []): Session {
    IdSchema.parse(sessionId);
    let persistent: SceneView = withSendersStopped(structuredClone(SceneViewSchema.parse(scene)));
    const adapter = createTransformAdapter(persistent);
    let tracking=createTrackingComposer();
    let overrides: OverrideLayer = EMPTY_OVERRIDES;
    let expressions: ExpressionStates = EMPTY_EXPRESSIONS;
    // Runtime transition state on the session clock: property tweens, blend shape weights, and look-at targets.
    let tweens: TweenLayer = EMPTY_TWEENS;
    let blendShapes: BlendShapeStates = EMPTY_BLEND_SHAPES;
    let lookAts: LookAtStates = EMPTY_LOOK_AT;
    let springResets: SpringResetState = new Map();
    // Snow cover R1: never committed or saved.
    let snowCover: SnowCoverState = null;
    // Transition ends that run on the next clock step: the ends of writes without a tween, and of tweens that reached their end.
    let pendingEnds: readonly TransitionEnd[] = [];
    // Never committed or saved: rebuilt by the Blueprint step of each tick.
    let boneOffsets: BoneOffsets = EMPTY_BONE_OFFSETS;
    let previousPoses = new Map<Id, AvatarPose>();
    let animationRuntimes: AnimationRuntimes = new Map();
    let oneShots: OneShotStates = EMPTY_ONE_SHOTS;
    let records = new Map<Id, AssetRecord>();
    const record = (assetId: Id) => records.get(assetId);
    const storeRecords = (list: readonly AssetRecord[]) => { records = new Map(list.flatMap(item => { const parsed = AssetRecordSchema.safeParse(item); return parsed.success ? [[parsed.data.id, parsed.data] as const] : []; })); };
    storeRecords(assets);
    let elapsed = 0;
    // The tracking clock of the last advance. A capture compares sample age with it (R3).
    let lastTrackingNowMs: number | null = null;
    // The tracking status of the last advance. A probe reports its state.
    let lastTrackingStatus: TrackingStatus[] = [];
    let sequence = 0;
    // The playback of each video screen on the session clock (B29 R11). Never committed or saved.
    let videoPlayback: VideoPlaybacks = reconcilePlayback(new Map(), null, persistent, elapsed);
    function commit(next: SceneView): Reply<{
        revision: number;
    }> {
        if (!Number.isSafeInteger(persistent.revision + 1))
            return failure("INVALID_INPUT", "Revision limit reached");
        next.revision = persistent.revision + 1;
        videoPlayback = reconcilePlayback(videoPlayback, persistent, next, elapsed);
        persistent = next;
        expressions = reconcileExpressions(expressions, persistent);
        return { ok: true, data: { revision: persistent.revision } };
    }
    const runtime = createBlueprintRuntime();
    const store = createBlueprintStore(runtime);
    const runtimeErrors = new Map<Id, AppError>();
    // Log lines, toasts, debug events, and Debug Value values of accepted runs.
    const debugLog = createDebugLog();
    // A failed tween reports here, so a later clean run of its graph does not hide the error. It stays until the graph changes.
    const tweenErrors = new Map<Id, AppError>();
    const errorsForInspect = () => new Map([...tweenErrors, ...runtimeErrors]);
    // The logic of an enabled graph, or null when it is disabled or gone.
    const ownerKey = (graphId: Id) => { const graph = store.active(graphId); return graph?.enabled ? logicKey(graph) : null; };
    const transitionOwners = () => new Set([...tweenOwners(tweens), ...pendingEnds.map(end => end.graphId), ...expressionOwners(expressions), ...blendShapeOwners(blendShapes), ...lookAtOwners(lookAts), ...tweenErrors.keys()]);
    // A graph that is disabled, deleted, or changed stops its transitions, blend shapes, and look-at.
    const dropGraphs = (graphIds: ReadonlySet<Id>) => {
        if (graphIds.size === 0) return;
        tweens = dropGraphTweens(tweens, graphIds);
        pendingEnds = pendingEnds.filter(end => !graphIds.has(end.graphId));
        expressions = dropExpressionFades(expressions, graphIds);
        blendShapes = dropGraphBlendShapes(blendShapes, graphIds);
        lookAts = dropGraphLookAts(lookAts, graphIds);
        for (const id of graphIds) tweenErrors.delete(id);
    };
    const loggedFailures = new Set<string>();
    let failedThisTick = false;
    const logOnce = (error: unknown) => {
        failedThisTick = true;
        const message = error instanceof Error ? error.message : String(error);
        if (loggedFailures.has(message)) return;
        if (loggedFailures.size >= 8) loggedFailures.clear();
        loggedFailures.add(message);
        console.error('Blueprint step failed', error);
    };
    // Each run's effects go onto a scratch copy first, so a run whose effects fail leaves no Flip Flop or delay change behind.
    const devices = createDeviceInput();
    // The device state of the last clock; a manual run reads it too.
    let deviceEnv: DeviceEnv = NO_DEVICES;
    // `written` holds the entity and property keys of the override writes of the accepted runs (`writeKey`).
    const stepBlueprints = (events: BlueprintEvent[], nowMs: number, held: ReadonlySet<string>, transitionEnds: readonly TransitionEnd[] = []): { runs: GraphRun[]; committed: Reply<{ revision: number }>; written: ReadonlySet<string> } => {
        let working: SceneView | null = null;
        const writtenKeys = new Set<string>();
        let layer = overrides;
        let moving = tweens;
        let ends = pendingEnds;
        let faces = reconcileExpressions(expressions, persistent);
        let shots = oneShots;
        let offsets = boneOffsets;
        let shapes = blendShapes;
        let looks = lookAts;
        const env: StepEnv = { held, devices: deviceEnv, scene: () => applyOverrides(working ?? persistent, layer), previousPose: avatarId => previousPoses.get(avatarId) ?? null, trackingStatus: sourceId => { const source = persistent.entities.find(entity => entity.id === sourceId); return source?.kind === 'tracking' ? lastTrackingStatus.find(item => item.sourceId === sourceId && item.generation === source.generation) ?? null : null; }, tickMs: nowMs };
        // `elapsed` is the time of the values that a transition starts from.
        const startMs = transitionStart(nowMs, elapsed);
        const runs = runtime.step(events, nowMs, run => {
            if (run.effects.length === 0) return null;
            const sceneEffects = run.effects.filter(isSceneEffect);
            let scene = working ?? persistent;
            if (sceneEffects.length) { const next = applyEffects(scene, sceneEffects); if (!next.ok) return next.error; scene = next.data; }
            let nextLayers: PropertyLayers = { overrides: layer, tweens: moving, pending: ends };
            const logic = ownerKey(run.graphId);
            // Only a wired On Transition End records an end, so an old graph never meets the end limits.
            const wired = new Set(store.active(run.graphId)?.connections.flatMap(wire => wire.sourcePort === 'transitionEnd' ? [wire.sourceNodeId] : []));
            const keys: string[] = [];
            for (let effect of run.effects) {
                if (!isOverrideEffect(effect) && !isOrbitEffect(effect)) continue;
                // A material write needs the record material of the entity (B38 R24).
                if (effect.kind === 'setMaterial') {
                    const resolved = resolveMaterialWrite(scene, effect, record);
                    if (!resolved.ok) return resolved.error;
                    effect = resolved.data;
                }
                const touched: [Id, OverrideKey][] = effect.kind === 'orbitCamera' ? [[effect.cameraId, 'position'], [effect.cameraId, 'rotation']]
                    : [[effect.entityId, effect.kind === 'setProperty' ? effect.property : effect.kind === 'setMaterial' ? materialKey(effect.parameter, effect.material) : 'position']];
                const before = touched.map(([id, property]) => entryValue(nextLayers.overrides, id, property));
                const nodeId = effect.kind === 'setProperty' || effect.kind === 'orbitCamera' || effect.kind === 'setMaterial' ? effect.nodeId : undefined;
                const end = nodeId !== undefined && logic !== null && wired.has(nodeId) ? { graphId: run.graphId, nodeId, logic } : undefined;
                const written = isOrbitEffect(effect) ? writeOrbit(nextLayers, scene, effect, run.graphId, nowMs, startMs, end) : writeTransitioned(nextLayers, scene, effect, run.graphId, nowMs, startMs, end);
                if (!written.ok) return written.error;
                nextLayers = written.data;
                // Only a write that changed an override entry is a write of the run (R7).
                touched.forEach(([id, property], i) => { if (entryValue(nextLayers.overrides, id, property) !== before[i]) keys.push(writeKey(id, property)); });
            }
            // Expression effects apply only when the scene effects of the same run apply.
            let nextFaces = faces;
            for (const effect of run.effects.filter(isExpressionEffect)) {
                const set = setExpression(nextFaces, scene, record, effect, startMs, run.graphId);
                if (!set.ok) return set.error;
                nextFaces = set.data;
            }
            let nextShots = shots;
            for (const effect of run.effects.filter(isOneShotEffect)) {
                const set = startOneShot(nextShots, scene, record, effect, nowMs);
                if (!set.ok) return set.error;
                nextShots = set.data;
            }
            let nextOffsets = offsets;
            for (const effect of run.effects.filter(isBoneOffsetEffect)) {
                const written = effect.kind === 'offsetBone' ? writeBoneOffset(nextOffsets, scene, effect)
                    : effect.kind === 'offsetBoneTranslation' ? writeBoneTranslation(nextOffsets, scene, effect)
                    : writeBoneScale(nextOffsets, scene, effect);
                if (!written.ok) return written.error;
                nextOffsets = written.data;
            }
            let nextShapes = shapes, nextLooks = looks;
            for (const effect of run.effects.filter(isCharacterLayerEffect)) {
                if (effect.kind === 'setBlendShape') {
                    const set = setBlendShape(nextShapes, scene, record, effect, startMs, run.graphId);
                    if (!set.ok) return set.error;
                    nextShapes = set.data;
                } else {
                    // Look At reads its two entities from the evaluated scene, so it aims at a moving target.
                    const set = setLookAt(nextLooks, entityId => evaluatedEntity(scene, nextLayers.overrides, entityId), effect, startMs, run.graphId);
                    if (!set.ok) return set.error;
                    nextLooks = set.data;
                }
            }
            if (sceneEffects.length) working = scene;
            for (const key of keys) writtenKeys.add(key);
            layer = nextLayers.overrides;
            if (nextLayers.tweens !== moving) tweenErrors.delete(run.graphId);
            moving = nextLayers.tweens;
            ends = nextLayers.pending ?? [];
            faces = nextFaces;
            shots = nextShots;
            offsets = nextOffsets;
            shapes = nextShapes;
            looks = nextLooks;
            return null;
        }, env, transitionEnds);
        overrides = layer;
        tweens = moving;
        pendingEnds = ends;
        expressions = faces;
        oneShots = shots;
        boneOffsets = offsets;
        blendShapes = shapes;
        lookAts = looks;
        for (const run of runs) if (run.error) runtimeErrors.set(run.graphId, run.error); else runtimeErrors.delete(run.graphId);
        const changed = working !== null && JSON.stringify(working) !== JSON.stringify(persistent);
        const committed = changed ? commit(working!) : { ok: true as const, data: { revision: persistent.revision } };
        // Debug output only from runs whose scene changes were committed.
        if (committed.ok) for (const run of runs) if (!run.error) debugLog.record(run.graphId, run.effects.filter(isDebugEffect), run.debug ?? [], nowMs);
        applyControls();
        return { runs, committed, written: writtenKeys };
    };
    // Enable, Disable, and Toggle Blueprint requests of the step become one document edit, as if the editor sent it (slice D R9).
    let controlBatch = 0;
    const applyControls = () => {
        const requests = runtime.takeControlRequests();
        if (requests.length === 0) return;
        const wanted = new Map<Id, boolean>();
        for (const request of requests) {
            const graph = store.active(request.graphId);
            if (!graph) { runtimeErrors.set(request.sourceGraphId, { code: 'NOT_FOUND', message: 'Blueprint not found', ids: [request.graphId] }); continue; }
            const current = wanted.get(request.graphId) ?? graph.enabled;
            wanted.set(request.graphId, request.action === 'toggle' ? !current : request.action === 'enable');
        }
        const ops = [...wanted].filter(([graphId, enabled]) => store.active(graphId)?.enabled !== enabled).map(([graphId, enabled]) => ({ kind: 'updateGraph' as const, graphId, enabled }));
        if (ops.length === 0) return;
        const reply = api.editBlueprints({ clientId: 'opensekai-runtime', batchId: `control-${++controlBatch}`, ops });
        if (!reply.ok) for (const request of requests) runtimeErrors.set(request.sourceGraphId, reply.error);
    };
    // Each tween writes its sample as an override at the session time.
    const stepTweens = (nowMs: number) => {
        const stepped = advanceTweens({ overrides, tweens }, persistent, nowMs);
        ({ overrides, tweens } = stepped.layers);
        pendingEnds = [...pendingEnds, ...stepped.ended];
        for (const failure of stepped.failures) if (ownerKey(failure.graphId) !== null) tweenErrors.set(failure.graphId, failure.error);
    };
    // Overrides with no write for 250 ms go to the persistent scene in one commit. An override under a tween waits for its end.
    // `force` also takes the given keys at once. A failed commit drops the taken overrides and reports each graph that wrote them.
    const commitIdle = (nowMs: number, force: ReadonlySet<string> = new Set()): Reply<{ revision: number }> => {
        const idle = takeIdle(persistent, overrides, nowMs, (entityId, property) => tweening(tweens, entityId, property), (entityId, property) => force.has(writeKey(entityId, property)));
        overrides = idle.remaining;
        if (idle.operations.length === 0) return { ok: true, data: { revision: persistent.revision } };
        const applied = applyOperations(persistent, idle.operations, persistent.revision + 1);
        const committed = applied.ok ? commit(applied.data) : applied;
        if (!committed.ok) for (const graphId of idle.graphIds) runtimeErrors.set(graphId, committed.error);
        return committed;
    };
    // A manual run or a custom event commits the overrides that the runs of its step wrote, before it replies (Editor and MCP fixes R4).
    // The runs of a clock step keep the 250 ms rule (R5).
    const replyAfterStep = (error: AppError | null | undefined, step: ReturnType<typeof stepBlueprints>): Reply<{ revision: number }> => {
        if (error) return { ok: false, error };
        if (!step.committed.ok) return step.committed;
        return commitIdle(elapsed, step.written);
    };
    // A live tracking source that a patch operation reads. It fails when the source is missing, not tracking, changed in the same patch, or has no current sample.
    const liveSample = (id: string, operations: ScenePatch['operations'], context: string) => {
        const source = persistent.entities.find(entity => entity.id === id);
        if (!source) return failure('NOT_FOUND', 'Entity not found', [id]);
        if (source.kind !== 'tracking') return failure('INVALID_INPUT', 'Entity is not a tracking source', [id]);
        if (operations.some(other => (other.kind === 'setTrackingConfig' || other.kind === 'removeEntity') && other.entityId === id)) return failure('INVALID_INPUT', `${context} in a separate patch`, [id]);
        if (lastTrackingNowMs === null) return failure('INVALID_INPUT', 'Session has not started', [id]);
        if (!source.config.enabled) return failure('INVALID_INPUT', 'Tracking source is stopped', [id]);
        const sample = tracking.currentSample(id, lastTrackingNowMs);
        if (!sample || sample.generation !== source.generation) return failure('INVALID_INPUT', 'Tracking source has no current sample', [id]);
        return { ok: true as const, data: { source, sample } };
    };
    // Each calibrateTracking becomes setTrackingCalibration with the current smoothed sample, read against the scene before the patch.
    // Each fitBlendShapeRanges becomes setTrackingMapping with the ranges that the run peaks give.
    const resolveCalibrations = (operations: ScenePatch['operations']): Reply<ScenePatch['operations']> => {
        const resolved: ScenePatch['operations'] = [];
        for (const operation of operations) {
            if (operation.kind !== 'calibrateTracking' && operation.kind !== 'fitBlendShapeRanges') { resolved.push(operation); continue; }
            const id = operation.entityId;
            if (operation.kind === 'fitBlendShapeRanges') {
                const live = liveSample(id, operations, 'Fit');
                if (!live.ok) return live;
                const fitted = fitRanges(operation.neutral, tracking.runPeaks(id));
                if (Object.keys(fitted).length === 0) return failure('INVALID_INPUT', 'No blend shape rose above its neutral', [id]);
                const base = [...resolved].reverse().find((other): other is Extract<typeof other, { kind: 'setTrackingMapping' }> => other.kind === 'setTrackingMapping' && other.entityId === id);
                const current = base ? base.mapping : live.data.source.mapping;
                resolved.push({ kind: 'setTrackingMapping', entityId: id, mapping: mergeFit(current, fitted) });
                continue;
            }
            const live = liveSample(id, operations, 'Calibrate');
            if (!live.ok) return live;
            const calibration = captureCalibration(live.data.sample);
            if (!calibration) return failure('INVALID_INPUT', 'Tracking sample has no calibration bone', [id]);
            resolved.push({ kind: 'setTrackingCalibration', entityId: id, calibration });
        }
        return { ok: true, data: resolved };
    };
    const api: Session = {
        inspect: () => structuredClone(persistent),
        replaceScene(scene, expectedRevision) {
            if (expectedRevision !== persistent.revision) return failure('CONFLICT', 'Scene revision changed');
            const parsed = ShowSceneSchema.safeParse(scene);
            if (!parsed.success) return failure('INVALID_INPUT', lightBudgetIssue(parsed.error) ?? 'Invalid show scene');
            if (!Number.isSafeInteger(persistent.revision + 1)) return failure('INVALID_INPUT', 'Invalid show scene');
            persistent = withSendersStopped(structuredClone({ ...parsed.data, revision: persistent.revision + 1 }));
            tracking = createTrackingComposer();
            lastTrackingStatus = [];
            overrides = EMPTY_OVERRIDES;
            tweens = EMPTY_TWEENS;
            pendingEnds = [];
            tweenErrors.clear();
            expressions = EMPTY_EXPRESSIONS;
            boneOffsets = EMPTY_BONE_OFFSETS;
            blendShapes = EMPTY_BLEND_SHAPES;
            lookAts = EMPTY_LOOK_AT;
            oneShots = EMPTY_ONE_SHOTS;
            previousPoses = new Map();
            animationRuntimes = new Map();
            videoPlayback = reconcilePlayback(new Map(), null, persistent, elapsed);
            snowCover = null;
            return { ok: true, data: structuredClone(persistent) };
        },
        editBlueprints(batch) {
            const before = new Map([...runtimeErrors.keys()].map(id => { const graph = store.active(id); return [id, graph && logicKey(graph)] as const; }));
            const owners = new Map([...transitionOwners()].map(id => [id, ownerKey(id)] as const));
            const reply = store.edit(batch);
            if (reply.ok) debugLog.retainValues((graphId, nodeId) => store.active(graphId)?.nodes.some(node => node.id === nodeId && node.type === 'debug.value') ?? false);
            if (reply.ok) dropGraphs(new Set([...owners].filter(([id, key]) => key === null || ownerKey(id) !== key).map(([id]) => id)));
            if (reply.ok)
                for (const [id, key] of before) {
                    const graph = store.active(id);
                    if (!graph || logicKey(graph) !== key) runtimeErrors.delete(id);
                }
            return reply;
        },
        inspectBlueprints: since => store.inspect(since, errorsForInspect()),
        debugBlueprints: since => debugLog.read(since),
        runBlueprint(graphId, triggerNodeId) {
            const graph = store.active(graphId);
            if (!graph) return failure('NOT_FOUND', 'Blueprint not found', [graphId]);
            if (!graph.enabled) return failure('INVALID_INPUT', 'Blueprint is disabled', [graphId]);
            if (!graph.nodes.some(node => node.id === triggerNodeId && node.type === 'event.manual')) return failure('INVALID_INPUT', 'Manual trigger not found', [triggerNodeId]);
            try {
                const step = stepBlueprints([{ kind: 'manual', graphId, nodeId: triggerNodeId }], elapsed, new Set());
                const own = step.runs.find(run => run.graphId === graphId && run.nodeId === triggerNodeId);
                return replyAfterStep(own?.error, step);
            } catch (error) {
                logOnce(error);
                return failure('INVALID_INPUT', 'Blueprint step failed', [graphId]);
            }
        },
        emitBlueprintEvent(name, payload) {
            if (name.trim().length === 0 || name.length > 64) return failure('INVALID_INPUT', 'Invalid event name');
            try {
                const step = stepBlueprints([{ kind: 'custom', name, payload: payload ?? null }], elapsed, new Set());
                // Only the runs that this event caused, not On Enable or due delays of the same step.
                const delivered = step.runs.find(run => run.external && run.error);
                return replyAfterStep(delivered?.error, step);
            } catch (error) {
                logOnce(error);
                return failure('INVALID_INPUT', 'Blueprint step failed');
            }
        },
        applyPatch(patch) {
            const parsed = ScenePatchSchema.safeParse(patch);
            if (!parsed.success)
                return failure("INVALID_INPUT", "Invalid scene patch");
            const value = parsed.data;
            if (value.sceneId !== persistent.sceneId)
                return failure("NOT_FOUND", "Scene not found", [value.sceneId]);
            // Video control is runtime only: it never commits, and it is checked against the scene that the other operations make (B29 R10).
            const controls = value.operations.filter(isControlOp);
            const sceneOperations = value.operations.filter(operation => !isControlOp(operation));
            const checkControls = (scene: SceneView) => controls.map(control => checkControl(scene, control)).find(reply => !reply.ok);
            const runControls = (list: readonly ControlOp[]) => { videoPlayback = applyVideoControls(videoPlayback, list, elapsed); };
            if (controls.length > 0 && sceneOperations.length === 0) {
                const bad = checkControls(persistent);
                if (bad) return bad;
                runControls(controls);
                return { ok: true, data: { revision: persistent.revision } };
            }
            if (value.expectedRevision !== persistent.revision)
                return failure("CONFLICT", "Scene revision changed");
            const operations = resolveCalibrations(sceneOperations);
            if (!operations.ok) return operations;
            for (const operation of operations.data) {
                if (operation.kind === 'setAvatarIdle' && operation.idleAnimation.kind === 'clip') {
                    const clip = record(operation.idleAnimation.assetId);
                    if (!clip?.animation || (clip.format !== 'vrma' && clip.format !== 'fbx')) return failure('INVALID_INPUT', 'Idle clip asset not found', [operation.idleAnimation.assetId]);
                }
                if (operation.kind !== 'setAvatarAnimation') continue;
                for (const entry of operation.animation.overlayingPoses) {
                    if (!isOverlayClipEntry(entry)) continue;
                    const clip = record(entry.assetId);
                    if (!clip?.animation || (clip.format !== 'vrma' && clip.format !== 'fbx')) return failure('INVALID_INPUT', 'Overlay clip asset not found', [entry.assetId]);
                }
            }
            const applied = applyOperations(persistent, operations.data, persistent.revision + 1);
            if (!applied.ok) return applied;
            const bad = checkControls(applied.data);
            if (bad) return bad;
            const committed = commit(applied.data);
            if (committed.ok) { overrides = dropOverrides(overrides, sceneOperations); tweens = dropTweens(tweens, sceneOperations); runControls(controls); }
            return committed;
        },
        applyProposal(params) {
            // Order: parse, scene ID, every expectation, scene ops, output camera, revision overflow, Blueprint batch, scene commit.
            // The Blueprint edit is the last step that can fail and the commit cannot fail after the overflow check, so no step needs a rollback.
            const parsed = ProposalApplyParamsSchema.safeParse(params);
            if (!parsed.success)
                return failure("INVALID_INPUT", "Invalid proposal");
            const value = parsed.data;
            if (value.sceneId !== persistent.sceneId)
                return failure("NOT_FOUND", "Scene not found", [value.sceneId]);
            const failed = new Set<Id>();
            for (const { id, fingerprint: expected } of value.expect.entities) {
                const entity = persistent.entities.find(item => item.id === id);
                if ((entity ? fingerprint(entity) : null) !== expected) failed.add(id);
            }
            // The client fingerprints the stored document, so a graph whose document does not compile can still be replaced.
            for (const { id, fingerprint: expected } of value.expect.blueprints) {
                const graph = store.document(id);
                if ((graph ? fingerprint(graph) : null) !== expected) failed.add(id);
            }
            if (failed.size > 0)
                return failure("CONFLICT", "Proposal target changed", [...failed]);
            let next = structuredClone(persistent);
            if (value.sceneOps.length > 0) {
                const operations = resolveCalibrations(value.sceneOps);
                if (!operations.ok) return operations;
                const applied = applyOperations(persistent, operations.data, persistent.revision + 1);
                if (!applied.ok) return applied;
                next = applied.data;
            }
            if (value.output) {
                const output = next.outputs.find(item => item.id === value.output!.outputId);
                if (!output)
                    return failure("NOT_FOUND", "Output not found", [value.output.outputId]);
                const camera = next.entities.find(entity => entity.id === value.output!.cameraId);
                if (!camera)
                    return failure("NOT_FOUND", "Camera not found", [value.output.cameraId]);
                if (camera.kind !== "camera")
                    return failure("INVALID_INPUT", "Entity is not a camera", [camera.id]);
                output.cameraId = camera.id;
            }
            if (!Number.isSafeInteger(persistent.revision + 1))
                return failure("INVALID_INPUT", "Revision limit reached");
            let blueprint: ProposalApplyResult['blueprint'] = null;
            if (value.blueprint) {
                const edited = api.editBlueprints(value.blueprint);
                if (!edited.ok) return edited;
                blueprint = edited.data;
            }
            const committed = commit(next);
            if (!committed.ok) return committed;
            overrides = dropOverrides(overrides, value.sceneOps);
            tweens = dropTweens(tweens, value.sceneOps);
            return { ok: true, data: { revision: committed.data.revision, blueprint } };
        },
        selectCamera(params) {
            const parsed = ParamSchemas.cameraSelect.safeParse(params);
            if (!parsed.success)
                return failure("INVALID_INPUT", "Invalid camera selection");
            const value = parsed.data;
            if (value.expectedRevision !== persistent.revision)
                return failure("CONFLICT", "Scene revision changed");
            const next = structuredClone(persistent);
            const output = next.outputs.find(output => output.id === value.outputId);
            if (!output)
                return failure("NOT_FOUND", "Output not found", [value.outputId]);
            const camera = next.entities.find(entity => entity.id === value.cameraId);
            if (!camera)
                return failure("NOT_FOUND", "Camera not found", [value.cameraId]);
            if (camera.kind !== "camera")
                return failure("INVALID_INPUT", "Entity is not a camera", [value.cameraId]);
            output.cameraId = camera.id;
            return commit(next);
        },
        ingestTracking:update=>tracking.ingest(update,persistent),
        probeTracking({ sourceId, resetPeaks }) {
            const source = persistent.entities.find(entity => entity.id === sourceId);
            if (!source) return failure('NOT_FOUND', 'Entity not found', [sourceId]);
            if (source.kind !== 'tracking') return failure('INVALID_INPUT', 'Entity is not a tracking source', [sourceId]);
            const probe = tracking.probe(sourceId, lastTrackingNowMs ?? Infinity, resetPeaks === true);
            const status = lastTrackingStatus.find(item => item.sourceId === sourceId && item.generation === source.generation);
            const state = status?.state ?? (source.config.enabled ? 'waiting' : 'stopped');
            const empty = { sourceId, generation: source.generation, values: {}, peaks: {}, presentChannels: [], eyeBones: false };
            return { ok: true, data: { ...(probe && probe.generation === source.generation ? probe : empty), state } };
        },
        runPeaks: sourceId => tracking.runPeaks(sourceId),
        vmcPoses(frame) {
            const poses = vmcPosesFor(persistent, frame.avatarPoses ?? [], record);
            return poses.length ? { kind: 'vmcPoses', sessionId, tick: frame.tick, poses } : null;
        },
        setAssetRecords: storeRecords,
        meshList(avatarId) {
            const entity = persistent.entities.find(item => item.id === avatarId);
            if (!entity) return failure('NOT_FOUND', 'Entity not found', [avatarId]);
            if (entity.kind !== 'avatar') return failure('INVALID_INPUT', 'Entity is not an avatar', [avatarId]);
            const meshes = entity.assetId === null ? undefined : record(entity.assetId)?.meshes;
            if (!meshes) return failure('NOT_FOUND', 'Asset has no mesh list', [avatarId]);
            return { ok: true, data: meshList(meshes, entity.hiddenMeshes) };
        },
        // R18: the materials of the model of a character or a prop, in record order.
        materialList(entityId) {
            const entity = persistent.entities.find(item => item.id === entityId);
            if (!entity) return failure('NOT_FOUND', 'Entity not found', [entityId]);
            const assetId = entity.kind === 'avatar' ? entity.assetId : entity.kind === 'mesh' && entity.source.kind === 'asset' ? entity.source.assetId : null;
            const materials = assetId === null ? undefined : record(assetId)?.materials;
            if (!materials) return failure('INVALID_INPUT', 'Entity has no materials', [entityId]);
            return { ok: true, data: materialList(materials, entity.kind === 'avatar' || entity.kind === 'mesh' ? entity.materials : undefined) };
        },
        getExpressions(avatarId) {
            return expressionView(reconcileExpressions(expressions, persistent), persistent, record, avatarId);
        },
        setExpression(avatarId, name, active) {
            const set = setExpression(reconcileExpressions(expressions, persistent), persistent, record, { kind: 'setExpression', entityId: avatarId, expression: name, active });
            if (!set.ok) return set;
            expressions = set.data;
            return expressionView(expressions, persistent, record, avatarId);
        },
        advance(elapsedMs,trackingNowMs,input) {
            const tick = Math.floor(elapsedMs * 60 / 1000);
            if (!Number.isFinite(elapsedMs) || elapsedMs < elapsed || !Number.isSafeInteger(tick) || !Number.isSafeInteger(sequence + 1)) {
                throw new RangeError("Elapsed time must be finite, nonnegative and monotonic within safe counter limits");
            }
            failedThisTick = false;
            boneOffsets = EMPTY_BONE_OFFSETS;
            try {
                const device = devices.ingest(input?.devices);
                const events: BlueprintEvent[] = [...(input?.events?.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? []), ...device.events.map(event => ({ kind: 'device' as const, event })), ...(input?.youtube?.events.map(event => ({ kind: 'youtube' as const, event })) ?? []), { kind: 'tracking' }, { kind: 'update' }];
                deviceEnv = device.env;
                // Only the clock step runs transition ends: the ones recorded before this step, as a snapshot.
                const ends = pendingEnds;
                pendingEnds = [];
                stepBlueprints(events, elapsedMs, new Set(input?.held ?? []), ends);
            } catch (error) {
                // An unexpected Blueprint failure must not abort the frame.
                logOnce(error);
            }
            // Separate, so a Blueprint step that throws does not stop running transitions or the idle commit.
            try {
                stepTweens(elapsedMs);
                commitIdle(elapsedMs);
            } catch (error) {
                logOnce(error);
            }
            if (!failedThisTick) loggedFailures.clear();
            const shown = applyOverrides(persistent, overrides);
            const scene = adapter.evaluate(shown, elapsedMs);
            snowCover = advanceSnowCover(snowCover, scene, (elapsedMs - elapsed) / 1000);
            expressions = advanceExpressions(expressions, persistent, record, (elapsedMs - elapsed) / 1000, elapsedMs);
            blendShapes = advanceBlendShapes(blendShapes, persistent, elapsedMs);
            const looked = stepLookAt(lookAts, sceneLookup(shown), elapsedMs, boneOffsets);
            lookAts = looked.states;
            elapsed = elapsedMs;
            sequence += 1;
            lastTrackingNowMs = trackingNowMs ?? elapsedMs;
            const live=tracking.evaluate(shown,trackingNowMs??elapsedMs,elapsedMs,record);
            lastTrackingStatus = live.trackingStatus;
            const animated = composeAvatarAnimation(live.avatarPoses, shown, elapsedMs, animationRuntimes, record, oneShots);
            animationRuntimes = animated.runtimes;
            oneShots = advanceOneShots(oneShots, shown, record, elapsedMs);
            previousPoses = new Map(animated.poses.map(pose => [pose.avatarId, structuredClone(pose)]));
            const faces = composeBlendShapes(composeExpressions(animated.poses, expressions, persistent, record), blendShapes);
            const avatarPoses = composeBoneOffsets(faces, looked.offsets);
            const springs = advanceSpringResets(springResets, scene, avatarPoses);
            springResets = springs.state;
            const playback = screenPlayback(videoPlayback, persistent, elapsedMs);
            return { schemaVersion: 1, sessionId, sequence, tick, elapsedMs, scene, blueprintRevision: store.revision(), ...(avatarPoses.length?{avatarPoses}:{}),...(live.trackingStatus.length?{trackingStatus:live.trackingStatus}:{}),...(playback.length?{screenPlayback:playback}:{}),...(springs.resets.length?{springResets:springs.resets}:{}),...(snowCover?{snow:snowCover}:{}) };
        },
    };
    return api;
}
