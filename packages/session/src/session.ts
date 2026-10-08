import { IdSchema, ParamSchemas, ScenePatchSchema, SceneViewSchema, ShowSceneSchema, type ErrorCode, type Id, type Reply, type RuntimeFrame, type ScenePatch, type SceneView, type TrackingUpdate, type AppError, type InputUpdate, type BlueprintInspect } from "@opensekai/contracts";
import { createTransformAdapter } from "./ecs";
import {createTrackingComposer} from "./tracking";
import { createBlueprintRuntime, logicKey, type BlueprintEvent, type GraphRun } from './blueprint-runtime';
import { createBlueprintStore } from './blueprint-store';
import { applyEffects, applyOperations } from './scene-ops';
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
    editBlueprints(batch: unknown): Reply<{ revision: number; keystrokes: string[] }>;
    inspectBlueprints(sinceRevision?: number): BlueprintInspect;
    runBlueprint(graphId: Id, triggerNodeId: Id): Reply<{revision: number}>;
}
const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });
export function createSession(scene: SceneView, sessionId: Id): Session {
    IdSchema.parse(sessionId);
    let persistent: SceneView = structuredClone(SceneViewSchema.parse(scene));
    const adapter = createTransformAdapter(persistent);
    let tracking=createTrackingComposer();
    let elapsed = 0;
    let sequence = 0;
    function commit(next: SceneView): Reply<{
        revision: number;
    }> {
        if (!Number.isSafeInteger(persistent.revision + 1))
            return failure("INVALID_INPUT", "Revision limit reached");
        next.revision = persistent.revision + 1;
        persistent = next;
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
    const stepBlueprints = (events: BlueprintEvent[], nowMs: number): { runs: GraphRun[]; committed: Reply<{ revision: number }> } => {
        let working: SceneView | null = null;
        const runs = runtime.step(events, nowMs, run => {
            if (run.effects.length === 0) return null;
            const next = applyEffects(working ?? persistent, run.effects);
            if (!next.ok) return next.error;
            working = next.data;
            return null;
        });
        for (const run of runs) if (run.error) runtimeErrors.set(run.graphId, run.error); else runtimeErrors.delete(run.graphId);
        const changed = working !== null && JSON.stringify(working) !== JSON.stringify(persistent);
        return { runs, committed: changed ? commit(working!) : { ok: true, data: { revision: persistent.revision } } };
    };
    const api: Session = {
        inspect: () => structuredClone(persistent),
        replaceScene(scene, expectedRevision) {
            if (expectedRevision !== persistent.revision) return failure('CONFLICT', 'Scene revision changed');
            const parsed = ShowSceneSchema.safeParse(scene);
            if (!parsed.success || !Number.isSafeInteger(persistent.revision + 1)) return failure('INVALID_INPUT', 'Invalid show scene');
            persistent = structuredClone({ ...parsed.data, revision: persistent.revision + 1 });
            tracking = createTrackingComposer();
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
                const { runs, committed } = stepBlueprints([{ kind: 'manual', graphId, nodeId: triggerNodeId }], elapsed);
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
            return commit(applied.data);
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
        advance(elapsedMs,trackingNowMs,input) {
            const tick = Math.floor(elapsedMs * 60 / 1000);
            if (!Number.isFinite(elapsedMs) || elapsedMs < elapsed || !Number.isSafeInteger(tick) || !Number.isSafeInteger(sequence + 1)) {
                throw new RangeError("Elapsed time must be finite, nonnegative and monotonic within safe counter limits");
            }
            failedThisTick = false;
            try {
                stepBlueprints(input?.events.map(event => ({ kind: 'keystroke' as const, accelerator: event.accelerator })) ?? [], elapsedMs);
            } catch (error) {
                // An unexpected Blueprint failure must not abort the frame.
                logOnce(error);
            }
            if (!failedThisTick) loggedFailures.clear();
            const scene = adapter.evaluate(persistent, elapsedMs);
            elapsed = elapsedMs;
            sequence += 1;
            const live=tracking.evaluate(persistent,trackingNowMs??elapsedMs,elapsedMs);
            return { schemaVersion: 1, sessionId, sequence, tick, elapsedMs, scene, blueprintRevision: store.revision(), ...(live.avatarPoses.length?{avatarPoses:live.avatarPoses}:{}),...(live.trackingStatus.length?{trackingStatus:live.trackingStatus}:{}) };
        },
    };
    return api;
}
