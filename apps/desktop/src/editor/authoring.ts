import {AppErrorSchema,defaultTrackingConfig,type AssetRecord,type SceneEntity,type SceneView} from '@opensekai/contracts';
import type {AddKind} from './live-fields';
const transform=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
export function makeAuthoringEntity(kind:AddKind,id:string,entities:readonly SceneEntity[]):SceneEntity {
 const label=({camera:'Camera',character:'Character',vmc:'VMC Receiver',ifacialmocap:'iFacialMocap Receiver',mediapipe:'MediaPipe Tracker'} as const)[kind];
 const taken=new Set(entities.map(entity=>entity.name));
 let n=2;while(taken.has(`${label} ${n}`))n++;
 const base={id,name:taken.has(label)?`${label} ${n}`:label,visible:true,transform:transform()};
 if(kind==='camera')return {...base,kind,transform:{...base.transform,position:[0,1.2,3]},lens:{fovDegrees:40,near:.01,far:100}};
 if(kind==='character')return {...base,kind:'avatar',assetId:null,tracking:{bodySourceId:null,faceSourceId:null},idleAnimation:{kind:'builtin',enabled:true}};
 return {...base,kind:'tracking',generation:0,config:defaultTrackingConfig(kind)};
}
export function modelLabel(assetId:string|null,assets:readonly AssetRecord[]):string {
 if(assetId===null)return 'Choose VRM…';
 return assets.find(asset=>asset.id===assetId)?.name??'Missing model';
}
export function makeEmptyScene():SceneView {
 return {schemaVersion:1,sceneId:'scene_smoke',revision:0,entities:[makeAuthoringEntity('camera','camera_main',[])],outputs:['output_main','preview_main'].map(id=>({id,cameraId:'camera_main',width:1920,height:1080,fps:60}))};
}

export function importFailure(cause:unknown):string {const parsed=AppErrorSchema.safeParse(cause);return parsed.success?parsed.data.message.slice(0,160):'Could not import avatar';}
