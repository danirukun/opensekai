import {LensSchema,TrackingConfigSchema,TrackingSmoothingSchema} from '@opensekai/contracts';
import type {SceneEntity,TrackingConfig,AvatarIdle,AvatarTracking,TrackingStatus,TrackingSmoothing} from '@opensekai/contracts';
export type CameraLens=Extract<SceneEntity,{kind:'camera'}>['lens'];
export type AddKind='camera'|TrackingConfig['kind'];
export type Commit<T>=(id:string,value:T,revision:number)=>Promise<unknown>;
export interface LivePropertyCallbacks {onlens?:Commit<CameraLens>;onavatartracking?:Commit<AvatarTracking>;onavataridle?:Commit<AvatarIdle>;ontrackingsmoothing?:Commit<TrackingSmoothing>;ontrackingconfig?:Commit<TrackingConfig>;ontrackingtoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>;trackingStatus?:TrackingStatus[];devices?:{deviceId:string;label:string}[]}
export function parseLens(values:Record<keyof CameraLens,string>):CameraLens|null {const parsed=LensSchema.safeParse(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim()===''?NaN:Number(value)])));return parsed.success?parsed.data:null;}
export function reconcileDraft<T>(previousKey:string|null,source:{entityId:string;revision:number},values:T,base:T):{key:string;values:T}{const key=`${source.entityId}:${source.revision}`;return {key,values:key===previousKey?values:structuredClone(base)};}
export function sourceOptions(entities:SceneEntity[],channel:'body'|'face') {return [{value:'',label:'None'},...entities.filter(entity=>entity.kind==='tracking'&&(channel==='face'||entity.config.kind!=='ifacialmocap')).map(entity=>({value:entity.id,label:entity.name}))];}
export function parseTrackingConfig(config:TrackingConfig,values:{bindAddress:string;port:string;address:string}):TrackingConfig|null {const candidate=config.kind==='mediapipe'?config:{...config,bindAddress:values.bindAddress.trim(),port:values.port.trim()===''?NaN:Number(values.port),[config.kind==='vmc'?'senderAddress':'phoneAddress']:values.address.trim()||null};const parsed=TrackingConfigSchema.safeParse(candidate);return parsed.success?parsed.data:null;}
export function matchingStatus(statuses:TrackingStatus[],id:string,generation:number){return statuses.find(status=>status.sourceId===id&&status.generation===generation);}

export function initialTrackingDraft(config:TrackingConfig){return {config:{...config},bindAddress:config.kind==='mediapipe'?'':config.bindAddress,port:config.kind==='mediapipe'?'':String(config.port),address:config.kind==='vmc'?config.senderAddress??'':config.kind==='ifacialmocap'?config.phoneAddress??'':''};}

export function cameraOptions(entities:readonly SceneEntity[]){return entities.filter(entity=>entity.kind==='camera').map(entity=>({value:entity.id,label:entity.name}));}

export function parseTrackingSmoothing(enabled:boolean,values:Record<'minCutoff'|'beta'|'derivativeCutoff',string>):TrackingSmoothing|null {const parsed=TrackingSmoothingSchema.safeParse({enabled,...Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim()===''?NaN:Number(value)]))});return parsed.success?parsed.data:null;}
