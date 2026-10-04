import { TransformSchema,SceneEntitySchema,LensSchema,AvatarTrackingSchema,AvatarIdleSchema,TrackingConfigSchema,TrackingSmoothingSchema,EntityNameSchema } from '@opensekai/contracts';
import type { AppApi, ErrorCode, Id, PatchOp, Reply, SceneView, Vec3, Transform, SceneEntity, AvatarTracking, AvatarIdle, TrackingConfig, TrackingSmoothing } from '@opensekai/contracts';
import {makeEntityCopy} from './asset-management';
type CameraLens=Extract<SceneEntity,{kind:'camera'}>['lens'];
export interface EditorView {
 scene: SceneView | null;
 selectedId: Id | null;
 error: ErrorCode | null;
 pending: boolean;
 transformPending?: boolean;
}
const failure = (code: ErrorCode): Reply<never> => ({ ok: false, error: { code, message: code, ids: [] } });
export function createEditorModel(api: AppApi) {
 let view: EditorView = { scene: null, selectedId: null, error: null, pending: false, transformPending: false };
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
 async function execute(command: () => Promise<Reply<{ revision: number }>>, reinspectOnFailure = false, transformPending = false): Promise<Reply<{ revision: number }>> {
  if (view.pending) return failure('BUSY');
  if (!view.scene) { publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE'); }
  publish({ pending: true, transformPending, error: null });
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
  finally { publish({ pending: false, transformPending: false }); }
 }
 function patch(operation: PatchOp, expectedRevision?: number, transformPending=false) {
  if (expectedRevision !== undefined && expectedRevision !== view.scene?.revision) {
   publish({ error: 'CONFLICT' }); return Promise.resolve(failure('CONFLICT'));
  }
  const revision = expectedRevision ?? view.scene?.revision;
  return execute(() => api.scenePatch({ sceneId: view.scene!.sceneId, expectedRevision: revision!, operations: [operation] }),false,transformPending);
 }
 function invalid(code:ErrorCode='INVALID_INPUT') {publish({error:code});return Promise.resolve(failure(code));}
 function ofKind(entityId:Id,kind:SceneEntity['kind']) {return view.scene?.entities.some(entity=>entity.id===entityId&&entity.kind===kind);}
 return {
  read,
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
  setCameraLens(entityId:Id,lens:CameraLens,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=LensSchema.safeParse(lens);if(!ofKind(entityId,'camera')||!parsed.success)return invalid();
   return patch({kind:'setCameraLens',entityId,lens:parsed.data},expectedRevision);
  },
  setAvatarIdle(entityId:Id,idleAnimation:AvatarIdle,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=AvatarIdleSchema.safeParse(idleAnimation);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarIdle',entityId,idleAnimation:parsed.data},expectedRevision);
  },
  setAvatarTracking(entityId:Id,tracking:AvatarTracking,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=AvatarTrackingSchema.safeParse(tracking);if(!ofKind(entityId,'avatar')||!parsed.success)return invalid();
   return patch({kind:'setAvatarTracking',entityId,tracking:parsed.data},expectedRevision);
  },
  setTrackingSmoothing(entityId:Id,smoothing:TrackingSmoothing,expectedRevision?:number):Promise<Reply<{revision:number}>> {
   const parsed=TrackingSmoothingSchema.safeParse(smoothing);if(!ofKind(entityId,'tracking')||!parsed.success)return invalid();
   return patch({kind:'setTrackingSmoothing',entityId,smoothing:parsed.data},expectedRevision);
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
