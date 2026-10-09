import type {AssetLoadStatus} from '@opensekai/renderer';
import type {UIMessage} from './ui-message';
export function stageLabel(entry:AssetLoadStatus):string{
 if(entry.stage==='download')return 'Downloading';
 if(entry.stage==='textures')return entry.count?`Textures ${entry.count.done} of ${entry.count.total}`:'Textures';
 if(entry.stage==='prepare')return 'Preparing';
 return entry.message??'Load failed';
}
// The bridge parser rejects a long message or a large count, so clamp each entry to its bounds before it goes out.
const clamp=({count,message,...entry}:AssetLoadStatus):AssetLoadStatus=>({...entry,...(count&&count.total<=1024&&count.done<=count.total?{count}:{}),...(message!==undefined?{message:message.slice(0,160)}:{})});
const shape=(entries:AssetLoadStatus[])=>entries.map(entry=>`${entry.entityId}:${entry.assetId}:${entry.stage}`).join('|');
// Stage changes go out at once; progress-only changes go out at most once per interval.
export function createLoadStatusSender(send:(message:UIMessage)=>Promise<void>,intervalMs=200){
 let latest:AssetLoadStatus[]=[],sentShape='',timer:ReturnType<typeof setTimeout>|undefined,closed=false;
 const flush=()=>{timer=undefined;if(closed)return;sentShape=shape(latest);void send({kind:'loadStatus',entries:latest}).catch(()=>{});};
 return {
  offer(entries:AssetLoadStatus[]){
   if(closed)return;latest=entries.slice(0,8).map(clamp);
   if(shape(latest)!==sentShape){if(timer){clearTimeout(timer);}flush();return;}
   timer??=setTimeout(flush,intervalMs);
  },
  resend(){if(timer){clearTimeout(timer);}flush();},
  close(){closed=true;if(timer)clearTimeout(timer);},
 };
}
