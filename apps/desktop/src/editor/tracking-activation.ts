import {TrackingConfigSchema,type TrackingConfig,type Reply} from '@opensekai/contracts';
type ConfigReply=Reply<{revision:number}>;
interface ActivationDependencies {
 activate:()=>Promise<void>;
 commit:(entityId:string,config:TrackingConfig,revision:number)=>Promise<ConfigReply>;
}
export async function applyTrackingConfig(entityId:string,config:TrackingConfig,revision:number,dependencies:ActivationDependencies):Promise<ConfigReply>{
 const parsed=TrackingConfigSchema.safeParse(config);
 if(!parsed.success)return{ok:false,error:{code:'INVALID_INPUT',message:'Invalid tracking configuration',ids:[entityId]}};
 if(parsed.data.kind==='mediapipe'&&parsed.data.enabled){
  try{await dependencies.activate();}catch{return{ok:false,error:{code:'UNAVAILABLE',message:'Scene window is unavailable',ids:[entityId]}};}
 }
 return dependencies.commit(entityId,parsed.data,revision);
}
