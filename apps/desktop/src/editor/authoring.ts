import {AppErrorSchema,defaultTrackingConfig,type AssetRecord,type SceneEntity,type SceneView} from '@opensekai/contracts';
import type {AddKind} from './live-fields';
import {AMBIENT_LIGHT,DIRECTIONAL_LIGHT,FPS_COUNTER,HAZE,POINT_LIGHT,SPOT_LIGHT,hazeTransform,lightTransform} from './lights';
type Vec3=[number,number,number];
const lastAvatar=(entities:readonly SceneEntity[])=>entities.filter(entity=>entity.kind==='avatar').at(-1);
// A new character stands 1 m along world +X from the last avatar in scene order, or at the origin.
export function nextAvatarPosition(entities:readonly SceneEntity[]):Vec3 {
 const last=lastAvatar(entities);
 if(!last)return [0,0,0];
 const [x,y,z]=last.transform.position;
 return [x+1,y,z];
}
export function nextAvatarTransform(entities:readonly SceneEntity[],scale:Vec3=[1,1,1]):SceneEntity['transform'] {
 return {position:nextAvatarPosition(entities),rotation:structuredClone(lastAvatar(entities)?.transform.rotation??[0,0,0,1]),scale:structuredClone(scale)};
}
const transform=()=>({position:[0,0,0] as [number,number,number],rotation:[0,0,0,1] as [number,number,number,number],scale:[1,1,1] as [number,number,number]});
export function makeAuthoringEntity(kind:AddKind,id:string,entities:readonly SceneEntity[]):SceneEntity {
 const label=({camera:'Camera',character:'Character',environment:'Environment',directionalLight:'Directional Light',pointLight:'Point Light',spotLight:'Spot Light',ambientLight:'Ambient Light',haze:'Haze',fpsCounter:'FPS Counter',vmc:'VMC Receiver',ifacialmocap:'iFacialMocap Receiver',mediapipe:'MediaPipe Tracker'} as const)[kind];
 const taken=new Set(entities.map(entity=>entity.name));
 let n=2;while(taken.has(`${label} ${n}`))n++;
 const base={id,name:taken.has(label)?`${label} ${n}`:label,visible:true,transform:transform()};
 if(kind==='camera')return {...base,kind,transform:{...base.transform,position:[0,1.2,3]},lens:{fovDegrees:40,near:.01,far:100},navigation:{mode:'freeLook',sensitivity:1}};
 if(kind==='character')return {...base,kind:'avatar',transform:nextAvatarTransform(entities),assetId:null,tracking:{bodySourceId:null,faceSourceId:null},idleAnimation:{kind:'builtin',enabled:true}};
 if(kind==='environment')return {...base,kind,assetId:null};
 if(kind==='directionalLight')return {...base,kind:'light',transform:lightTransform('directional'),light:structuredClone(DIRECTIONAL_LIGHT)};
 if(kind==='pointLight')return {...base,kind:'light',transform:lightTransform('point'),light:structuredClone(POINT_LIGHT)};
 if(kind==='spotLight')return {...base,kind:'light',transform:lightTransform('spot'),light:structuredClone(SPOT_LIGHT)};
 if(kind==='ambientLight')return {...base,kind:'light',transform:lightTransform('ambient'),light:structuredClone(AMBIENT_LIGHT)};
 if(kind==='haze')return {...base,kind:'haze',transform:hazeTransform(),haze:{...HAZE}};
 if(kind==='fpsCounter')return {...base,kind:'fpsCounter',fpsCounter:{...FPS_COUNTER}};
 return {...base,kind:'tracking',generation:0,config:defaultTrackingConfig(kind)};
}
export function modelLabel(assetId:string|null,assets:readonly AssetRecord[]):string {
 if(assetId===null)return 'Choose VRM…';
 return assets.find(asset=>asset.id===assetId)?.name??'Missing model';
}
export function makeEmptyScene():SceneView {
 return {schemaVersion:1,sceneId:'scene_smoke',revision:0,entities:[makeAuthoringEntity('camera','camera_main',[]),makeAuthoringEntity('directionalLight','light_main',[])],outputs:['output_main','preview_main'].map(id=>({id,cameraId:'camera_main',width:1920,height:1080,fps:60}))};
}

export function importFailure(cause:unknown,fallback='Could not import avatar'):string {const parsed=AppErrorSchema.safeParse(cause);return parsed.success?parsed.data.message.slice(0,160):fallback;}
