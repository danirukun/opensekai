import { IdSchema, ParamSchemas, ScenePatchSchema, SceneViewSchema, ShowSceneSchema, type ErrorCode, type Id, type Reply, type RuntimeFrame, type ScenePatch, type SceneView, type TrackingUpdate } from "@opensekai/contracts";
import { createTransformAdapter } from "./ecs";
import {createTrackingComposer} from "./tracking";
import { compileBlueprint, runFlow } from './blueprint';
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
    advance(elapsedMs: number, trackingNowMs?:number): RuntimeFrame;
    runBlueprint(graph: unknown, triggerNodeId: Id): Reply<{revision: number}>;
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
        runBlueprint(graph, triggerNodeId) {
            const compiled = compileBlueprint(graph);
            if (!compiled.ok) return compiled;
            // Temporary bridge until Task 4 wires the Blueprint runtime into the session.
            const run = runFlow(compiled.data, { nodeId: triggerNodeId, port: 'flow' }, new Map(), { visits: 256, effects: 64 }, 0);
            if (!run.ok) return run;
            const operations = [];
            for (const effect of run.data.effects) {
                if (effect.kind !== 'setVisibility') return failure('INVALID_INPUT', 'Blueprint effect is not supported here');
                operations.push({ kind: 'setVisibility' as const, entityId: effect.entityId, visible: effect.visible });
            }
            if (operations.length === 0) return { ok: true, data: { revision: persistent.revision } };
            return api.applyPatch({ sceneId: persistent.sceneId, expectedRevision: persistent.revision, operations });
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
            const next = structuredClone(persistent);
            for (const operation of value.operations) {
                if(operation.kind==='createEntity'){
                    if(next.entities.some(e=>e.id===operation.entity.id))return failure('INVALID_INPUT','Duplicate entity ID',[operation.entity.id]);
                    const created=structuredClone(operation.entity);if(created.kind==='tracking')created.generation=persistent.revision+1;next.entities.push(created);continue;
                }
                const entity = next.entities.find(entity => entity.id === operation.entityId);
                if (!entity)return failure("NOT_FOUND", "Entity not found", [operation.entityId]);
                switch(operation.kind){
                 case 'renameEntity':entity.name=operation.name;break;
                 case 'removeEntity':
                  if(next.outputs.some(output=>output.cameraId===entity.id))return failure('INVALID_INPUT','Choose another output camera before removal',[entity.id]);
                  next.entities=next.entities.filter(item=>item.id!==entity.id);
                  if(entity.kind==='tracking')for(const avatar of next.entities){if(avatar.kind!=='avatar'||!avatar.tracking)continue;if(avatar.tracking.bodySourceId===entity.id)avatar.tracking.bodySourceId=null;if(avatar.tracking.faceSourceId===entity.id)avatar.tracking.faceSourceId=null;}
                  break;
                 case 'setVisibility':entity.visible=operation.visible;break;
                 case 'setTransform':if(entity.kind==='tracking')return failure('INVALID_INPUT','Tracking assets have no scene transform',[entity.id]);entity.transform=structuredClone(operation.transform);break;
                 case 'setCameraLens':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.lens=structuredClone(operation.lens);break;
                 case 'setAvatarIdle':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.idleAnimation=structuredClone(operation.idleAnimation);break;
                 case 'setAvatarTracking':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.tracking=structuredClone(operation.tracking);break;
                 case 'setTrackingSmoothing':if(entity.kind!=='tracking')return failure('INVALID_INPUT','Entity is not a tracking source',[entity.id]);entity.smoothing=structuredClone(operation.smoothing);break;
                 case 'setTrackingConfig':if(entity.kind!=='tracking'||entity.config.kind!==operation.config.kind)return failure('INVALID_INPUT','Tracking source kind differs',[entity.id]);entity.config=structuredClone(operation.config);entity.generation=persistent.revision+1;break;
                }
            }
            if(!SceneViewSchema.safeParse(next).success)return failure('INVALID_INPUT','Invalid scene references or budget');
            return commit(next);
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
        advance(elapsedMs,trackingNowMs) {
            const tick = Math.floor(elapsedMs * 60 / 1000);
            if (!Number.isFinite(elapsedMs) || elapsedMs < elapsed || !Number.isSafeInteger(tick) || !Number.isSafeInteger(sequence + 1)) {
                throw new RangeError("Elapsed time must be finite, nonnegative and monotonic within safe counter limits");
            }
            const scene = adapter.evaluate(persistent, elapsedMs);
            elapsed = elapsedMs;
            sequence += 1;
            const live=tracking.evaluate(persistent,trackingNowMs??elapsedMs,elapsedMs);
            return { schemaVersion: 1, sessionId, sequence, tick, elapsedMs, scene, ...(live.avatarPoses.length?{avatarPoses:live.avatarPoses}:{}),...(live.trackingStatus.length?{trackingStatus:live.trackingStatus}:{}) };
        },
    };
    return api;
}
