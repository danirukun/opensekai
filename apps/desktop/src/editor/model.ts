import { ExpressionNameSchema,ExpressionSettingsSchema,TransformSchema,SceneEntitySchema,LensSchema,AvatarTrackingSchema,AvatarIdleSchema,TrackingConfigSchema,TrackingSmoothingSchema,TrackingMappingSchema,EntityNameSchema,ShowSceneSchema,IdSchema,CameraAntiAliasingSchema,CameraNavigationSchema,LightSettingsSchema,HazeSettingsSchema,ReflectionsIntensitySchema } from '@opensekai/contracts';
import type { ExpressionSettings, AppApi, ErrorCode, Id, PatchOp, Reply, SceneView, Vec3, Transform, SceneEntity, AvatarTracking, AvatarIdle, TrackingConfig, TrackingSmoothing, TrackingMapping, CameraAntiAliasing, CameraNavigation, CameraScreenshotResult, LightSettings, HazeSettings } from '@opensekai/contracts';
import {makeEntityCopy} from './asset-management';
type CameraLens=Extract<SceneEntity,{kind:'camera'}>['lens'];
export interface EditorView {
 scene: SceneView | null;
 selectedId: Id | null;
 error: ErrorCode | null;
 pending: boolean;
 livePending?: boolean;
}
const failure = (code: ErrorCode): Reply<never> => ({ ok: false, error: { code, message: code, ids: [] } });
export function createEditorModel(api: AppApi) {
 let view: EditorView = { scene: null, selectedId: null, error: null, pending: false, livePending: false };
 let inspecting = false, inspectionEpoch = 0;
 const listeners = new Set<(view: EditorView) => void>();
 const read = (): EditorView => structuredClone(view);
 function publish(next: Partial<EditorView>) {
  view = { ...view, ...next };
  for (const listener of listeners) listener(read());
 }
 async function inspect(allowRevisionReset=false,epoch=inspectionEpoch): Promise<void> {
  const reply = await api.sceneInspect({ sceneId: view.scene?.sceneId ?? 'scene_smoke' });
  if (epoch !== inspectionEpoch) return;
  if (!reply.ok) { publish({ error: reply.error.code }); return; }
  if (!allowRevisionReset && view.scene && reply.data.revision < view.scene.revision) return;
  const selectedId = reply.data.entities.some(entity => entity.id === view.selectedId) ? view.selectedId : null;
  publish({ scene: structuredClone(reply.data), selectedId, error: view.error === 'CONFLICT' ? 'CONFLICT' : null });
 }
 async function execute(command: () => Promise<Reply<{ revision: number }>>, reinspectOnFailure = false, livePending = false): Promise<Reply<{ revision: number }>> {
  if (view.pending) return failure('BUSY');
  if (!view.scene) { publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE'); }
  publish({ pending: true, livePending, error: null });
  try {
   const reply = await command();
   if (reply.ok || reply.error.code === 'CONFLICT' || reinspectOnFailure) {
    try { await inspect(); } catch { publish({ error: 'UNAVAILABLE' }); }
   }
   if (!reply.ok) publish({ error: reply.error.code });
   return reply;
  } catch {
   if (reinspectOnFailure) { try { await inspect(); } catch {} }
   publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE');
  }
  finally { publish({ pending: false, livePending: false }); }
 }
 function patch(operation: PatchOp, expectedRevision?: number, livePending=false) {
  if (expectedRevision !== undefined && expectedRevision !== view.scene?.revision) {
   publish({ error: 'CONFLICT' }); return Promise.resolve(failure('CONFLICT'));
  }
  const revision = expectedRevision ?? view.scene?.revision;
  return execute(() => api.scenePatch({ sceneId: view.scene!.sceneId, expectedRevision: revision!, operations: [operation] }),false,livePending);
 }
 function invalid(code:ErrorCode='INVALID_INPUT') {publish({error:code});return Promise.resolve(failure(code));}
 function ofKind(entityId:Id,kind:SceneEntity['kind']) {return view.scene?.entities.some(entity=>entity.id===entityId&&entity.kind===kind);}
 return {
  read,
  async replaceScene(scene:SceneView):Promise<Reply<SceneView>> {
   if(view.pending)return failure('BUSY');
   if(!view.scene)return invalid('UNAVAILABLE');
   const parsed=ShowSceneSchema.safeParse(scene);
   if(!parsed.success)return invalid();
   publish({pending:true,error:null});
   try {
    const reply=await api.sceneReplace({scene:parsed.data,expectedRevision:view.scene.revision});
    if(reply.ok){
     inspectionEpoch+=1;
     publish({scene:structuredClone(reply.data),selectedId:reply.data.entities.some(entity=>entity.id===view.selectedId)?view.selectedId:null,error:null});
    }else {
     if(reply.error.code==='CONFLICT')await inspect();
     publish({error:reply.error.code});
    }
    return reply;
   }catch{publish({error:'UNAVAILABLE'});return failure('UNAVAILABLE');}
   finally{publish({pending:false});}
  },
  async createEntity(entity:SceneEntity,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=SceneEntitySchema.safeParse(entity);if(!parsed.success)return invalid();
   const reply=await patch({kind:'createEntity',entity:parsed.data},expectedRevision);
   if(reply.ok&&view.scene?.entities.some(item=>item.id===parsed.data.id))publish({selectedId:parsed.data.id});
   return reply;
  },
  renameEntity(entityId:Id,name:string,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=EntityNameSchema.safeParse(name);if(!parsed.success)return invalid();
   return patch({kind:'renameEntity',entityId,name:parsed.data},expectedRevision);
  },
  removeEntity(entityId:Id,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   return patch({kind:'removeEntity',entityId},expectedRevision);
  },
  async duplicateEntity(entityId:Id,id:Id,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const entity=view.scene?.entities.find(item=>item.id===entityId);if(!entity)return invalid('NOT_FOUND');
   const parsed=SceneEntitySchema.safeParse(makeEntityCopy(entity,id,view.scene!.entities));if(!parsed.success)return invalid();
   const reply=await patch({kind:'createEntity',entity:parsed.data},expectedRevision);
   if(reply.ok&&view.scene?.entities.some(item=>item.id===id))publish({selectedId:id});
   return reply;
  },
  setCameraLens(entityId:Id,lens:CameraLens,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=LensSchema.safeParse(lens);if(!ofKind(entityId,'camera')||!parsed.success)return invalid();
   return patch({kind:'setCameraLens',entityId,lens:parsed.data},expectedRevision,live);
  },
  setAvatarIdle(entityId:Id,idleAnimation:AvatarIdle,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=AvatarIdleSchema.safeParse(idleAnimation);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarIdle',entityId,idleAnimation:parsed.data},expectedRevision);
  },
  setAvatarTracking(entityId:Id,tracking:AvatarTracking,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=AvatarTrackingSchema.safeParse(tracking);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarTracking',entityId,tracking:parsed.data},expectedRevision);
  },
  setAvatarModel(entityId:Id,assetId:Id|null,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=IdSchema.nullable().safeParse(assetId);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarModel',entityId,assetId:parsed.data},expectedRevision);
  },
  setAvatarExpression(entityId:Id,name:string,settings:ExpressionSettings|null,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsedName=ExpressionNameSchema.safeParse(name),parsed=ExpressionSettingsSchema.nullable().safeParse(settings);
   if(!ofKind(entityId,'avatar')||!parsedName.success||!parsed.success)return invalid();
   return patch({kind:'setAvatarExpression',entityId,name:parsedName.data,settings:parsed.data},expectedRevision,live);
  },
  setEnvironmentModel(entityId:Id,assetId:Id|null,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=IdSchema.nullable().safeParse(assetId);if(!ofKind(entityId,'environment')||!parsed.success)return invalid();
   return patch({kind:'setEnvironmentModel',entityId,assetId:parsed.data},expectedRevision);
  },
  setEnvironmentReflections(entityId:Id,reflectionsIntensity:number,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=ReflectionsIntensitySchema.safeParse(reflectionsIntensity);if(!ofKind(entityId,'environment')||!parsed.success)return invalid();
   return patch({kind:'setEnvironmentReflections',entityId,reflectionsIntensity:parsed.data},expectedRevision,live);
  },
  setLight(entityId:Id,light:LightSettings,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=LightSettingsSchema.safeParse(light);if(!ofKind(entityId,'light')||!parsed.success)return invalid();
   return patch({kind:'setLight',entityId,light:parsed.data},expectedRevision,live);
  },
  setHaze(entityId:Id,haze:HazeSettings,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=HazeSettingsSchema.safeParse(haze);if(!ofKind(entityId,'haze')||!parsed.success)return invalid();
   return patch({kind:'setHaze',entityId,haze:parsed.data},expectedRevision,live);
  },
  setCameraRenderEnvironment(entityId:Id,renderEnvironment:boolean,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   if(!ofKind(entityId,'camera'))return invalid();
   return patch({kind:'setCameraRenderEnvironment',entityId,renderEnvironment},expectedRevision);
  },
  setCameraAntiAliasing(entityId:Id,antiAliasing:CameraAntiAliasing,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=CameraAntiAliasingSchema.safeParse(antiAliasing);if(!ofKind(entityId,'camera')||!parsed.success)return invalid();
   return patch({kind:'setCameraAntiAliasing',entityId,antiAliasing:parsed.data},expectedRevision);
  },
  setCameraNavigation(entityId:Id,navigation:CameraNavigation,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=CameraNavigationSchema.safeParse(navigation);if(!ofKind(entityId,'camera')||!parsed.success)return invalid();
   return patch({kind:'setCameraNavigation',entityId,navigation:parsed.data},expectedRevision,live);
  },
  // A screenshot is not an edit: it does not change the revision, so it does not block other edits.
  async cameraScreenshot(cameraId:Id):Promise<Reply<CameraScreenshotResult>> {
   if(!view.scene){publish({error:'UNAVAILABLE'});return failure('UNAVAILABLE');}
   if(!ofKind(cameraId,'camera'))return invalid('NOT_FOUND');
   try {
    const reply=await api.cameraScreenshot({cameraId,expectedRevision:view.scene.revision});
    if(!reply.ok){if(reply.error.code==='CONFLICT')try{await inspect();}catch{}publish({error:reply.error.code});}
    return reply;
   }catch{publish({error:'UNAVAILABLE'});return failure('UNAVAILABLE');}
  },
  setTrackingSmoothing(entityId:Id,smoothing:TrackingSmoothing,expectedRevision?:number,live=false):Promise<Reply<{revision:number}>> {
   const parsed=TrackingSmoothingSchema.safeParse(smoothing);if(!ofKind(entityId,'tracking')||!parsed.success)return invalid();
   return patch({kind:'setTrackingSmoothing',entityId,smoothing:parsed.data},expectedRevision,live);
  },
  calibrateTracking(entityId:Id,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   if(!ofKind(entityId,'tracking'))return invalid();
   return patch({kind:'calibrateTracking',entityId},expectedRevision);
  },
  resetTrackingCalibration(entityId:Id,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   if(!ofKind(entityId,'tracking'))return invalid();
   return patch({kind:'setTrackingCalibration',entityId,calibration:null},expectedRevision);
  },
  setTrackingMapping(entityId:Id,mapping:TrackingMapping,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=TrackingMappingSchema.safeParse(mapping);if(!ofKind(entityId,'tracking')||!parsed.success)return invalid();
   return patch({kind:'setTrackingMapping',entityId,mapping:parsed.data},expectedRevision);
  },
  setTrackingConfig(entityId:Id,config:TrackingConfig,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=TrackingConfigSchema.safeParse(config),entity=view.scene?.entities.find(e=>e.id===entityId);
   if(entity?.kind!=='tracking'||!parsed.success||entity.config.kind!==parsed.data.kind)return invalid();
   return patch({kind:'setTrackingConfig',entityId,config:parsed.data},expectedRevision);
  },
  subscribe(listener: (view: EditorView) => void) { listeners.add(listener); listener(read()); return () => { listeners.delete(listener); }; },
  async load(allowRevisionReset=false): Promise<void> {
   if (view.pending || inspecting&&!allowRevisionReset) return;
   if(allowRevisionReset)inspectionEpoch+=1;
   const epoch=inspectionEpoch;
   inspecting = true;
   const initial = view.scene === null;
   if (initial) publish({ pending: true });
   try { await inspect(allowRevisionReset,epoch); } catch { if(epoch===inspectionEpoch)publish({ error: 'UNAVAILABLE' }); }
   finally { if(epoch===inspectionEpoch){inspecting = false; if (initial) publish({ pending: false });} }
  },
  select(entityId: Id): void {
   if (view.scene?.entities.some(entity => entity.id === entityId)) publish({ selectedId: entityId });
  },
  clearSelection(): void { publish({ selectedId: null }); },
  setTransform(entityId: Id, transform: Transform, expectedRevision?: number, live=false): Promise<Reply<{ revision: number }>> {
   const parsed = TransformSchema.safeParse(transform);
   if (!parsed.success) { publish({ error: 'INVALID_INPUT' }); return Promise.resolve(failure('INVALID_INPUT')); }
   if (!view.scene?.entities.some(entity => entity.id === entityId)) { publish({ error: 'NOT_FOUND' }); return Promise.resolve(failure('NOT_FOUND')); }
   return patch({ kind: 'setTransform', entityId, transform: structuredClone(parsed.data) }, expectedRevision,live);
  },
  async setPosition(entityId: Id, position: Vec3): Promise<Reply<{ revision: number }>> {
   if (!position.every(Number.isFinite)) { publish({ error: 'INVALID_INPUT' }); return failure('INVALID_INPUT'); }
   const entity = view.scene?.entities.find(entity => entity.id === entityId);
   if (!entity) { publish({ error: 'NOT_FOUND' }); return failure('NOT_FOUND'); }
   return patch({ kind: 'setTransform', entityId, transform: { ...structuredClone(entity.transform), position: [...position] } });
  },
  setVisibility(entityId: Id, visible: boolean, expectedRevision?: number): Promise<Reply<{ revision: number }>> { return patch({ kind: 'setVisibility', entityId, visible }, expectedRevision); },
  selectCamera(cameraId: Id, expectedRevision?: number): Promise<Reply<{ revision: number }>> {
   if (expectedRevision !== undefined && expectedRevision !== view.scene?.revision) { publish({ error: 'CONFLICT' }); return Promise.resolve(failure('CONFLICT')); }
   return execute(async () => {
    let revision = view.scene!.revision;
    for (const outputId of ['output_main', 'preview_main']) {
     const reply = await api.cameraSelect({ outputId, cameraId, expectedRevision: revision });
     if (!reply.ok) return reply;
     revision = reply.data.revision;
    }
    return { ok: true, data: { revision } };
   }, true);
  },
 };
}
export type EditorModel = ReturnType<typeof createEditorModel>;
export interface EditorPanelProps { model: EditorModel; view: EditorView }
