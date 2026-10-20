import { IdSchema, TransformSchema } from '@opensekai/contracts';
import type { Transform } from '@opensekai/contracts';
import type {AssetLoadStatus} from '@opensekai/renderer';
export type Tool = 'translate' | 'rotate' | 'scale';
export type Draft = { entityId: string; transform: Transform } | null;
export type UIMessage = {kind:'selection'; entityId:string|null} | {kind:'tool';tool:Tool} | {kind:'draft';draft:Draft} | {kind:'refresh'} | {kind:'ready'} | {kind:'loadStatus';entries:AssetLoadStatus[]} | {kind:'trackingDevices';devices:{deviceId:string;label:string}[]};
export function parseUIMessage(value: unknown): UIMessage | null {
 try {
  if (!value || typeof value !== 'object' || new TextEncoder().encode(JSON.stringify(value)).length > 4096) return null;
  const v = value as Record<string,unknown>;
  const keys = (expected:string[]) => Object.keys(v).length === expected.length && expected.every(key => key in v);
  if(v.kind==='trackingDevices'&&keys(['kind','devices'])&&Array.isArray(v.devices)&&v.devices.length<=16){
   if(v.devices.every(device=>device&&typeof device==='object'&&Object.keys(device).length===2&&typeof device.deviceId==='string'&&device.deviceId.length<=512&&typeof device.label==='string'&&device.label.length<=128))return {kind:'trackingDevices',devices:v.devices.map(device=>({deviceId:device.deviceId,label:device.label}))};
  }
  if(v.kind==='loadStatus'&&keys(['kind','entries'])&&Array.isArray(v.entries)&&v.entries.length<=8){
   const stages=['download','textures','prepare','failed'];
   const entries=v.entries.map(item=>{
    if(!item||typeof item!=='object')return null;
    const e=item as Record<string,unknown>,allowed=['entityId','assetId','stage','progress','count','message'];
    if(Object.keys(e).some(key=>!allowed.includes(key)))return null;
    if(!IdSchema.safeParse(e.entityId).success||!IdSchema.safeParse(e.assetId).success||!stages.includes(e.stage as string))return null;
    if(!(e.progress===null||(typeof e.progress==='number'&&e.progress>=0&&e.progress<=1)))return null;
    const c=e.count as Record<string,unknown>|undefined;
    if(c!==undefined&&!(c&&typeof c==='object'&&Object.keys(c).length===2&&Number.isInteger(c.done)&&Number.isInteger(c.total)&&(c.done as number)>=0&&(c.done as number)<=(c.total as number)&&(c.total as number)<=1024))return null;
    if(e.message!==undefined&&!(typeof e.message==='string'&&e.message.length<=160))return null;
    return {entityId:e.entityId,assetId:e.assetId,stage:e.stage,progress:e.progress,...(c?{count:{done:c.done,total:c.total}}:{}),...(e.message!==undefined?{message:e.message}:{})} as AssetLoadStatus;
   });
   if(entries.every(entry=>entry!==null))return {kind:'loadStatus',entries:entries as AssetLoadStatus[]};
  }
  if ((v.kind==='ready' ||v.kind==='refresh') && keys(['kind'])) return {kind:v.kind};
  if (v.kind==='selection' && keys(['kind','entityId']) && (v.entityId===null || IdSchema.safeParse(v.entityId).success)) return {kind:'selection',entityId:v.entityId as string|null};
  if (v.kind==='tool' && keys(['kind','tool']) && ['translate','rotate','scale'].includes(v.tool as string)) return {kind:'tool',tool:v.tool as Tool};
  if (v.kind==='draft' && keys(['kind','draft'])) {
   if(v.draft===null)return {kind:'draft',draft:null};
   const d=v.draft as Record<string,unknown>;
   if(!d || typeof d!=='object' || Object.keys(d).length!==2 || !IdSchema.safeParse(d.entityId).success)return null;
   const t=TransformSchema.safeParse(d.transform);
   if(t.success)return {kind:'draft',draft:{entityId:d.entityId as string,transform:t.data}};
  }
 } catch { /* Reject cyclic or otherwise malformed values. */ }
 return null;
}
// One active send and one latest draft. No pointer event backlog crosses IPC.
export function createDraftSender(send:(message:UIMessage)=>Promise<void>,fail:()=>void=()=>{}) {
 let latest:UIMessage|null=null,active=false,closed=false,timer:ReturnType<typeof setTimeout>|undefined;
 function schedule(){if(closed||active||timer||!latest)return;timer=setTimeout(()=>{timer=undefined;void flush();},50);}
 async function flush(){if(closed||active||!latest)return;const message=latest;latest=null;active=true;try{await send(message);}catch{fail();}finally{active=false;schedule();}}
 return {offer(draft:Draft){if(closed)return;latest={kind:'draft',draft:structuredClone(draft)};schedule();},close(){closed=true;latest=null;if(timer)clearTimeout(timer);}};
}
export function fitPreview(width:number,height:number,inset=0){const w=Math.max(0,Math.min(width-inset*2,(height-inset*2)*16/9));return {width:w,height:w*9/16};}
