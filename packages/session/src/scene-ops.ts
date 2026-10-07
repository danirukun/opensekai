import { SceneViewSchema, type ErrorCode, type Id, type Reply, type ScenePatch, type SceneView } from "@opensekai/contracts";
import type { BlueprintEffect } from "./blueprint";

const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });

export function applyOperations(scene: SceneView, operations: ScenePatch["operations"], generation: number): Reply<SceneView> {
            const next = structuredClone(scene);
            for (const operation of operations) {
                if(operation.kind==='createEntity'){
                    if(next.entities.some(e=>e.id===operation.entity.id))return failure('INVALID_INPUT','Duplicate entity ID',[operation.entity.id]);
                    const created=structuredClone(operation.entity);if(created.kind==='tracking')created.generation=generation;next.entities.push(created);continue;
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
                 case 'setTrackingConfig':if(entity.kind!=='tracking'||entity.config.kind!==operation.config.kind)return failure('INVALID_INPUT','Tracking source kind differs',[entity.id]);entity.config=structuredClone(operation.config);entity.generation=generation;break;
                }
            }
            if(!SceneViewSchema.safeParse(next).success)return failure('INVALID_INPUT','Invalid scene references or budget');
            return { ok: true, data: next };
}

export function applyEffects(scene: SceneView, effects: BlueprintEffect[]): Reply<SceneView> {
 let next = structuredClone(scene);
 for (const effect of effects) {
  if (effect.kind === 'selectCamera') {
   const output = next.outputs.find(item => item.id === effect.outputId);
   if (!output) return failure('NOT_FOUND', 'Output not found', [effect.outputId]);
   if (!next.entities.some(entity => entity.id === effect.cameraId && entity.kind === 'camera')) return failure('NOT_FOUND', 'Camera not found', [effect.cameraId]);
   output.cameraId = effect.cameraId;
   continue;
  }
  const entity = next.entities.find(item => item.id === effect.entityId);
  if (!entity) return failure('NOT_FOUND', 'Entity not found', [effect.entityId]);
  const applied = applyOperations(next, [{ kind: 'setVisibility', entityId: effect.entityId, visible: effect.kind === 'toggleVisibility' ? !entity.visible : effect.visible }], next.revision);
  if (!applied.ok) return applied;
  next = applied.data;
 }
 return { ok: true, data: next };
}
