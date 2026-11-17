import {DEFAULT_TRACKING_MAPPING,type AvatarTracking,type Id,type PatchOp,type SceneEntity,type SceneView,type TrackingConfig,type TrackingMapping,type TrackingPreset,type TrackingSmoothing} from '@opensekai/contracts';
import {makeAuthoringEntity} from './authoring';
import {choiceOf,type SetupPart,type SetupRole} from './tracking-guide-setup';

export interface PlannedPart {preset:TrackingPreset;roles:SetupRole[];sourceId:Id;created:boolean;port:number|null}
export type SetupPlan={ops:PatchOp[];parts:PlannedPart[];released:Id[];needsPhone:boolean}|{blocked:'sourceLimit'};
export interface SourceSnapshot {config:TrackingConfig;smoothing:TrackingSmoothing|undefined;mapping:TrackingMapping|undefined}
export interface GuideSnapshot {avatarId:Id;tracking:AvatarTracking|undefined;created:Id[];sources:Record<Id,SourceSnapshot>}

type Avatar=Extract<SceneEntity,{kind:'avatar'}>;
type Source=Extract<SceneEntity,{kind:'tracking'}>;

export const SOURCE_LIMIT=4;
const SLOT_KEY={body:'bodySourceId',face:'faceSourceId',fingers:'fingersSourceId'} as const satisfies Record<SetupRole,keyof AvatarTracking>;
const sources=(scene:SceneView)=>scene.entities.filter((e):e is Source=>e.kind==='tracking');
const avatars=(scene:SceneView)=>scene.entities.filter((e):e is Avatar=>e.kind==='avatar');
const boundIds=(t:AvatarTracking|undefined):Id[]=>t?[t.bodySourceId,t.faceSourceId,t.fingersSourceId??null].filter((id):id is Id=>id!==null):[];
const portOf=(config:TrackingConfig)=>'port' in config?config.port:null;
const addressOf=(c:TrackingConfig)=>c.kind==='vmc'||c.kind==='openseeface'?c.senderAddress:c.kind==='ifacialmocap'?c.phoneAddress:null;
// A VMC sender of this app that sends to this computer uses its port.
const LOCAL=new Set(['127.0.0.1','localhost','::1']);
const senderPorts=(scene:SceneView)=>new Set(scene.entities.flatMap(e=>e.kind==='vmcSender'&&e.vmcSender.enabled&&LOCAL.has(e.vmcSender.address.toLowerCase())?[e.vmcSender.port]:[]));
const emptyTracking=():AvatarTracking=>({bodySourceId:null,faceSourceId:null});
const sameJson=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

function newSource(kind:Source['config']['kind'],id:Id,entities:readonly SceneEntity[],config:TrackingConfig):Source {
 const entity=makeAuthoringEntity(kind,id,entities);
 if(entity.kind!=='tracking')throw new Error('The authoring builder did not return a tracking source');
 return {...entity,config};
}

// A new address wins, then the one the source already holds. A reused camera source keeps its camera and mirror.
// An enabled VMC source keeps a position rule only when it sets one. A new or disabled source, or one with no rule, takes the preset rule.
function targetConfig(base:TrackingConfig,port:number|null,phoneAddress:string|null,existing:TrackingConfig|undefined):TrackingConfig {
 const held=existing&&existing.kind===base.kind?existing:undefined;
 if(base.kind==='vmc'){
  const {positions:presetRule,...rest}=base,rule=held?.kind==='vmc'&&held.enabled&&held.positions!==undefined?held.positions:presetRule;
  return {...rest,port:port??base.port,senderAddress:phoneAddress??(held?.kind==='vmc'?held.senderAddress:null),...(rule?{positions:rule}:{})};
 }
 if(base.kind==='ifacialmocap')return {...base,port:port??base.port,phoneAddress:phoneAddress??(held?.kind==='ifacialmocap'?held.phoneAddress:null)};
 if(base.kind==='openseeface')return {...base,port:port??base.port,senderAddress:held?.kind==='openseeface'?held.senderAddress:null};
 if(base.kind==='mediapipe')return held?.kind==='mediapipe'?{...base,deviceId:held.deviceId,mirror:held.mirror}:{...base};
 return held?.kind==='facekit'?{...base,deviceId:held.deviceId}:{...base};
}

const roleSlots=(roles:readonly SetupRole[])=>roles.map(role=>SLOT_KEY[role]);

