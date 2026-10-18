import type {ErrorCode,Id,Reply,SceneEntity} from '@opensekai/contracts';
import type {EditorModel} from './model';
// One live request: `send` runs one patch with `live = true` at the given revision; `matches` checks that the reply scene holds the value.
export interface LiveRequest {entityId:Id;send(revision:number):Promise<Reply<{revision:number}>>;matches?(entity:SceneEntity|undefined):boolean}
type Edit=LiveRequest&{revision:number;selection:string|null};
// Keeps the latest request, sends at most one at a time with at least 16 ms between sends, and follows the revision chain of its own replies (B12 R13).
export function createLiveEdit(model:EditorModel,onError:(code:ErrorCode)=>void=()=>{},onPending:(pending:boolean)=>void=()=>{}){
 let latest:Edit|null=null,active:Edit|null=null,closed=false,timer:ReturnType<typeof setTimeout>|undefined,lastSent=-Infinity;
 let pendingState=false,editing=false;
 function pending(){const value=!closed&&(active!==null||latest!==null);if(value!==pendingState){pendingState=value;onPending(value);}}
 let anchor:{revision:number;selection:string|null}|null=null;
 function cancel(){editing=false;anchor=null;latest=null;if(timer!==undefined)clearTimeout(timer);timer=undefined;pending();}
 function fail(code:ErrorCode){cancel();onError(code);}
 function schedule(){if(closed||active||timer!==undefined||!latest)return;timer=setTimeout(()=>{timer=undefined;void flush();},Math.max(16,16-(performance.now()-lastSent)));}
 async function flush(){
  if(closed||active||!latest)return;
  const edit=latest,view=model.read();latest=null;
  if(view.selectedId!==edit.selection){pending();return;}
  if(view.scene?.revision!==edit.revision){fail('CONFLICT');return;}
  if(view.pending){fail('BUSY');return;}
  active=edit;lastSent=performance.now();
  const reply=await edit.send(edit.revision);
  active=null;if(closed){pending();return;}
  if(!reply.ok){fail(reply.error.code);return;}
  const current=model.read(),entity=current.scene?.entities.find(e=>e.id===edit.entityId);
  if(current.selectedId!==edit.selection){cancel();return;}
  if(current.scene?.revision!==reply.data.revision||!(edit.matches?.(entity)??true)){fail(current.error??'CONFLICT');return;}
  anchor=editing?{revision:reply.data.revision,selection:edit.selection}:null;
  const queued=latest as Edit|null;
  if(queued){if(queued.revision!==edit.revision&&queued.revision!==reply.data.revision){fail('CONFLICT');return;}queued.revision=reply.data.revision;schedule();}
  pending();
 }
 const unsubscribe=model.subscribe(view=>{
  if(anchor&&view.selectedId!==anchor.selection){cancel();return;}
  if(anchor&&!active&&view.scene?.revision!==anchor.revision){fail('CONFLICT');return;}
  if(!latest)return;
  if(view.selectedId!==latest.selection){cancel();return;}
  if(!active&&view.scene?.revision!==latest.revision)fail('CONFLICT');
 });
 return{
  offer(request:LiveRequest){
   const view=model.read();
   if(active&&active.selection!==view.selectedId)return false;
   if(closed||!view.scene||view.selectedId!==request.entityId||view.pending&&!view.livePending)return false;
   if(!view.scene.entities.some(e=>e.id===request.entityId))return false;
   editing=true;anchor??={revision:view.scene.revision,selection:view.selectedId};
   latest={...request,revision:view.scene.revision,selection:view.selectedId};pending();schedule();return true;
  },
  end(){editing=false;anchor=null;},
  cancel,
  close(){closed=true;cancel();unsubscribe();},
 };
}
export type LiveEdit=ReturnType<typeof createLiveEdit>;
