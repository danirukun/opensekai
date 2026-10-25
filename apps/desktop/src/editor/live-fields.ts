import {ARKIT_NAMES,DEFAULT_TRACKING_MAPPING,FACE_ONLY_TRACKING_KINDS,LensSchema,TrackingConfigSchema,TrackingMappingSchema} from '@opensekai/contracts';
import type {SceneEntity,TrackingConfig,AvatarIdle,AvatarTracking,TrackingStatus,TrackingSmoothing,TrackingMapping,Reply} from '@opensekai/contracts';
export type CameraLens=Extract<SceneEntity,{kind:'camera'}>['lens'];
export type AddKind='camera'|'character'|'environment'|'directionalLight'|'pointLight'|'spotLight'|'ambientLight'|'haze'|'fpsCounter'|'vmcSender'|TrackingConfig['kind'];
export type Commit<T>=(id:string,value:T,revision:number)=>Promise<unknown>;
export interface LivePropertyCallbacks {onlens?:Commit<CameraLens>;onavatartracking?:Commit<AvatarTracking>;onavataridle?:Commit<AvatarIdle>;ontrackingsmoothing?:Commit<TrackingSmoothing>;ontrackingmapping?:Commit<TrackingMapping>;ontrackingcalibrate?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>;ontrackingcalibrationreset?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>;ontrackingconfig?:Commit<TrackingConfig>;ontrackingtoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>;trackingStatus?:TrackingStatus[];localAddresses?:string[];devices?:{deviceId:string;label:string}[]}
export function parseLens(values:Record<keyof CameraLens,string>):CameraLens|null {const parsed=LensSchema.safeParse(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim()===''?NaN:Number(value)])));return parsed.success?parsed.data:null;}
export function reconcileDraft<T>(previousKey:string|null,source:{entityId:string;revision:number},values:T,base:T):{key:string;values:T}{const key=`${source.entityId}:${source.revision}`;return {key,values:key===previousKey?values:structuredClone(base)};}
export type SourceOption={value:string;label:string;disabled:boolean};
export type SourceChannel='body'|'face'|'fingers';
const slot={body:'bodySourceId',face:'faceSourceId',fingers:'fingersSourceId'} as const;
// A source that another avatar uses in any slot is disabled. The current value of the select stays enabled.
// Only the face slot lists face-only sources (iFacialMocap, OpenSeeFace).
export function sourceOptions(entities:readonly SceneEntity[],channel:SourceChannel,avatarId:string):SourceOption[] {
 const avatars=entities.flatMap(entity=>entity.kind==='avatar'?[entity]:[]);
 const own=avatars.find(avatar=>avatar.id===avatarId)?.tracking?.[slot[channel]]??null;
 const used=new Set(avatars.filter(avatar=>avatar.id!==avatarId).flatMap(avatar=>[avatar.tracking?.bodySourceId,avatar.tracking?.faceSourceId,avatar.tracking?.fingersSourceId]));
 return [{value:'',label:'None',disabled:false},...entities.filter(entity=>entity.kind==='tracking'&&(channel==='face'||!FACE_ONLY_TRACKING_KINDS.includes(entity.config.kind))).map(entity=>({value:entity.id,label:entity.name,disabled:entity.id!==own&&used.has(entity.id)}))];
}
// One select changes one slot; the other two keep their IDs. An empty finger slot is left out.
export function withSource(tracking:AvatarTracking|undefined,channel:SourceChannel,value:string):AvatarTracking {
 const next={bodySourceId:tracking?.bodySourceId??null,faceSourceId:tracking?.faceSourceId??null,fingersSourceId:tracking?.fingersSourceId??null,[slot[channel]]:value||null};
 const {fingersSourceId,...rest}=next;return fingersSourceId?{...rest,fingersSourceId}:rest;
}
export type RangeDraft={inputMin:string;inputMax:string;outputMin:string;outputMax:string};
export interface MappingDraft {headIntensity:string;headOffset:[string,string,string];eyeIntensity:string;blendShapeSensitivity:string;linkedBlink:boolean;useEyeBones:boolean;blendShapes:Record<string,RangeDraft>}
const DEFAULT_RANGE={inputMin:0,inputMax:1,outputMin:0,outputMax:1};
// Each ARKit name has a row. A name with no range shows the default range.
export function mappingDraft(mapping:TrackingMapping|undefined):MappingDraft {
 const m=mapping??DEFAULT_TRACKING_MAPPING;
 return {headIntensity:String(m.headIntensity),headOffset:m.headOffset.map(String) as [string,string,string],eyeIntensity:String(m.eyeIntensity),blendShapeSensitivity:String(m.blendShapeSensitivity),linkedBlink:m.linkedBlink,useEyeBones:m.useEyeBones??true,
  blendShapes:Object.fromEntries(ARKIT_NAMES.map(name=>{const r=m.blendShapes[name]??DEFAULT_RANGE;return [name,{inputMin:String(r.inputMin),inputMax:String(r.inputMax),outputMin:String(r.outputMin),outputMax:String(r.outputMax)}];}))};
}
const num=(value:string)=>value.trim()===''?NaN:Number(value);
// Only the named rows become ranges, so an untouched row commits nothing.
export function parseMappingDraft(draft:MappingDraft,ranges:ReadonlySet<string>):TrackingMapping|null {
 const blendShapes=Object.fromEntries([...ranges].map(name=>{const r=draft.blendShapes[name];return [name,r?{inputMin:num(r.inputMin),inputMax:num(r.inputMax),outputMin:num(r.outputMin),outputMax:num(r.outputMax)}:null];}));
 const parsed=TrackingMappingSchema.safeParse({headIntensity:num(draft.headIntensity),headOffset:draft.headOffset.map(num),eyeIntensity:num(draft.eyeIntensity),blendShapeSensitivity:num(draft.blendShapeSensitivity),linkedBlink:draft.linkedBlink,blendShapes,...(draft.useEyeBones?{}:{useEyeBones:false})});
 return parsed.success?parsed.data:null;
}
// The config field that the Inspector shows as the address of a UDP source.
export const addressKey=(config:Exclude<TrackingConfig,{kind:'mediapipe'}>)=>config.kind==='ifacialmocap'?'phoneAddress':'senderAddress';
export function parseTrackingConfig(config:TrackingConfig,values:{bindAddress:string;port:string;address:string}):TrackingConfig|null {const candidate=config.kind==='mediapipe'?config:{...config,bindAddress:values.bindAddress.trim(),port:values.port.trim()===''?NaN:Number(values.port),[addressKey(config)]:values.address.trim()||null};const parsed=TrackingConfigSchema.safeParse(candidate);return parsed.success?parsed.data:null;}
export function matchingStatus(statuses:TrackingStatus[],id:string,generation:number){return statuses.find(status=>status.sourceId===id&&status.generation===generation);}

export function initialTrackingDraft(config:TrackingConfig){return {config:{...config},bindAddress:config.kind==='mediapipe'?'':config.bindAddress,port:config.kind==='mediapipe'?'':String(config.port),address:config.kind==='ifacialmocap'?config.phoneAddress??'':config.kind==='mediapipe'?'':config.senderAddress??''};}

export function cameraOptions(entities:readonly SceneEntity[]){return entities.filter(entity=>entity.kind==='camera').map(entity=>({value:entity.id,label:entity.name}));}

export const antiAliasingOptions=[{value:'none',label:'None'},{value:'fxaa',label:'FXAA'}];
export const qualityOptions=[{value:'production_v1',label:'Production'},{value:'performance_v1',label:'Performance'},{value:'preview_v1',label:'Preview'}];
// A rejected change leaves the scene value as it was, so Svelte does not reset the box; put the scene value back.
export function settleCheckbox(box:{checked:boolean},reply:Reply<unknown>|undefined,current:boolean|undefined):void {if(!reply?.ok&&current!==undefined)box.checked=current;}
