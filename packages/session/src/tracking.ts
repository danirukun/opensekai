import {TrackingUpdateSchema,type TrackingUpdate,type TrackingSample,type TrackingStatus,type TrackingBone,type AvatarPose,type SceneView,type Quat,type Reply} from '@opensekai/contracts';
import {evaluateAvatarIdle} from './idle';
import {createTrackingSampleFilter} from './tracking-filter';
const faceBones=new Set(['head','neck','leftEye','rightEye','jaw']);
const copy=<T>(value:T):T=>structuredClone(value);
function fadeQuaternion(q:Quat,weight:number):Quat {
 const sign=q[3]<0?-1:1,angle=Math.acos(Math.min(1,Math.max(-1,q[3]*sign)));
 if(angle<.000001)return [0,0,0,1];
 const factor=Math.sin(angle*weight)/Math.sin(angle);
 return [q[0]*sign*factor,q[1]*sign*factor,q[2]*sign*factor,Math.cos(angle*weight)];
}
function multiplyQuaternion(a:Quat,b:Quat):Quat {
 const [ax,ay,az,aw]=a,[bx,by,bz,bw]=b;
 const q:Quat=[ax*bw+aw*bx+ay*bz-az*by,ay*bw+aw*by+az*bx-ax*bz,az*bw+aw*bz+ax*by-ay*bx,aw*bw-ax*bx-ay*by-az*bz];
 const length=Math.hypot(...q);return q.map(value=>value/length)as Quat;
}
export function createTrackingComposer(){
 const samples=new Map<string,TrackingSample>(),statuses=new Map<string,TrackingStatus>();
 const filters=new Map<string,ReturnType<typeof createTrackingSampleFilter>>();
 function dropSample(id:string){samples.delete(id);filters.delete(id);}
 function reconcile(scene:SceneView){const sources=scene.entities.filter(e=>e.kind==='tracking');for(const [id,sample]of samples){const source=sources.find(s=>s.id===id);if(!source||!source.config.enabled||source.generation!==sample.generation)dropSample(id);}for(const[id,status]of statuses){const source=sources.find(s=>s.id===id);if(!source||source.generation!==status.generation)statuses.delete(id);}}
 return {
 ingest(update:TrackingUpdate,scene:SceneView):Reply<null>{
  const parsed=TrackingUpdateSchema.safeParse(update);if(!parsed.success)return{ok:false,error:{code:'INVALID_INPUT',message:'Invalid tracking input',ids:[]}};
  reconcile(scene);
  for(const sample of parsed.data.samples){const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===sample.sourceId);if(source?.kind!=='tracking'||!source.config.enabled||source.generation!==sample.generation)continue;
   const previous=samples.get(sample.sourceId);if(previous&&previous.receivedAtMs>=sample.receivedAtMs)continue;let filter=filters.get(sample.sourceId);if(!filter){filter=createTrackingSampleFilter();filters.set(sample.sourceId,filter);}samples.set(sample.sourceId,filter.filter(sample));}
  for(const status of parsed.data.statuses){const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===status.sourceId);if(source?.kind!=='tracking'||source.generation!==status.generation)continue;statuses.set(status.sourceId,copy(status));if(status.state==='error'||status.state==='stopped')dropSample(status.sourceId);}
  return{ok:true,data:null};
 },
 evaluate(scene:SceneView,nowMs:number,animationElapsedMs=nowMs):{avatarPoses:AvatarPose[];trackingStatus:TrackingStatus[]}{
  if(!Number.isFinite(nowMs)||nowMs<0)throw new RangeError('Invalid tracking time');
  if(!Number.isFinite(animationElapsedMs)||animationElapsedMs<0)throw new RangeError('Invalid animation time');reconcile(scene);
  function input(id:string|null|undefined){
   const source=scene.entities.find(e=>e.kind==='tracking'&&e.id===id),sample=id?samples.get(id):undefined;
   if(source?.kind!=='tracking'||!source.config.enabled||!sample||sample.generation!==source.generation||sample.receivedAtMs>nowMs+100)return null;
   const age=Math.max(0,nowMs-sample.receivedAtMs),weight=age<=500?1:Math.max(0,1-(age-500)/250);
   return weight>0?{sample,weight}:null;
  }
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
   const pose:AvatarPose={avatarId:entity.id,...(baseBones?{baseBones}:{}),bones:Object.fromEntries(boneEntries),expressions:Object.fromEntries(face?Object.entries(face.sample.expressions).map(([name,value])=>[name,value*face.weight]):[])};
   if(body?.sample.root)pose.root={position:body.sample.root.position.map(value=>value*body.weight)as[number,number,number],rotation:fadeQuaternion(body.sample.root.rotation,body.weight)};
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
