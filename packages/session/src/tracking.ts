import {TrackingUpdateSchema,canonicalArkitName,type ArkitName,type TrackingProbe,type TrackingUpdate,type TrackingSample,type TrackingStatus,type TrackingBone,type AvatarPose,type SceneView,type SceneEntity,DEFAULT_TRACKING_SMOOTHING,FINGER_BONES,type Quat,type Reply} from '@opensekai/contracts';
import {applyCalibration} from './tracking-calibration';
import {applyMapping,scaleRotation} from './tracking-mapping';
import {evaluateAvatarIdle} from './idle';
import {createTrackingSampleFilter} from './tracking-filter';
const faceBones=new Set(['head','neck','leftEye','rightEye','jaw']),fingerBones=new Set(FINGER_BONES);
const copy=<T>(value:T):T=>structuredClone(value);
function multiplyQuaternion(a:Quat,b:Quat):Quat {
 const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
 const q:Quat=[ax*bw+aw*bx+ay*bz-az*by,ay*bw+aw*by+az*bx-ax*bz,az*bw+aw*bz+ax*by-ay*bx,aw*bw-ax*bx-ay*by-az*bz];
 const length=Math.hypot(...q);return q.map(value=>value/length)as Quat;
}
export function createTrackingComposer(){
 const samples=new Map<string,TrackingSample>(),statuses=new Map<string,TrackingStatus>();
 type Source=Extract<SceneEntity,{kind:'tracking'}>;
 const rawSamples=new Map<string,TrackingSample>();
 // Run peaks of the smoothed ARKit values for each source. Runtime state: never saved, and cleared with the sample.
 const peaks=new Map<string,{generation:number;values:Partial<Record<ArkitName,number>>}>();
 const filters=new Map<string,{key:string;filter:ReturnType<typeof createTrackingSampleFilter>}>();
 const settings=(source:Source)=>source.smoothing??DEFAULT_TRACKING_SMOOTHING;
 const settingsKey=(source:Source)=>{const s=settings(source);return `${s.enabled}:${s.minCutoff}:${s.beta}:${s.derivativeCutoff}`;};
 function filterSample(source:Source,sample:TrackingSample):TrackingSample {
  const s=settings(source),key=settingsKey(source);let entry=filters.get(source.id);
  if(!entry||entry.key!==key){entry={key,filter:createTrackingSampleFilter({minCutoff:s.minCutoff,beta:s.beta,derivativeCutoff:s.derivativeCutoff})};filters.set(source.id,entry);}
  return s.enabled?entry.filter.filter(sample):copy(sample);
 }
 function currentSample(sourceId:string,nowMs:number):TrackingSample|null{const sample=samples.get(sourceId);return sample&&nowMs-sample.receivedAtMs<=500?copy(sample):null;}
 function dropSample(id:string){samples.delete(id);rawSamples.delete(id);filters.delete(id);peaks.delete(id);}
 // The smoothed expressions under their canonical ARKit names. Two sender names for one channel merge by max.
 function canonicalValues(sample:TrackingSample){const values:Partial<Record<ArkitName,number>>={};for(const[name,value]of Object.entries(sample.expressions)){const key=canonicalArkitName(name)as ArkitName|undefined;if(key)values[key]=Math.max(values[key]??0,Math.min(1,Math.max(0,value)));}return values;}
 function recordPeaks(sample:TrackingSample){let entry=peaks.get(sample.sourceId);if(!entry||entry.generation!==sample.generation){entry={generation:sample.generation,values:{}};peaks.set(sample.sourceId,entry);}
  for(const[key,value]of Object.entries(canonicalValues(sample))as [ArkitName,number][])if(value>(entry.values[key]??-1))entry.values[key]=value;}
 function reconcile(scene:SceneView){const sources=scene.entities.filter(e=>e.kind==='tracking');for(const [id,sample]of samples){const source=sources.find(s=>s.id===id);if(!source||!source.config.enabled||source.generation!==sample.generation)dropSample(id);else if(filters.get(id)?.key!==settingsKey(source)){const raw=rawSamples.get(id);if(raw)samples.set(id,filterSample(source,raw));}}for(const[id,status]of statuses){const source=sources.find(s=>s.id===id);if(!source||source.generation!==status.generation)statuses.delete(id);}}
 return {
 ingest(update:TrackingUpdate,scene:SceneView):Reply<null>{
  const parsed=TrackingUpdateSchema.safeParse(update);if(!parsed.success)return{ok:false,error:{code:'INVALID_INPUT',message:'Invalid tracking input',ids:[]}};
  reconcile(scene);
  for(const sample of parsed.data.samples){const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===sample.sourceId);if(source?.kind!=='tracking'||!source.config.enabled||source.generation!==sample.generation)continue;
   const previous=samples.get(sample.sourceId);if(previous&&previous.receivedAtMs>=sample.receivedAtMs)continue;const filtered=filterSample(source,sample);samples.set(sample.sourceId,filtered);rawSamples.set(sample.sourceId,copy(sample));recordPeaks(filtered);}
  for(const status of parsed.data.statuses){const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===status.sourceId);if(source?.kind!=='tracking'||source.generation!==status.generation)continue;statuses.set(status.sourceId,copy(status));if(status.state==='error'||status.state==='stopped')dropSample(status.sourceId);}
  return{ok:true,data:null};
 },
 // The smoothed sample that `evaluate` uses, before the stale fade. Null when it is older than 500 ms at nowMs.
 currentSample,
 // The run peaks of a source since the last reset.
 runPeaks(sourceId:string):Partial<Record<ArkitName,number>>{return{...peaks.get(sourceId)?.values};},
 // The smoothed ARKit values before calibration and mapping, and the run peaks. Null when the composer holds nothing for the source.
 probe(sourceId:string,nowMs:number,resetPeaks:boolean):Omit<TrackingProbe,'state'>|null{
  const entry=peaks.get(sourceId),stored=samples.get(sourceId);
  if(!entry&&!stored)return null;
  const sample=currentSample(sourceId,nowMs),values=sample?canonicalValues(sample):{};
  const result={sourceId,generation:(sample??stored)?.generation??entry!.generation,values,peaks:{...entry?.values},presentChannels:sample?Object.keys(values)as ArkitName[]:[],eyeBones:!!sample&&!!sample.bones.leftEye&&!!sample.bones.rightEye};
  if(resetPeaks)peaks.delete(sourceId);
  return result;
 },
 evaluate(scene:SceneView,nowMs:number,animationElapsedMs=nowMs):{avatarPoses:AvatarPose[];trackingStatus:TrackingStatus[]}{
  if(!Number.isFinite(nowMs)||nowMs<0)throw new RangeError('Invalid tracking time');
  if(!Number.isFinite(animationElapsedMs)||animationElapsedMs<0)throw new RangeError('Invalid animation time');reconcile(scene);
  function input(id:string|null|undefined){
   const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===id),sample=id?samples.get(id):undefined;
   if(source?.kind!=='tracking'||!source.config.enabled||!sample||sample.generation!==source.generation||sample.receivedAtMs>nowMs+100)return null;
   const age=Math.max(0,nowMs-sample.receivedAtMs),weight=age<=500?1:Math.max(0,1-(age-500)/250);
   if(weight<=0)return null;
   // Calibration, then mapping, before mixing and the stale fade (R4, R10). One result for each source in this evaluation.
   let mapped=resolved.get(source.id);
   if(!mapped){mapped=applyMapping(applyCalibration(sample,source.calibration),source.mapping);resolved.set(source.id,mapped);}
   return {sample:mapped,weight};
  }
  const resolved=new Map<string,TrackingSample>();
  const avatarPoses:AvatarPose[]=[];
  for(const entity of scene.entities){if(entity.kind!=='avatar')continue;
   const baseBones=entity.idleAnimation?.enabled?evaluateAvatarIdle(animationElapsedMs):undefined;
   if(!entity.tracking&&!baseBones)continue;
   const body=input(entity.tracking?.bodySourceId),face=input(entity.tracking?.faceSourceId??entity.tracking?.bodySourceId),ownsFace=entity.tracking?.faceSourceId!=null;
   const boneEntries:[string,TrackingBone][]=[];
   if(body)for(const[name,bone]of Object.entries(body.sample.bones)){if(ownsFace&&faceBones.has(name))continue;boneEntries.push([name,{...copy(bone),weight:body.weight}]);}
   if(face)for(const[name,bone]of Object.entries(face.sample.bones)){if(!faceBones.has(name))continue;const index=boneEntries.findIndex(([key])=>key===name);if(index>=0)boneEntries.splice(index,1);const resolved=copy(bone);
    const faceSource=scene.entities.find(source=>source.id===face.sample.sourceId);
    const chest=face.sample.bones.chest;
    if(name==='head'&&faceSource?.kind==='tracking'&&faceSource.config.kind==='mediapipe'&&body?.sample.sourceId!==face.sample.sourceId&&bone.space==='normalized'&&chest?.space==='normalized')resolved.rotation=multiplyQuaternion(chest.rotation,bone.rotation);
    boneEntries.push([name,{...resolved,weight:face.weight}]);}
   const fingers=input(entity.tracking?.fingersSourceId);
   if(fingers)for(const[name,bone]of Object.entries(fingers.sample.bones)){if(!fingerBones.has(name))continue;const index=boneEntries.findIndex(([key])=>key===name);if(index>=0)boneEntries.splice(index,1);boneEntries.push([name,{...copy(bone),weight:fingers.weight}]);}
   const pose:AvatarPose={avatarId:entity.id,...(baseBones?{baseBones}:{}),bones:Object.fromEntries(boneEntries),expressions:Object.fromEntries(face?Object.entries(face.sample.expressions).map(([name,value])=>[name,value*face.weight]):[])};
   if(body?.sample.root)pose.root={position:body.sample.root.position.map(value=>value*body.weight)as[number,number,number],rotation:scaleRotation(body.sample.root.rotation,body.weight)};
   avatarPoses.push(pose);
  }
  const trackingStatus=scene.entities.filter(e=>e.kind==='tracking').map(source=>{
   const previous=statuses.get(source.id),sample=samples.get(source.id);
   const status:TrackingStatus=previous&&previous.generation===source.generation?copy(previous):{sourceId:source.id,generation:source.generation,state:'waiting',packets:0,invalidPackets:0,lastReceivedAtMs:null,error:null};
   if(!source.config.enabled){status.state='stopped';status.lastReceivedAtMs=null;status.error=null;}
   else if(status.state!=='error'&&sample&&sample.generation===source.generation){status.state=nowMs-sample.receivedAtMs>500?'stale':'receiving';status.lastReceivedAtMs=sample.receivedAtMs;}
   else if(status.state!=='error')status.state='waiting';
   return status;
  });
  return {avatarPoses,trackingStatus};
 }
 };
}