// Source order for each part: a same-kind source of this character only (in the part's own slots with its own preset first,
// then in its own slots, then in any slot), then a free same-kind source (one on the preset port first), then a new source.
// A source that another character also binds is never taken, and one source serves one part.
function selectSources(scene:SceneView,avatar:Avatar,parts:readonly SetupPart[]):(Source|undefined)[] {
 const taken=new Set<Id>();
 const anyBound=new Set(avatars(scene).flatMap(a=>boundIds(a.tracking)));
 const others=new Set(avatars(scene).filter(a=>a.id!==avatar.id).flatMap(a=>boundIds(a.tracking)));
 const own=boundIds(avatar.tracking).filter(id=>!others.has(id));
 const inSlots=(part:SetupPart,sameKind:Source[])=>roleSlots(part.roles).map(key=>avatar.tracking?.[key]).flatMap(id=>sameKind.filter(s=>s.id===id&&own.includes(s.id)));
 const chosen:(Source|undefined)[]=parts.map(()=>undefined);
 const pass=(pick:(part:SetupPart,sameKind:Source[])=>Source|undefined)=>parts.forEach((part,index)=>{
  if(chosen[index])return;
  const found=pick(part,sources(scene).filter(s=>s.config.kind===part.config.kind&&!taken.has(s.id)));
  if(found){chosen[index]=found;taken.add(found.id);}
 });
 pass((part,sameKind)=>inSlots(part,sameKind).find(s=>choiceOf(s.config)===part.preset.id));
 pass((part,sameKind)=>inSlots(part,sameKind)[0]);
 pass((part,sameKind)=>{const held=sameKind.filter(s=>own.includes(s.id));return held.find(s=>choiceOf(s.config)===part.preset.id)??held[0];});
 pass((part,sameKind)=>{const free=sameKind.filter(s=>!anyBound.has(s.id));return free.find(s=>portOf(s.config)===portOf(part.config))??free[0];});
 return chosen;
}

export function planSetup(scene:SceneView,avatarId:Id,parts:readonly SetupPart[],phoneAddress:string|null,eyeBones:boolean|undefined,newId:Id):SetupPlan {
 const avatar=avatars(scene).find(e=>e.id===avatarId);
 if(!avatar)return {ops:[],parts:[],released:[],needsPhone:false};
 const chosen=selectSources(scene,avatar,parts);
 const createdCount=chosen.filter(s=>!s).length;
 if(sources(scene).length+createdCount>SOURCE_LIMIT)return {blocked:'sourceLimit'};

 const kept=new Set(chosen.flatMap(s=>s?[s.id]:[]));
 const othersBind=new Set(avatars(scene).filter(a=>a.id!==avatarId).flatMap(a=>boundIds(a.tracking)));
 // A source that this character bound before the run, that no character binds after it, stops. It keeps its other settings.
 const released=[...new Set(boundIds(avatar.tracking))].filter(id=>!kept.has(id)&&!othersBind.has(id)).flatMap(id=>sources(scene).filter(s=>s.id===id&&s.config.enabled).map(s=>s.id));

 // The working configs: each part sees the endpoints of the parts before it, and a released source is off.
 const senders=senderPorts(scene);
 const configs=new Map<Id,TrackingConfig>(sources(scene).map(s=>[s.id,released.includes(s.id)?{...s.config,enabled:false}:s.config]));
 const entities:SceneEntity[]=[...scene.entities];
 const ops:PatchOp[]=[];
 const planned:PlannedPart[]=[];
 for(const [index,part] of parts.entries()){
  const existing=chosen[index];
  const createdBefore=planned.filter(p=>p.created).length;
  const sourceId=existing?.id??(createdBefore===0?newId:`${newId}-${createdBefore+1}`);
  const kind=part.config.kind,presetPort=portOf(part.config),phone=kind==='ifacialmocap'?phoneAddress:null;
  const ownAddress=addressOf(targetConfig(part.config,presetPort,phone,existing?.config));
  // The host share rule: the source may use a port only when every other enabled source on it
  // (bound or not) has the same kind and an address, and all addresses are distinct.
  const fits=(port:number)=>{
   if(senders.has(port))return false;
   const rest=[...configs].filter(([id,c])=>id!==sourceId&&c.enabled&&portOf(c)===port).map(([,c])=>c);
   if(rest.length===0)return true;
   const addresses=[...rest.map(c=>c.kind===kind?addressOf(c):null),ownAddress];
   return addresses.every(x=>x!==null)&&new Set(addresses).size===addresses.length;
  };
  let port=presetPort;
  if(presetPort!==null&&!fits(presetPort)){
   if(kind==='ifacialmocap')return {ops:[],parts:[],released:[],needsPhone:true};
   // Any tracking source counts as using a port, enabled or not.
   const used=new Set([...[...configs].filter(([id])=>id!==sourceId).map(([,c])=>portOf(c)),...senders]);
   port=presetPort+1;
   while(used.has(port))port++;
  }
  const config=targetConfig(part.config,port,phone,existing?.config);
  if(existing){
   if(!sameJson(existing.config,config))ops.push({kind:'setTrackingConfig',entityId:sourceId,config});
  }else{
   const entity=newSource(kind,sourceId,entities,config);
   entities.push(entity);
   ops.push({kind:'createEntity',entity});
  }
  configs.set(sourceId,config);
  if(!existing||existing.smoothing?.enabled===false)ops.push({kind:'setTrackingSmoothing',entityId:sourceId,smoothing:{...part.preset.smoothing}});
  if(eyeBones!==undefined&&part.roles.includes('face')){
   const mapping:TrackingMapping={...structuredClone<TrackingMapping>(existing?.mapping??DEFAULT_TRACKING_MAPPING),useEyeBones:eyeBones};
   ops.push({kind:'setTrackingMapping',entityId:sourceId,mapping});
  }
  planned.push({preset:part.preset,roles:[...part.roles],sourceId,created:!existing,port:portOf(config)});
 }
 for(const id of released)ops.push({kind:'setTrackingConfig',entityId:id,config:configs.get(id)!});

 // The choice gives the whole binding: a slot that no part fills is empty. The body group stays.
 const tracking:AvatarTracking=emptyTracking();
 for(const part of planned)for(const role of part.roles)tracking[SLOT_KEY[role]]=part.sourceId;
 if(avatar.tracking?.body)tracking.body=structuredClone(avatar.tracking.body);
 ops.push({kind:'setAvatarTracking',entityId:avatarId,tracking});
 return {ops,parts:planned,released,needsPhone:false};
}

