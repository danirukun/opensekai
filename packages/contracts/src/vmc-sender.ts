import {z} from 'zod';
import type {Id,Quat,Vec3} from './types';
import {HUMANOID_BONES} from './tracking';
// The VMC sender slice (B21, MED-09). The session makes the poses; the host encodes and sends them over UDP.
export interface VmcSenderSettings {enabled:boolean;address:string;port:number;avatarId:Id|null}
export interface AvatarRig {metaVersion:'0'|'1';restPositions:Record<string,Vec3>;identityRest:boolean}
export interface VmcSendPose {senderId:Id;root:{position:Vec3;rotation:Quat};bones:Record<string,{position:Vec3;rotation:Quat}>;blends:Record<string,number>}
export interface VmcPosesEnvelope {kind:'vmcPoses';sessionId:Id;tick:number;poses:VmcSendPose[]}
export interface VmcSenderStatus {entityId:Id;state:'stopped'|'waiting'|'sending'|'error';datagrams:number;errors:number;error:string|null}
export const VMC_SENDER_DEFAULT_PORT=39539;
const n=z.number().finite(),u=n.int().nonnegative().max(Number.MAX_SAFE_INTEGER),id=z.string().min(1).max(256);
const vec=z.tuple([n,n,n]),quat=z.tuple([n,n,n,n]).refine(q=>Math.abs(Math.hypot(...q)-1)<=.001);
// The eight 16-bit groups of an IPv6 address, with an embedded IPv4 tail as two groups. Null when the text is not IPv6.
const ipv6Groups=(text:string):number[]|null=>{
 const tail=/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
 const body=tail?`${tail[1]}${((+tail[2]<<8)|+tail[3]).toString(16)}:${((+tail[4]<<8)|+tail[5]).toString(16)}`:text;
 const halves=body.split('::');
 if(halves.length>2)return null;
 const part=(s:string)=>s===''?[]:s.split(':').map(g=>/^[0-9a-f]{1,4}$/i.test(g)?parseInt(g,16):NaN);
 const head=part(halves[0]),rest=halves.length===2?part(halves[1]):[];
 const groups=halves.length===2?[...head,...Array(8-head.length-rest.length).fill(0),...rest]:head;
 return groups.length===8&&groups.every(Number.isFinite)?groups:null;
};
const ipv4Bytes=(text:string)=>{const parts=text.split('.').map(Number);return parts.length===4&&parts.every(p=>Number.isInteger(p)&&p>=0&&p<=255)?parts:null;};
// A send target cannot be unspecified, multicast, or the limited broadcast (R1). An IPv4-mapped IPv6 address counts as its IPv4 address, as Rust `to_canonical` does.
export function vmcSendAddressOk(address:string):boolean {
 if(!z.union([z.ipv4(),z.ipv6()]).safeParse(address).success)return false;
 let v4=address.includes(':')?null:ipv4Bytes(address);
 if(address.includes(':')){
  const groups=ipv6Groups(address);
  if(!groups)return false;
  if(groups.slice(0,5).every(g=>g===0)&&groups[5]===0xffff)v4=[groups[6]>>8,groups[6]&255,groups[7]>>8,groups[7]&255];
  else return !groups.every(g=>g===0)&&groups[0]<0xff00;
 }
 if(!v4)return false;
 return !v4.every(b=>b===0)&&!(v4[0]>=224&&v4[0]<=239)&&!v4.every(b=>b===255);
}
export const VmcSenderSettingsSchema=z.strictObject({enabled:z.boolean(),address:z.string().max(64).refine(vmcSendAddressOk,'Invalid send address'),port:n.int().min(1).max(65535),avatarId:id.nullable()});
const boneName=z.string().refine(name=>HUMANOID_BONES.includes(name));
export const AvatarRigSchema=z.strictObject({metaVersion:z.enum(['0','1']),restPositions:z.record(boneName,vec).refine(v=>Object.keys(v).length<=55),identityRest:z.boolean()});
// A blend name goes into an OSC string: no NUL, at most 128 UTF-8 bytes.
export const vmcBlendNameOk=(name:string)=>name.length>0&&!name.includes('\0')&&new TextEncoder().encode(name).length<=128;
const transform=z.strictObject({position:vec,rotation:quat});
export const VmcSendPoseSchema=z.strictObject({senderId:id,root:transform,bones:z.record(boneName,transform).refine(v=>Object.keys(v).length<=55),blends:z.record(z.string().refine(vmcBlendNameOk),n.min(0).max(1)).refine(v=>Object.keys(v).length<=64)});
export const VmcPosesEnvelopeSchema=z.strictObject({kind:z.literal('vmcPoses'),sessionId:id,tick:u,poses:z.array(VmcSendPoseSchema).min(1).max(4).refine(poses=>new Set(poses.map(p=>p.senderId)).size===poses.length)});
export const VmcSenderStatusSchema=z.strictObject({entityId:id,state:z.enum(['stopped','waiting','sending','error']),datagrams:u,errors:u,error:z.string().max(512).nullable()});
