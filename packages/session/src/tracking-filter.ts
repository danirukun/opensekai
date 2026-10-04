import {TrackingSampleSchema,type TrackingSample,type Quat,type Vec3} from '@opensekai/contracts';
import {createOneEuroFilter,createOneEuroVec3Filter,createOneEuroQuaternionFilter,type OneEuroOptions,type SignalFilter} from './one-euro-filter';

export function createTrackingSampleFilter(options:Partial<OneEuroOptions>={}) {
 // Validate options even before a channel arrives.
 createOneEuroFilter(options);
 const scalars=new Map<string,SignalFilter<number>>(),vectors=new Map<string,SignalFilter<Vec3>>(),rotations=new Map<string,SignalFilter<Quat>>();
 let previous:TrackingSample|null=null;
 function reset(){scalars.clear();vectors.clear();rotations.clear();previous=null;}
 return {reset,filter(input:TrackingSample):TrackingSample {
  const sample=TrackingSampleSchema.parse(input);
  if(previous&&(previous.sourceId!==sample.sourceId||previous.generation!==sample.generation))reset();
  if(previous&&sample.receivedAtMs<=previous.receivedAtMs)return structuredClone(previous);
  const used=new Set<string>(),t=sample.receivedAtMs;
  function channel<T>(map:Map<string,SignalFilter<T>>,key:string,value:T,create:()=>SignalFilter<T>):T {
   used.add(key);let filter=map.get(key);if(!filter){filter=create();map.set(key,filter);}return filter.filter(value,t);
  }
  const scalar=(key:string,value:number)=>channel(scalars,key,value,()=>createOneEuroFilter(options));
  const vector=(key:string,value:Vec3)=>channel(vectors,key,value,()=>createOneEuroVec3Filter(options));
  const rotation=(key:string,value:Quat)=>channel(rotations,key,value,()=>createOneEuroQuaternionFilter(options));
  for(const [name,bone]of Object.entries(sample.bones)){
   const key=`bone:${name}:${bone.space}`;bone.rotation=rotation(`${key}:rotation`,bone.rotation);
   if(bone.position)bone.position=vector(`${key}:position`,bone.position);
  }
  for(const [name,value]of Object.entries(sample.expressions))sample.expressions[name]=scalar(`expression:${name}`,value);
  if(sample.root){sample.root.position=vector('root:position',sample.root.position);sample.root.rotation=rotation('root:rotation',sample.root.rotation);}
  for(const map of [scalars,vectors,rotations])for(const key of map.keys())if(!used.has(key))map.delete(key);
  previous=structuredClone(sample);return sample;
 }};
}
