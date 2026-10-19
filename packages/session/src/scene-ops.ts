import { SceneViewSchema, type AvatarTracking, type ErrorCode, type Id, type Reply, type ScenePatch, type SceneView } from "@opensekai/contracts";
import type { SceneEffect } from "./blueprint";
import { delta, followers, shifted } from "./camera-follow";

const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });

// Each source with two or more avatars gives one key per avatar pair: `source avatarA avatarB`.
const sharedSources = (scene: SceneView): Map<string, Id[]> => {
 const users = new Map<Id, Id[]>();
 for (const entity of scene.entities) {
  if (entity.kind !== 'avatar' || !entity.tracking) continue;
  const sources = new Set([entity.tracking.bodySourceId, entity.tracking.faceSourceId, entity.tracking.fingersSourceId ?? null].filter((id): id is Id => id !== null));
  for (const source of sources) users.set(source, [...(users.get(source) ?? []), entity.id]);
 }
 return new Map([...users].flatMap(([source, avatars]) =>
  avatars.flatMap((a, i) => avatars.slice(i + 1).map(b => [`${source} ${[a, b].sort().join(' ')}`, [a, b]] as [string, Id[]]))));
};

// A patch cannot add a source share between two avatars. A share that the start state has stays valid.
const newShare = (before: SceneView, after: SceneView): Id[] | null => {
 const old = sharedSources(before);
 const added = [...sharedSources(after)].filter(([key]) => !old.has(key)).flatMap(([, avatars]) => avatars);
 return added.length ? [...new Set(added)] : null;
};

// A missing finger slot and a null finger slot are the same. The scene keeps the missing form, as Rust writes it.
const withoutNullFingers = (tracking: AvatarTracking): AvatarTracking => {
 const { fingersSourceId, ...rest } = structuredClone(tracking);
 return fingersSourceId ? { ...rest, fingersSourceId } : rest;
};

export function applyOperations(scene: SceneView, operations: ScenePatch["operations"], generation: number): Reply<SceneView> {
            const next = structuredClone(scene);
            // A camera that the patch places itself does not follow its target.
            const placed = new Set(operations.flatMap(operation => operation.kind === 'setTransform' ? [operation.entityId] : []));
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
                  if(entity.kind==='avatar')for(const camera of next.entities)if(camera.kind==='camera'&&camera.navigation?.mode==='orbitCharacter'&&camera.navigation.targetId===entity.id)camera.navigation.targetId=null;
                  if(entity.kind==='tracking')for(const avatar of next.entities){if(avatar.kind!=='avatar'||!avatar.tracking)continue;if(avatar.tracking.bodySourceId===entity.id)avatar.tracking.bodySourceId=null;if(avatar.tracking.faceSourceId===entity.id)avatar.tracking.faceSourceId=null;if(avatar.tracking.fingersSourceId===entity.id)delete avatar.tracking.fingersSourceId;}
                  break;
                 case 'setVisibility':entity.visible=operation.visible;break;
                 case 'setTransform':if(entity.kind==='tracking')return failure('INVALID_INPUT','Tracking assets have no scene transform',[entity.id]);{
                  const moved=delta(entity.transform.position,operation.transform.position);
                  entity.transform=structuredClone(operation.transform);
                  if(entity.kind==='avatar')for(const id of followers(next,entity.id))if(!placed.has(id)){const camera=next.entities.find(item=>item.id===id)!;camera.transform.position=shifted(camera.transform.position,moved);}
                  break;
                 }
                 case 'setCameraLens':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.lens=structuredClone(operation.lens);break;
                 case 'setAvatarIdle':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.idleAnimation=structuredClone(operation.idleAnimation);break;
                 case 'setAvatarTracking':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.tracking=withoutNullFingers(operation.tracking);break;
                 case 'setAvatarModel':if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);entity.assetId=operation.assetId;break;
                 case 'setEnvironmentModel':if(entity.kind!=='environment')return failure('INVALID_INPUT','Entity is not an environment',[entity.id]);entity.assetId=operation.assetId;break;
                 case 'setEnvironmentReflections':if(entity.kind!=='environment')return failure('INVALID_INPUT','Entity is not an environment',[entity.id]);entity.reflectionsIntensity=operation.reflectionsIntensity;break;
                 case 'setLight':if(entity.kind!=='light')return failure('INVALID_INPUT','Entity is not a light',[entity.id]);entity.light=structuredClone(operation.light);break;
                 case 'setHaze':if(entity.kind!=='haze')return failure('INVALID_INPUT','Entity is not a haze',[entity.id]);entity.haze=structuredClone(operation.haze);break;
                 case 'setAvatarExpression':{
                  if(entity.kind!=='avatar')return failure('INVALID_INPUT','Entity is not an avatar',[entity.id]);
                  // Entries, not property writes: a model can name an expression `__proto__`.
                  const kept=Object.entries(entity.expressions??{}).filter(([name])=>name!==operation.name);
                  const expressions=Object.fromEntries(operation.settings?[...kept,[operation.name,structuredClone(operation.settings)]]:kept);
                  if(kept.length||operation.settings)entity.expressions=expressions;else delete entity.expressions;
                  break;
                 }
                 case 'setCameraRenderEnvironment':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.renderEnvironment=operation.renderEnvironment;break;
                 case 'setCameraAntiAliasing':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.antiAliasing=operation.antiAliasing;break;
                 case 'setCameraNavigation':if(entity.kind!=='camera')return failure('INVALID_INPUT','Entity is not a camera',[entity.id]);entity.navigation=structuredClone(operation.navigation);break;
                 case 'setTrackingSmoothing':if(entity.kind!=='tracking')return failure('INVALID_INPUT','Entity is not a tracking source',[entity.id]);entity.smoothing=structuredClone(operation.smoothing);break;
                 case 'setTrackingConfig':if(entity.kind!=='tracking'||entity.config.kind!==operation.config.kind)return failure('INVALID_INPUT','Tracking source kind differs',[entity.id]);
                  // A mirror change flips the sign of the captured rotations, so the calibration no longer applies (R5).
                  if(entity.config.kind==='mediapipe'&&operation.config.kind==='mediapipe'&&entity.config.mirror!==operation.config.mirror)delete entity.calibration;
                  entity.config=structuredClone(operation.config);entity.generation=generation;break;
                 case 'setTrackingCalibration':if(entity.kind!=='tracking')return failure('INVALID_INPUT','Entity is not a tracking source',[entity.id]);if(operation.calibration)entity.calibration=structuredClone(operation.calibration);else delete entity.calibration;break;
                 case 'setTrackingMapping':if(entity.kind!=='tracking')return failure('INVALID_INPUT','Entity is not a tracking source',[entity.id]);entity.mapping=structuredClone(operation.mapping);break;
                 // The session resolves a capture into setTrackingCalibration before this step.
                 case 'calibrateTracking':return failure('INVALID_INPUT','Calibration needs a live session',[entity.id]);
                }
            }
            if(!SceneViewSchema.safeParse(next).success)return failure('INVALID_INPUT','Invalid scene references or budget');
            const shared=newShare(scene,next);
            if(shared)return failure('INVALID_INPUT','Tracking source used by another avatar',shared);
            return { ok: true, data: next };
}

export function applyEffects(scene: SceneView, effects: SceneEffect[]): Reply<SceneView> {
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
