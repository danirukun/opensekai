import {TransformSchema,type Transform,type ErrorCode} from '@opensekai/contracts';
import type {EditorModel} from './model';
import {createLiveEdit} from './live-edit';
function sameTransform(actual:Transform|undefined,expected:Transform){return actual!==undefined&&(['position','rotation','scale'] as const).every(row=>actual[row].every((value,index)=>Math.abs(value-expected[row][index]!)<=1e-9));}
export function createLiveTransform(model:EditorModel,onError:(code:ErrorCode)=>void=()=>{},onPending:(pending:boolean)=>void=()=>{}){
 const live=createLiveEdit(model,onError,onPending);
 return{
  offer(entityId:string,transform:Transform){
   const parsed=TransformSchema.safeParse(transform);
   if(!parsed.success||!model.read().scene?.entities.some(e=>e.id===entityId&&e.kind!=='tracking'))return false;
   const value=structuredClone(parsed.data);
   return live.offer({entityId,send:revision=>model.setTransform(entityId,value,revision,true),matches:entity=>sameTransform(entity?.transform,value)});
  },
  end:live.end,
  cancel:live.cancel,
  close:live.close,
 };
}
