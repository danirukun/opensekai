import {DEFAULT_TRACKING_MAPPING,type AvatarTracking,type Id,type PatchOp,type SceneEntity,type SceneView,type TrackingConfig,type TrackingMapping,type TrackingPreset,type TrackingSlot} from '@opensekai/contracts';
import {makeAuthoringEntity} from './authoring';

export interface ConnectPlan {operations:PatchOp[];sourceId:Id;created:boolean;needsPhone:boolean}
export interface GuideSnapshot {avatarId:Id;tracking:AvatarTracking|undefined;sourceId:Id;created:boolean;mapping:TrackingMapping|undefined}

type Avatar=Extract<SceneEntity,{kind:'avatar'}>;
type Source=Extract<SceneEntity,{kind:'tracking'}>;

const SLOT_KEY={body:'bodySourceId',face:'faceSourceId',fingers:'fingersSourceId'} as const satisfies Record<TrackingSlot,keyof AvatarTracking>;
const sources=(scene:SceneView)=>scene.entities.filter((e):e is Source=>e.kind==='tracking');
const avatars=(scene:SceneView)=>scene.entities.filter((e):e is Avatar=>e.kind==='avatar');
const boundIds=(t:AvatarTracking|undefined)=>t?[t.bodySourceId,t.faceSourceId,t.fingersSourceId??null]:[];
const portOf=(config:TrackingConfig)=>'port' in config?config.port:null;
const emptyTracking=():AvatarTracking=>({bodySourceId:null,faceSourceId:null});

// The address a phone or sender uses: a new address wins, then the one the source already holds.
function targetConfig(preset:TrackingPreset,phoneAddress:string|null,existing:TrackingConfig|undefined):TrackingConfig {
 const base=preset.config;
 const held=existing&&existing.kind===base.kind?existing:undefined;
 if(base.kind==='vmc')return {...base,senderAddress:phoneAddress??(held?.kind==='vmc'?held.senderAddress:null)};
 if(base.kind==='ifacialmocap')return {...base,phoneAddress:phoneAddress??(held?.kind==='ifacialmocap'?held.phoneAddress:null)};
 return {...base};
}
const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function planConnect(scene:SceneView,avatarId:Id,preset:TrackingPreset,phoneAddress:string|null,eyeBones:boolean|undefined,newId:Id):ConnectPlan {
 const avatar=avatars(scene).find(e=>e.id===avatarId);
 if(!avatar)return {operations:[],sourceId:newId,created:false,needsPhone:false};
 const kind=preset.config.kind;
 const sameKind=sources(scene).filter(s=>s.config.kind===kind);
 const others=avatars(scene).filter(e=>e.id!==avatarId);
 const usedBy=(id:Id,list:readonly Avatar[])=>list.some(a=>boundIds(a.tracking).includes(id));

 const own=preset.slots.map(slot=>avatar.tracking?.[SLOT_KEY[slot]]).flatMap(id=>sameKind.filter(s=>s.id===id))[0];
 const adopted=own?undefined:sameKind.find(s=>!usedBy(s.id,avatars(scene)));
 const existing=own??adopted;
 if(!existing){
  const port=preset.config.kind==='mediapipe'?null:preset.config.port;
  const shared=port!==null&&sameKind.some(s=>portOf(s.config)===port&&usedBy(s.id,others));
  if(shared&&phoneAddress===null)return {operations:[],sourceId:newId,created:false,needsPhone:true};
 }

 const sourceId=existing?.id??newId;
 const config=targetConfig(preset,phoneAddress,existing?.config);
 const operations:PatchOp[]=[];
 if(existing){
  if(!sameJson(existing.config,config))operations.push({kind:'setTrackingConfig',entityId:sourceId,config});
 }else{
  const entity=makeAuthoringEntity(kind,newId,scene.entities);
  operations.push({kind:'createEntity',entity:{...entity,config} as SceneEntity});
 }
 if(!existing||existing.smoothing?.enabled===false)operations.push({kind:'setTrackingSmoothing',entityId:sourceId,smoothing:{...preset.smoothing}});
 if(eyeBones!==undefined){
  const mapping:TrackingMapping={...structuredClone(existing?.mapping??DEFAULT_TRACKING_MAPPING),useEyeBones:eyeBones};
  operations.push({kind:'setTrackingMapping',entityId:sourceId,mapping});
 }
 const tracking:AvatarTracking={...(avatar.tracking?structuredClone(avatar.tracking):emptyTracking())};
 for(const slot of preset.slots)tracking[SLOT_KEY[slot]]=sourceId;
 operations.push({kind:'setAvatarTracking',entityId:avatarId,tracking});
 return {operations,sourceId,created:!existing,needsPhone:false};
}

// The mapping is always restored for a reused source because planConnect writes useEyeBones; config and smoothing stay.
// fitSent no longer changes the result. It stays in the signature for the caller.
export function planCancel(scene:SceneView,snapshot:GuideSnapshot,_fitSent:boolean):PatchOp[] {
 if(!avatars(scene).some(e=>e.id===snapshot.avatarId))return [];
 const sourceThere=sources(scene).some(s=>s.id===snapshot.sourceId);
 if(snapshot.created)return sourceThere?[{kind:'removeEntity',entityId:snapshot.sourceId}]:[];
 const live=new Set(scene.entities.map(e=>e.id));
 const keep=(id:Id|null|undefined)=>id&&live.has(id)?id:null;
 const was=snapshot.tracking??emptyTracking();
 const tracking:AvatarTracking={bodySourceId:keep(was.bodySourceId),faceSourceId:keep(was.faceSourceId)};
 const fingers=keep(was.fingersSourceId);
 if(fingers)tracking.fingersSourceId=fingers;
 const operations:PatchOp[]=[{kind:'setAvatarTracking',entityId:snapshot.avatarId,tracking}];
 if(sourceThere)operations.push({kind:'setTrackingMapping',entityId:snapshot.sourceId,mapping:structuredClone(snapshot.mapping??DEFAULT_TRACKING_MAPPING) as TrackingMapping});
 return operations;
}
