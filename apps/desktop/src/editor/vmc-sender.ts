import {LIMITS,VMC_SENDER_DEFAULT_PORT,VmcSenderSettingsSchema,type SceneEntity,type VmcSenderSettings,type VmcSenderStatus} from '@opensekai/contracts';
// The VMC Sender add defaults (B21 R4). The sender starts stopped; the character is the first avatar of the scene.
export const VMC_SENDER={address:'127.0.0.1',port:VMC_SENDER_DEFAULT_PORT} as const;
export const vmcSenderSettings=(entities:readonly SceneEntity[]):VmcSenderSettings=>({enabled:false,...VMC_SENDER,avatarId:entities.find(entity=>entity.kind==='avatar')?.id??null});
export const vmcSenderLimitReached=(entities:readonly SceneEntity[]):boolean=>entities.filter(entity=>entity.kind==='vmcSender').length>=LIMITS.vmcSenders;
// The typed address and port over the current settings, or null when they do not validate.
export function parseVmcSender(current:VmcSenderSettings,draft:{address:string;port:string}):VmcSenderSettings|null {
 const parsed=VmcSenderSettingsSchema.safeParse({...current,address:draft.address.trim(),port:draft.port.trim()===''?NaN:Number(draft.port)});
 return parsed.success?parsed.data:null;
}
export const senderStatus=(statuses:readonly VmcSenderStatus[],entityId:string):VmcSenderStatus|undefined=>statuses.find(status=>status.entityId===entityId);
