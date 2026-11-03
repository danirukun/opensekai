import {TrackingConfigSchema,type TrackingConfig,type Reply} from '@opensekai/contracts';
type ConfigReply=Reply<{revision:number}>;
interface ActivationDependencies {
 commit:(entityId:string,config:TrackingConfig,revision:number)=>Promise<ConfigReply>;
}
export async function applyTrackingConfig(entityId:string,config:TrackingConfig,revision:number,dependencies:ActivationDependencies):Promise<ConfigReply>{
 const parsed=TrackingConfigSchema.safeParse(config);
 if(!parsed.success)return{ok:false,error:{code:'INVALID_INPUT',message:'Invalid tracking configuration',ids:[entityId]}};
 return dependencies.commit(entityId,parsed.data,revision);
}
