import {TransformSchema,type Transform,type ErrorCode} from '@opensekai/contracts';
import type {EditorModel} from './model';
function sameTransform(actual:Transform|undefined,expected:Transform){return actual!==undefined&&(['position','rotation','scale'] as const).every(row=>actual[row].every((value,index)=>Math.abs(value-expected[row][index]!)<=1e-9));}
type Edit={entityId:string;transform:Transform;revision:number;selection:string|null};
export function createLiveTransform(model:EditorModel,onError:(code:ErrorCode)=>void=()=>{},onPending:(pending:boolean)=>void=()=>{}){
 let latest:Edit|null=null,active:Edit|null=null,closed=false,timer:ReturnType<typeof setTimeout>|undefined,lastSent=-Infinity;
 let pendingState=false;
 function pending(){const value=!closed&&(active!==null||latest!==null);if(value!==pendingState){pendingState=value;onPending(value);}}
 let anchor:{revision:number;selection:string|null}|null=null;
 function cancel(){anchor=null;latest=null;if(timer!==undefined)clearTimeout(timer);timer=undefined;pending();}
 function fail(code:ErrorCode){cancel();onError(code);}
 function schedule(){if(closed||active||timer!==undefined||!latest)return;timer=setTimeout(()=>{timer=undefined;void flush();},Math.max(16,16-(performance.now()-lastSent)));}
 async function flush(){
  if(closed||active||!latest)return;
  const edit=latest,view=model.read();latest=null;
  if(view.selectedId!==edit.selection){pending();return;}
  if(view.scene?.revision!==edit.revision){fail('CONFLICT');return;}
  if(view.pending){fail('BUSY');return;}
  active=edit;lastSent=performance.now();
  const reply=await model.setTransform(edit.entityId,edit.transform,edit.revision,true);
  active=null;if(closed){pending();return;}
  if(!reply.ok){fail(reply.error.code);return;}
  const current=model.read(),entity=current.scene?.entities.find(e=>e.id===edit.entityId);
  if(current.selectedId!==edit.selection){cancel();return;}
  if(current.scene?.revision!==reply.data.revision||!sameTransform(entity?.transform,edit.transform)){fail(current.error??'CONFLICT');return;}
  anchor={revision:reply.data.revision,selection:edit.selection};
  const queued=peek();
  if(queued){if(queued.revision!==edit.revision&&queued.revision!==reply.data.revision){fail('CONFLICT');return;}queued.revision=reply.data.revision;schedule();}
  pending();
 }
 function peek():Edit|null{return latest;}
 const unsubscribe=model.subscribe(view=>{
  if(anchor&&view.selectedId!==anchor.selection){cancel();return;}
  if(anchor&&!active&&view.scene?.revision!==anchor.revision){fail('CONFLICT');return;}
  if(!latest)return;
  if(view.selectedId!==latest.selection){cancel();return;}
  if(!active&&view.scene?.revision!==latest.revision)fail('CONFLICT');
 });
 return{
  offer(entityId:string,transform:Transform){
   const parsed=TransformSchema.safeParse(transform),view=model.read();
   if(active&&active.selection!==view.selectedId)return false;
   if(closed||!parsed.success||!view.scene||view.selectedId!==entityId||view.pending&&!view.transformPending)return false;
   if(!view.scene.entities.some(e=>e.id===entityId&&e.kind!=='tracking'))return false;
   anchor??={revision:view.scene.revision,selection:view.selectedId};
   latest={entityId,transform:structuredClone(parsed.data),revision:view.scene.revision,selection:view.selectedId};pending();schedule();return true;
  },
  cancel,
  close(){closed=true;cancel();unsubscribe();},
 };
}
