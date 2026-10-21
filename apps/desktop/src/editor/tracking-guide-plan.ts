import {DEFAULT_TRACKING_MAPPING,type AvatarTracking,type Id,type PatchOp,type SceneEntity,type SceneView,type TrackingConfig,type TrackingMapping,type TrackingPreset,type TrackingSlot} from '@opensekai/contracts';
import {makeAuthoringEntity} from './authoring';

export interface ConnectPlan {operations:PatchOp[];sourceId:Id;created:boolean;needsPhone:boolean;port:number}
export interface GuideSnapshot {avatarId:Id;tracking:AvatarTracking|undefined;sourceId:Id;created:boolean;mapping:TrackingMapping|undefined}

type Avatar=Extract<SceneEntity,{kind:'avatar'}>;
type Source=Extract<SceneEntity,{kind:'tracking'}>;

const FIRST_SHARED_VMC_PORT=39540;
const SLOT_KEY={body:'bodySourceId',face:'faceSourceId',fingers:'fingersSourceId'} as const satisfies Record<TrackingSlot,keyof AvatarTracking>;
const sources=(scene:SceneView)=>scene.entities.filter((e):e is Source=>e.kind==='tracking');
const avatars=(scene:SceneView)=>scene.entities.filter((e):e is Avatar=>e.kind==='avatar');
const boundIds=(t:AvatarTracking|undefined)=>t?[t.bodySourceId,t.faceSourceId,t.fingersSourceId??null]:[];
const portOf=(config:TrackingConfig)=>'port' in config?config.port:null;
const emptyTracking=():AvatarTracking=>({bodySourceId:null,faceSourceId:null});
const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

function newSource(kind:Source['config']['kind'],id:Id,scene:SceneView,config:TrackingConfig):Source {
 const entity=makeAuthoringEntity(kind,id,scene.entities);
 if(entity.kind!=='tracking')throw new Error('The authoring builder did not return a tracking source');
 return {...entity,config};
}

// A new address wins, then the one the source already holds.
function targetConfig(preset:TrackingPreset,port:number|null,phoneAddress:string|null,existing:TrackingConfig|undefined):TrackingConfig {
 const base=preset.config;
 const held=existing&&existing.kind===base.kind?existing:undefined;
 if(base.kind==='vmc')return {...base,port:port??base.port,senderAddress:phoneAddress??(held?.kind==='vmc'?held.senderAddress:null)};
 if(base.kind==='ifacialmocap')return {...base,port:port??base.port,phoneAddress:phoneAddress??(held?.kind==='ifacialmocap'?held.phoneAddress:null)};
 return {...base};
}

export function planConnect(scene:SceneView,avatarId:Id,preset:TrackingPreset,phoneAddress:string|null,eyeBones:boolean|undefined,newId:Id):ConnectPlan {
 const presetPort=portOf(preset.config);
 const avatar=avatars(scene).find(e=>e.id===avatarId);
 if(!avatar)return {operations:[],sourceId:newId,created:false,needsPhone:false,port:presetPort??0};
 const kind=preset.config.kind;
 const sameKind=sources(scene).filter(s=>s.config.kind===kind);
 const others=avatars(scene).filter(e=>e.id!==avatarId);
 const boundBy=(id:Id,list:readonly Avatar[])=>list.some(a=>boundIds(a.tracking).includes(id));

 const own=preset.slots.map(slot=>avatar.tracking?.[SLOT_KEY[slot]]).flatMap(id=>sameKind.filter(s=>s.id===id))[0];
 // A source that any character binds is not free, including this character's slots that the preset does not fill.
 const free=sameKind.filter(s=>!boundBy(s.id,avatars(scene)));
 const adopted=own?undefined:(free.find(s=>portOf(s.config)===presetPort)??free[0]);
 const existing=own??adopted;

 // The target endpoint: an enabled source on that port that another character binds blocks it.
 const taken=(port:number)=>sources(scene).filter(s=>s.id!==existing?.id&&s.config.enabled&&portOf(s.config)===port&&boundBy(s.id,others));
 const blockers=presetPort===null?[]:taken(presetPort);
 let port=presetPort;
 if(blockers.length>0&&kind==='vmc'){
  // Any tracking source counts as using a port, enabled or not.
  const used=new Set(sources(scene).filter(s=>s.id!==existing?.id).map(s=>portOf(s.config)));
  port=FIRST_SHARED_VMC_PORT;
  while(used.has(port))port++;
 }
 if(blockers.length>0&&kind==='ifacialmocap'){
  const clash=phoneAddress===null||blockers.some(s=>s.config.kind==='ifacialmocap'&&s.config.phoneAddress===phoneAddress);
  if(clash)return {operations:[],sourceId:newId,created:false,needsPhone:true,port:presetPort??0};
 }

 const sourceId=existing?.id??newId;
 const config=targetConfig(preset,port,phoneAddress,existing?.config);
 const operations:PatchOp[]=[];
 if(existing){
  if(!sameJson(existing.config,config))operations.push({kind:'setTrackingConfig',entityId:sourceId,config});
 }else operations.push({kind:'createEntity',entity:newSource(kind,newId,scene,config)});
 if(!existing||existing.smoothing?.enabled===false)operations.push({kind:'setTrackingSmoothing',entityId:sourceId,smoothing:{...preset.smoothing}});
 if(eyeBones!==undefined){
  const mapping:TrackingMapping={...structuredClone<TrackingMapping>(existing?.mapping??DEFAULT_TRACKING_MAPPING),useEyeBones:eyeBones};
  operations.push({kind:'setTrackingMapping',entityId:sourceId,mapping});
 }
 const tracking:AvatarTracking={...(avatar.tracking?structuredClone(avatar.tracking):emptyTracking())};
 for(const slot of preset.slots)tracking[SLOT_KEY[slot]]=sourceId;
 operations.push({kind:'setAvatarTracking',entityId:avatarId,tracking});
 return {operations,sourceId,created:!existing,needsPhone:false,port:portOf(config)??0};
}

// planConnect writes useEyeBones, so a reused source always gets its mapping back. Config and smoothing stay.
// fitSent does not change the result; the caller still passes it.
export function planCancel(scene:SceneView,snapshot:GuideSnapshot,_fitSent:boolean):PatchOp[] {
 const sourceThere=sources(scene).some(s=>s.id===snapshot.sourceId);
 const operations:PatchOp[]=[];
 if(snapshot.created&&sourceThere)operations.push({kind:'removeEntity',entityId:snapshot.sourceId});
 if(!avatars(scene).some(e=>e.id===snapshot.avatarId))return operations;

 const live=new Set(scene.entities.filter(e=>!(snapshot.created&&e.id===snapshot.sourceId)).map(e=>e.id));
 const keep=(id:Id|null|undefined)=>id&&live.has(id)?id:null;
 const was=snapshot.tracking??emptyTracking();
 const tracking:AvatarTracking={bodySourceId:keep(was.bodySourceId),faceSourceId:keep(was.faceSourceId)};
 const fingers=keep(was.fingersSourceId);
 if(fingers)tracking.fingersSourceId=fingers;
 operations.push({kind:'setAvatarTracking',entityId:snapshot.avatarId,tracking});
 if(!snapshot.created&&sourceThere)operations.push({kind:'setTrackingMapping',entityId:snapshot.sourceId,mapping:structuredClone<TrackingMapping>(snapshot.mapping??DEFAULT_TRACKING_MAPPING)});
 return operations;
}