// The state that Cancel restores: the binding, and each source that the run changes and did not create.
export function setupSnapshot(scene:SceneView,avatarId:Id,plan:Extract<SetupPlan,{ops:PatchOp[]}>):GuideSnapshot {
 const avatar=avatars(scene).find(e=>e.id===avatarId);
 const touched=[...plan.parts.filter(p=>!p.created).map(p=>p.sourceId),...plan.released];
 const held=sources(scene).filter(s=>touched.includes(s.id));
 return {avatarId,tracking:avatar?.tracking?structuredClone(avatar.tracking):undefined,created:plan.parts.filter(p=>p.created).map(p=>p.sourceId),
  sources:Object.fromEntries(held.map(s=>[s.id,{config:structuredClone(s.config),smoothing:s.smoothing?structuredClone(s.smoothing):undefined,mapping:s.mapping?structuredClone(s.mapping):undefined}]))};
}

// Cancel removes the created sources and gives back the binding, and the config, smoothing, and mapping of each other touched source.
export function planCancel(scene:SceneView,snapshot:GuideSnapshot):PatchOp[] {
 const there=new Set(sources(scene).map(s=>s.id));
 const ops:PatchOp[]=snapshot.created.filter(id=>there.has(id)).map(id=>({kind:'removeEntity',entityId:id}));
 const live=new Set(scene.entities.filter(e=>!snapshot.created.includes(e.id)).map(e=>e.id));
 if(avatars(scene).some(e=>e.id===snapshot.avatarId)){
  const keep=(id:Id|null|undefined)=>id&&live.has(id)?id:null;
  const was=snapshot.tracking??emptyTracking();
  const tracking:AvatarTracking={bodySourceId:keep(was.bodySourceId),faceSourceId:keep(was.faceSourceId)};
  const fingers=keep(was.fingersSourceId);
  if(fingers)tracking.fingersSourceId=fingers;
  if(was.body)tracking.body={movementIntensity:was.body.movementIntensity,trackedParts:[...was.body.trackedParts]};
  ops.push({kind:'setAvatarTracking',entityId:snapshot.avatarId,tracking});
 }
 for(const source of sources(scene)){
  const before=snapshot.sources[source.id];
  if(!before||snapshot.created.includes(source.id))continue;
  if(!sameJson(source.config,before.config)&&source.config.kind===before.config.kind)ops.push({kind:'setTrackingConfig',entityId:source.id,config:structuredClone(before.config)});
  if(before.smoothing&&!sameJson(source.smoothing,before.smoothing))ops.push({kind:'setTrackingSmoothing',entityId:source.id,smoothing:structuredClone(before.smoothing)});
  if(!sameJson(source.mapping??DEFAULT_TRACKING_MAPPING,before.mapping??DEFAULT_TRACKING_MAPPING))ops.push({kind:'setTrackingMapping',entityId:source.id,mapping:structuredClone<TrackingMapping>(before.mapping??DEFAULT_TRACKING_MAPPING)});
 }
 return ops;
}
