import {LensSchema,TrackingConfigSchema} from '@opensekai/contracts';
import type {SceneEntity,TrackingConfig,AvatarIdle,AvatarTracking,TrackingStatus,TrackingSmoothing} from '@opensekai/contracts';
export type CameraLens=Extract<SceneEntity,{kind:'camera'}>['lens'];
export type AddKind='camera'|'character'|'environment'|'directionalLight'|'pointLight'|'spotLight'|'ambientLight'|'haze'|TrackingConfig['kind'];
export type Commit<T>=(id:string,value:T,revision:number)=>Promise<unknown>;
export interface LivePropertyCallbacks {onlens?:Commit<CameraLens>;onavatartracking?:Commit<AvatarTracking>;onavataridle?:Commit<AvatarIdle>;ontrackingsmoothing?:Commit<TrackingSmoothing>;ontrackingconfig?:Commit<TrackingConfig>;ontrackingtoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>;trackingStatus?:TrackingStatus[];localAddresses?:string[];devices?:{deviceId:string;label:string}[]}
export function parseLens(values:Record<keyof CameraLens,string>):CameraLens|null {const parsed=LensSchema.safeParse(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim()===''?NaN:Number(value)])));return parsed.success?parsed.data:null;}
export function reconcileDraft<T>(previousKey:string|null,source:{entityId:string;revision:number},values:T,base:T):{key:string;values:T}{const key=`${source.entityId}:${source.revision}`;return {key,values:key===previousKey?values:structuredClone(base)};}
export type SourceOption={value:string;label:string;disabled:boolean};
// A source that another avatar uses is disabled. The current value of the select stays enabled.
export function sourceOptions(entities:readonly SceneEntity[],channel:'body'|'face',avatarId:string):SourceOption[] {
 const avatars=entities.flatMap(entity=>entity.kind==='avatar'?[entity]:[]);
 const own=avatars.find(avatar=>avatar.id===avatarId)?.tracking?.[channel==='body'?'bodySourceId':'faceSourceId']??null;
 const used=new Set(avatars.filter(avatar=>avatar.id!==avatarId).flatMap(avatar=>[avatar.tracking?.bodySourceId,avatar.tracking?.faceSourceId]));
 return [{value:'',label:'None',disabled:false},...entities.filter(entity=>entity.kind==='tracking'&&(channel==='face'||entity.config.kind!=='ifacialmocap')).map(entity=>({value:entity.id,label:entity.name,disabled:entity.id!==own&&used.has(entity.id)}))];
}
export function parseTrackingConfig(config:TrackingConfig,values:{bindAddress:string;port:string;address:string}):TrackingConfig|null {const candidate=config.kind==='mediapipe'?config:{...config,bindAddress:values.bindAddress.trim(),port:values.port.trim()===''?NaN:Number(values.port),[config.kind==='vmc'?'senderAddress':'phoneAddress']:values.address.trim()||null};const parsed=TrackingConfigSchema.safeParse(candidate);return parsed.success?parsed.data:null;}
export function matchingStatus(statuses:TrackingStatus[],id:string,generation:number){return statuses.find(status=>status.sourceId===id&&status.generation===generation);}

export function initialTrackingDraft(config:TrackingConfig){return {config:{...config},bindAddress:config.kind==='mediapipe'?'':config.bindAddress,port:config.kind==='mediapipe'?'':String(config.port),address:config.kind==='vmc'?config.senderAddress??'':config.kind==='ifacialmocap'?config.phoneAddress??'':''};}

export function cameraOptions(entities:readonly SceneEntity[]){return entities.filter(entity=>entity.kind==='camera').map(entity=>({value:entity.id,label:entity.name}));}

export const antiAliasingOptions=[{value:'none',label:'None'},{value:'fxaa',label:'FXAA'}];
export const qualityOptions=[{value:'production_v1',label:'Production'},{value:'performance_v1',label:'Performance'},{value:'preview_v1',label:'Preview'}];
