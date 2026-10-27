import { IdSchema, ParamSchemas, type VmcPosesEnvelope, AssetRecordSchema, type AssetRecord, type ExpressionState, ScenePatchSchema, SceneViewSchema, ShowSceneSchema, type ErrorCode, type Id, type Reply, type RuntimeFrame, type ScenePatch, type SceneView, type TrackingUpdate, type AppError, type InputUpdate, type BlueprintInspect, type AvatarPose, type DeviceKind, type ScalarValue, type BlueprintDebug, type TrackingProbe, type TrackingProbeParams, type TrackingStatus, type ArkitName } from "@opensekai/contracts";
import { createTransformAdapter } from "./ecs";
import {createTrackingComposer} from "./tracking";
import { createBlueprintRuntime, logicKey, type BlueprintEvent, type GraphRun, type StepEnv } from './blueprint-runtime';
import { createBlueprintStore } from './blueprint-store';
import { NO_DEVICES, type DeviceEnv } from './blueprint-eval';
import { createDeviceInput } from './devices';
import { applyEffects, applyOperations } from './scene-ops';
import { captureCalibration } from './tracking-calibration';
import { fitRanges, mergeFit } from './blend-shape-fit';
import { isBoneOffsetEffect, isCharacterLayerEffect, isDebugEffect, isExpressionEffect, isOverrideEffect, isSceneEffect } from './blueprint';
import { createDebugLog } from './debug-log';
import { composeBoneOffsets, EMPTY_BONE_OFFSETS, writeBoneOffset, type BoneOffsets } from './bone-offsets';
import { advanceExpressions, composeExpressions, dropExpressionFades, EMPTY_EXPRESSIONS, expressionOwners, expressionView, reconcileExpressions, setExpression, type ExpressionStates } from './expressions';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, evaluatedEntity, takeIdle, type OverrideLayer } from './overrides';
import { advanceTweens, dropGraphTweens, dropTweens, EMPTY_TWEENS, transitionStart, tweenOwners, tweening, writeTransitioned, type PropertyLayers, type TransitionEnd, type TweenLayer } from './tweens';
import { advanceBlendShapes, blendShapeOwners, composeBlendShapes, dropGraphBlendShapes, EMPTY_BLEND_SHAPES, setBlendShape, type BlendShapeStates } from './blend-shapes';
import { vmcPosesFor, withSendersStopped } from './vmc-send';
import { dropGraphLookAts, EMPTY_LOOK_AT, lookAtOwners, sceneLookup, setLookAt, stepLookAt, type LookAtStates } from './look-at';
export interface Session {
    inspect(): SceneView;
    replaceScene(scene: SceneView, expectedRevision: number): Reply<SceneView>;
    applyPatch(patch: ScenePatch): Reply<{
        revision: number;
    }>;
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
    editBlueprints(batch: unknown): Reply<{ revision: number; keystrokes: string[]; heldKeys?: string[]; devices?: DeviceKind[] }>;
    inspectBlueprints(sinceRevision?: number): BlueprintInspect;
    debugBlueprints(since?: number): BlueprintDebug;
    runBlueprint(graphId: Id, triggerNodeId: Id): Reply<{revision: number}>;
    // Delivers a custom event to the On Event nodes of the enabled graphs (slice D R12).
    emitBlueprintEvent(name: string, payload?: ScalarValue): Reply<{revision: number}>;
    setAssetRecords(records: readonly AssetRecord[]): void;
    getExpressions(avatarId: Id): Reply<ExpressionState>;
    setExpression(avatarId: Id, name: string, active: boolean): Reply<ExpressionState>;
}
const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });
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
    // Transition ends that run on the next clock step: the ends of writes without a tween, and of tweens that reached their end.
    let pendingEnds: readonly TransitionEnd[] = [];
    // Never committed or saved: rebuilt by the Blueprint step of each tick.
    let boneOffsets: BoneOffsets = EMPTY_BONE_OFFSETS;
    let previousPoses = new Map<Id, AvatarPose>();
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
    function commit(next: SceneView): Reply<{
        revision: number;
    }> {
        if (!Number.isSafeInteger(persistent.revision + 1))
            return failure("INVALID_INPUT", "Revision limit reached");
        next.revision = persistent.revision + 1;
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
    const stepBlueprints = (events: BlueprintEvent[], nowMs: number, held: ReadonlySet<string>, transitionEnds: readonly TransitionEnd[] = []): { runs: GraphRun[]; committed: Reply<{ revision: number }> } => {
        let working: SceneView | null = null;
        let layer = overrides;
        let moving = tweens;
        let ends = pendingEnds;
        let faces = reconcileExpressions(expressions, persistent);
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
            for (const effect of run.effects.filter(isOverrideEffect)) {
                const end = effect.kind === 'setProperty' && effect.nodeId !== undefined && logic !== null ? { graphId: run.graphId, nodeId: effect.nodeId, logic } : undefined;
                const written = writeTransitioned(nextLayers, scene, effect, run.graphId, nowMs, startMs, end);
                if (!written.ok) return written.error;
                nextLayers = written.data;
            }
            // Expression effects apply only when the scene effects of the same run apply.
            let nextFaces = faces;
            for (const effect of run.effects.filter(isExpressionEffect)) {
                const set = setExpression(nextFaces, scene, record, effect, startMs, run.graphId);
                if (!set.ok) return set.error;
                nextFaces = set.data;
            }
            let nextOffsets = offsets;
            for (const effect of run.effects.filter(isBoneOffsetEffect)) {
                const written = writeBoneOffset(nextOffsets, scene, effect);
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
            layer = nextLayers.overrides;
            if (nextLayers.tweens !== moving) tweenErrors.delete(run.graphId);
            moving = nextLayers.tweens;
            ends = nextLayers.pending ?? [];
            faces = nextFaces;
            offsets = nextOffsets;
            shapes = nextShapes;
            looks = nextLooks;
            return null;
        }, env, transitionEnds);
        overrides = layer;
        tweens = moving;
        pendingEnds = ends;
        expressions = faces;
        boneOffsets = offsets;
        blendShapes = shapes;
        lookAts = looks;
        for (const run of runs) if (run.error) runtimeErrors.set(run.graphId, run.error); else runtimeErrors.delete(run.graphId);
        const changed = working !== null && JSON.stringify(working) !== JSON.stringify(persistent);
        const committed = changed ? commit(working!) : { ok: true as const, data: { revision: persistent.revision } };
        // Debug output only from runs whose scene changes were committed.
        if (committed.ok) for (const run of runs) if (!run.error) debugLog.record(run.graphId, run.effects.filter(isDebugEffect), run.debug ?? [], nowMs);
        applyControls();
        return { runs, committed };
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
    const commitIdle = (nowMs: number) => {
        const idle = takeIdle(persistent, overrides, nowMs, (entityId, property) => tweening(tweens, entityId, property));
        overrides = idle.remaining;
        if (idle.operations.length === 0) return;
        const applied = applyOperations(persistent, idle.operations, persistent.revision + 1);
        const committed = applied.ok ? commit(applied.data) : applied;
        if (!committed.ok) for (const graphId of idle.graphIds) runtimeErrors.set(graphId, committed.error);
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
            if (!parsed.success || !Number.isSafeInteger(persistent.revision + 1)) return failure('INVALID_INPUT', 'Invalid show scene');
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
            previousPoses = new Map();
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
                const { runs, committed } = stepBlueprints([{ kind: 'manual', graphId, nodeId: triggerNodeId }], elapsed, new Set());
                const own = runs.find(run => run.graphId === graphId && run.nodeId === triggerNodeId);
                if (own?.error) return { ok: false, error: own.error };
                return committed;
            } catch (error) {
                logOnce(error);
                return failure('INVALID_INPUT', 'Blueprint step failed', [graphId]);
            }
        },
        emitBlueprintEvent(name, payload) {
            if (name.trim().length === 0 || name.length > 64) return failure('INVALID_INPUT', 'Invalid event name');
            try {
                const { runs, committed } = stepBlueprints([{ kind: 'custom', name, payload: payload ?? null }], elapsed, new Set());
                // Only the runs that this event caused, not On Enable or due delays of the same step.
                const delivered = runs.find(run => run.external && run.error);
                if (delivered?.error) return { ok: false, error: delivered.error };
                return committed;
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
            if (value.expectedRevision !== persistent.revision)
                return failure("CONFLICT", "Scene revision changed");
            const operations = resolveCalibrations(value.operations);
            if (!operations.ok) return operations;
            const applied = applyOperations(persistent, operations.data, persistent.revision + 1);
            if (!applied.ok) return applied;
            const committed = commit(applied.data);
            if (committed.ok) { overrides = dropOverrides(overrides, value.operations); tweens = dropTweens(tweens, value.operations); }
            return committed;
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
                const events: BlueprintEvent[] = [...(input?.events?.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? []), ...device.events.map(event => ({ kind: 'device' as const, event })), { kind: 'tracking' }, { kind: 'update' }];
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
            expressions = advanceExpressions(expressions, persistent, record, (elapsedMs - elapsed) / 1000, elapsedMs);
            blendShapes = advanceBlendShapes(blendShapes, persistent, elapsedMs);
            const looked = stepLookAt(lookAts, sceneLookup(shown), elapsedMs, boneOffsets);
            lookAts = looked.states;
            elapsed = elapsedMs;
            sequence += 1;
            lastTrackingNowMs = trackingNowMs ?? elapsedMs;
            const live=tracking.evaluate(shown,trackingNowMs??elapsedMs,elapsedMs);
            lastTrackingStatus = live.trackingStatus;
            previousPoses = new Map(live.avatarPoses.map(pose => [pose.avatarId, structuredClone(pose)]));
            const faces = composeBlendShapes(composeExpressions(live.avatarPoses, expressions, persistent, record), blendShapes);
            const avatarPoses = composeBoneOffsets(faces, looked.offsets);
            return { schemaVersion: 1, sessionId, sequence, tick, elapsedMs, scene, blueprintRevision: store.revision(), ...(avatarPoses.length?{avatarPoses}:{}),...(live.trackingStatus.length?{trackingStatus:live.trackingStatus}:{}) };
        },
    };
    return api;
}
