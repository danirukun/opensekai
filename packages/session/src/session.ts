import { IdSchema, ParamSchemas, AssetRecordSchema, type AssetRecord, type ExpressionState, ScenePatchSchema, SceneViewSchema, ShowSceneSchema, type ErrorCode, type Id, type Reply, type RuntimeFrame, type ScenePatch, type SceneView, type TrackingUpdate, type AppError, type InputUpdate, type BlueprintInspect, type AvatarPose } from "@opensekai/contracts";
import { createTransformAdapter } from "./ecs";
import {createTrackingComposer} from "./tracking";
import { createBlueprintRuntime, logicKey, type BlueprintEvent, type GraphRun, type StepEnv } from './blueprint-runtime';
import { createBlueprintStore } from './blueprint-store';
import { applyEffects, applyOperations } from './scene-ops';
import { isBoneOffsetEffect, isCharacterLayerEffect, isExpressionEffect, isOverrideEffect, isSceneEffect } from './blueprint';
import { composeBoneOffsets, EMPTY_BONE_OFFSETS, writeBoneOffset, type BoneOffsets } from './bone-offsets';
import { advanceExpressions, composeExpressions, EMPTY_EXPRESSIONS, expressionView, reconcileExpressions, setExpression, type ExpressionStates } from './expressions';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, takeIdle, type OverrideLayer } from './overrides';
import { advanceTweens, dropTweens, EMPTY_TWEENS, tweening, writeTransitioned, type TweenLayer } from './tweens';
import { advanceBlendShapes, composeBlendShapes, EMPTY_BLEND_SHAPES, setBlendShape, type BlendShapeStates } from './blend-shapes';
import { advanceLookAt, composeLookAt, EMPTY_LOOK_AT, setLookAt, type LookAtStates } from './look-at';
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
    advance(elapsedMs: number, trackingNowMs?:number, input?: InputUpdate): RuntimeFrame;
    editBlueprints(batch: unknown): Reply<{ revision: number; keystrokes: string[]; heldKeys?: string[] }>;
    inspectBlueprints(sinceRevision?: number): BlueprintInspect;
    runBlueprint(graphId: Id, triggerNodeId: Id): Reply<{revision: number}>;
    setAssetRecords(records: readonly AssetRecord[]): void;
    getExpressions(avatarId: Id): Reply<ExpressionState>;
    setExpression(avatarId: Id, name: string, active: boolean): Reply<ExpressionState>;
}
const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });
export function createSession(scene: SceneView, sessionId: Id, assets: readonly AssetRecord[] = []): Session {
    IdSchema.parse(sessionId);
    let persistent: SceneView = structuredClone(SceneViewSchema.parse(scene));
    const adapter = createTransformAdapter(persistent);
    let tracking=createTrackingComposer();
    let overrides: OverrideLayer = EMPTY_OVERRIDES;
    let expressions: ExpressionStates = EMPTY_EXPRESSIONS;
    // Runtime transition state on the session clock: property tweens, blend shape weights, and look-at targets.
    let tweens: TweenLayer = EMPTY_TWEENS;
    let blendShapes: BlendShapeStates = EMPTY_BLEND_SHAPES;
    let lookAts: LookAtStates = EMPTY_LOOK_AT;
    // Never committed or saved: rebuilt by the Blueprint step of each tick.
    let boneOffsets: BoneOffsets = EMPTY_BONE_OFFSETS;
    let previousPoses = new Map<Id, AvatarPose>();
    let records = new Map<Id, AssetRecord>();
    const record = (assetId: Id) => records.get(assetId);
    const storeRecords = (list: readonly AssetRecord[]) => { records = new Map(list.flatMap(item => { const parsed = AssetRecordSchema.safeParse(item); return parsed.success ? [[parsed.data.id, parsed.data] as const] : []; })); };
    storeRecords(assets);
    let elapsed = 0;
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
    const stepBlueprints = (events: BlueprintEvent[], nowMs: number, held: ReadonlySet<string>): { runs: GraphRun[]; committed: Reply<{ revision: number }> } => {
        let working: SceneView | null = null;
        let layer = overrides;
        let moving = tweens;
        let faces = reconcileExpressions(expressions, persistent);
        let offsets = boneOffsets;
        let shapes = blendShapes;
        let looks = lookAts;
        const env: StepEnv = { held, scene: () => applyOverrides(working ?? persistent, layer), previousPose: avatarId => previousPoses.get(avatarId) ?? null };
        const runs = runtime.step(events, nowMs, run => {
            if (run.effects.length === 0) return null;
            const sceneEffects = run.effects.filter(isSceneEffect);
            let scene = working ?? persistent;
            if (sceneEffects.length) { const next = applyEffects(scene, sceneEffects); if (!next.ok) return next.error; scene = next.data; }
            let nextLayers = { overrides: layer, tweens: moving };
            for (const effect of run.effects.filter(isOverrideEffect)) {
                const written = writeTransitioned(nextLayers, scene, effect, run.graphId, nowMs);
                if (!written.ok) return written.error;
                nextLayers = written.data;
            }
            // Expression effects apply only when the scene effects of the same run apply.
            let nextFaces = faces;
            for (const effect of run.effects.filter(isExpressionEffect)) {
                const set = setExpression(nextFaces, scene, record, effect, nowMs);
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
                    const set = setBlendShape(nextShapes, scene, record, effect, nowMs);
                    if (!set.ok) return set.error;
                    nextShapes = set.data;
                } else {
                    // Look At reads positions from the evaluated scene, so it aims at a moving target.
                    const set = setLookAt(nextLooks, applyOverrides(scene, nextLayers.overrides), effect, nowMs);
                    if (!set.ok) return set.error;
                    nextLooks = set.data;
                }
            }
            if (sceneEffects.length) working = scene;
            layer = nextLayers.overrides;
            moving = nextLayers.tweens;
            faces = nextFaces;
            offsets = nextOffsets;
            shapes = nextShapes;
            looks = nextLooks;
            return null;
        }, env);
        overrides = layer;
        tweens = moving;
        expressions = faces;
        boneOffsets = offsets;
        blendShapes = shapes;
        lookAts = looks;
        for (const run of runs) if (run.error) runtimeErrors.set(run.graphId, run.error); else runtimeErrors.delete(run.graphId);
        const changed = working !== null && JSON.stringify(working) !== JSON.stringify(persistent);
        return { runs, committed: changed ? commit(working!) : { ok: true, data: { revision: persistent.revision } } };
    };
    // Each tween writes its sample as an override at the session time.
    const stepTweens = (nowMs: number) => {
        const stepped = advanceTweens({ overrides, tweens }, persistent, nowMs);
        ({ overrides, tweens } = stepped.layers);
        for (const failure of stepped.failures) runtimeErrors.set(failure.graphId, failure.error);
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
    const api: Session = {
        inspect: () => structuredClone(persistent),
        replaceScene(scene, expectedRevision) {
            if (expectedRevision !== persistent.revision) return failure('CONFLICT', 'Scene revision changed');
            const parsed = ShowSceneSchema.safeParse(scene);
            if (!parsed.success || !Number.isSafeInteger(persistent.revision + 1)) return failure('INVALID_INPUT', 'Invalid show scene');
            persistent = structuredClone({ ...parsed.data, revision: persistent.revision + 1 });
            tracking = createTrackingComposer();
            overrides = EMPTY_OVERRIDES;
            tweens = EMPTY_TWEENS;
            expressions = EMPTY_EXPRESSIONS;
            boneOffsets = EMPTY_BONE_OFFSETS;
            blendShapes = EMPTY_BLEND_SHAPES;
            lookAts = EMPTY_LOOK_AT;
            previousPoses = new Map();
            return { ok: true, data: structuredClone(persistent) };
        },
        editBlueprints(batch) {
            const before = new Map([...runtimeErrors.keys()].map(id => { const graph = store.active(id); return [id, graph && logicKey(graph)] as const; }));
            const reply = store.edit(batch);
            if (reply.ok)
                for (const [id, key] of before) {
                    const graph = store.active(id);
                    if (!graph || logicKey(graph) !== key) runtimeErrors.delete(id);
                }
            return reply;
        },
        inspectBlueprints: since => store.inspect(since, runtimeErrors),
        runBlueprint(graphId, triggerNodeId) {
            const graph = store.active(graphId);
            if (!graph) return failure('NOT_FOUND', 'Blueprint not found', [graphId]);
            if (!graph.enabled) return failure('INVALID_INPUT', 'Blueprint is disabled', [graphId]);
            if (!graph.nodes.some(node => node.id === triggerNodeId && node.type === 'event.manual')) return failure('INVALID_INPUT', 'Manual trigger not found', [triggerNodeId]);
            try {
                const { runs, committed } = stepBlueprints([{ kind: 'manual', graphId, nodeId: triggerNodeId }], elapsed, new Set());
                const own = runs.at(-1);
                if (own?.error) return { ok: false, error: own.error };
                return committed;
            } catch (error) {
                logOnce(error);
                return failure('INVALID_INPUT', 'Blueprint step failed', [graphId]);
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
            const applied = applyOperations(persistent, value.operations, persistent.revision + 1);
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
                const events: BlueprintEvent[] = [...(input?.events?.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? []), { kind: 'update' }];
                stepBlueprints(events, elapsedMs, new Set(input?.held ?? []));
                stepTweens(elapsedMs);
                commitIdle(elapsedMs);
            } catch (error) {
                // An unexpected Blueprint failure must not abort the frame.
                logOnce(error);
            }
            if (!failedThisTick) loggedFailures.clear();
            const shown = applyOverrides(persistent, overrides);
            const scene = adapter.evaluate(shown, elapsedMs);
            expressions = advanceExpressions(expressions, persistent, record, (elapsedMs - elapsed) / 1000, elapsedMs);
            blendShapes = advanceBlendShapes(blendShapes, persistent, elapsedMs);
            lookAts = advanceLookAt(lookAts, shown, elapsedMs);
            elapsed = elapsedMs;
            sequence += 1;
            const live=tracking.evaluate(shown,trackingNowMs??elapsedMs,elapsedMs);
            previousPoses = new Map(live.avatarPoses.map(pose => [pose.avatarId, structuredClone(pose)]));
            const faces = composeBlendShapes(composeExpressions(live.avatarPoses, expressions, persistent, record), blendShapes);
            const avatarPoses = composeBoneOffsets(faces, composeLookAt(boneOffsets, lookAts, shown, elapsedMs));
            return { schemaVersion: 1, sessionId, sequence, tick, elapsedMs, scene, blueprintRevision: store.revision(), ...(avatarPoses.length?{avatarPoses}:{}),...(live.trackingStatus.length?{trackingStatus:live.trackingStatus}:{}) };
        },
    };
    return api;
}
