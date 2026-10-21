import {z} from 'zod';
import type {Id,Quat,Vec3} from './types';
import {ARKIT_NAMES,type ArkitName} from './expressions';
export const HUMANOID_BONES=['hips','spine','chest','upperChest','neck','head','leftEye','rightEye','jaw','leftUpperLeg','leftLowerLeg','leftFoot','leftToes','rightUpperLeg','rightLowerLeg','rightFoot','rightToes','leftShoulder','leftUpperArm','leftLowerArm','leftHand','rightShoulder','rightUpperArm','rightLowerArm','rightHand',...(['left','right'] as const).flatMap(side=>['ThumbMetacarpal','ThumbProximal','ThumbDistal','IndexProximal','IndexIntermediate','IndexDistal','MiddleProximal','MiddleIntermediate','MiddleDistal','RingProximal','RingIntermediate','RingDistal','LittleProximal','LittleIntermediate','LittleDistal'].map(finger=>side+finger))] as [string,...string[]];
export type TrackingConfig={kind:'vmc';enabled:boolean;bindAddress:string;port:number;senderAddress:string|null}|{kind:'ifacialmocap';enabled:boolean;bindAddress:string;port:number;phoneAddress:string|null}|{kind:'mediapipe';enabled:boolean;deviceId:string;face:boolean;upperBody:boolean;hands:boolean;mirror:boolean};
export interface TrackingSmoothing {enabled:boolean;minCutoff:number;beta:number;derivativeCutoff:number}
export const DEFAULT_TRACKING_SMOOTHING:Readonly<TrackingSmoothing>=Object.freeze({enabled:true,minCutoff:5,beta:.5,derivativeCutoff:1});
export interface AvatarIdle {kind:'builtin';enabled:boolean}
export interface IdleBone {rotation:Quat;space:'normalized';position?:Vec3}
export interface AvatarTracking {bodySourceId:Id|null;faceSourceId:Id|null;fingersSourceId?:Id|null}
export const CALIBRATION_BONES=['hips','spine','chest','upperChest','neck','head'] as const;
export type CalibrationBone=typeof CALIBRATION_BONES[number];
export interface TrackingCalibration {bones:Partial<Record<CalibrationBone,{rotation:Quat;space:'raw'|'normalized'}>>}
export interface BlendShapeRange {inputMin:number;inputMax:number;outputMin:number;outputMax:number}
export interface TrackingMapping {headIntensity:number;headOffset:Vec3;eyeIntensity:number;blendShapeSensitivity:number;linkedBlink:boolean;blendShapes:Partial<Record<typeof ARKIT_NAMES[number],BlendShapeRange>>;useEyeBones?:boolean}
export const DEFAULT_TRACKING_MAPPING:Readonly<TrackingMapping>=Object.freeze({headIntensity:1,headOffset:[0,0,0] as Vec3,eyeIntensity:1,blendShapeSensitivity:1,linkedBlink:false,blendShapes:{}});
export const FINGER_BONES=HUMANOID_BONES.filter(name=>/^(left|right)(Thumb|Index|Middle|Ring|Little)/.test(name));
export interface TrackingBone {rotation:Quat;space:'raw'|'normalized';position?:Vec3;weight?:number}
export interface TrackingSample {sourceId:Id;generation:number;receivedAtMs:number;bones:Record<string,TrackingBone>;expressions:Record<string,number>;root?:{position:Vec3;rotation:Quat}}
export interface TrackingStatus {sourceId:Id;generation:number;state:'stopped'|'waiting'|'receiving'|'stale'|'error';packets:number;invalidPackets:number;lastReceivedAtMs:number|null;error:string|null;inferenceMs?:number;unmatchedPackets?:number}
export interface TrackingProbeParams {sourceId:Id;resetPeaks?:boolean}
export interface TrackingProbe {sourceId:Id;generation:number;state:TrackingStatus['state'];values:Partial<Record<ArkitName,number>>;peaks:Partial<Record<ArkitName,number>>;presentChannels:ArkitName[];eyeBones:boolean}
export interface TrackingUpdate {samples:TrackingSample[];statuses:TrackingStatus[]}
export interface AvatarPose {avatarId:Id;baseBones?:Record<string,IdleBone>;bones:Record<string,TrackingBone>;expressions:Record<string,number>;root?:{position:Vec3;rotation:Quat};boneOffsets?:Record<string,Quat>}
const n=z.number().finite(),u=n.int().nonnegative().max(Number.MAX_SAFE_INTEGER),id=z.string().min(1).max(256);
const ip=z.union([z.ipv4(),z.ipv6()]);
const vec=z.tuple([n,n,n]),quat=z.tuple([n,n,n,n]).refine(q=>Math.abs(Math.hypot(...q)-1)<=.001);
export const TrackingSmoothingSchema=z.strictObject({enabled:z.boolean(),minCutoff:n.min(.01).max(120),beta:n.min(0).max(100),derivativeCutoff:n.min(.01).max(120)});
export const TrackingConfigSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('vmc'),enabled:z.boolean(),bindAddress:ip,port:n.int().min(1).max(65535),senderAddress:ip.nullable()}),
 z.strictObject({kind:z.literal('ifacialmocap'),enabled:z.boolean(),bindAddress:ip,port:n.int().min(1).max(65535),phoneAddress:ip.nullable()}),
 z.strictObject({kind:z.literal('mediapipe'),enabled:z.boolean(),deviceId:z.string().max(512),face:z.boolean(),upperBody:z.boolean(),hands:z.boolean(),mirror:z.boolean()}).refine(c=>!c.enabled||c.face||c.upperBody||c.hands)
]);
export const AvatarIdleSchema=z.strictObject({kind:z.literal('builtin'),enabled:z.boolean()});
export const AvatarTrackingSchema=z.strictObject({bodySourceId:id.nullable(),faceSourceId:id.nullable(),fingersSourceId:id.nullable().optional()});
const calibrationBone=z.strictObject({rotation:quat,space:z.enum(['raw','normalized'])});
export const TrackingCalibrationSchema=z.strictObject({bones:z.partialRecord(z.enum(CALIBRATION_BONES),calibrationBone).refine(v=>{const size=Object.keys(v).length;return size>=1&&size<=6;})});
export const BlendShapeRangeSchema=z.strictObject({inputMin:n.min(0).max(1),inputMax:n.min(0).max(1),outputMin:n.min(0).max(1),outputMax:n.min(0).max(1)}).refine(r=>r.inputMin<r.inputMax&&r.outputMin<=r.outputMax);
const degrees=n.min(-90).max(90);
export const TrackingMappingSchema=z.strictObject({headIntensity:n.min(0).max(2),headOffset:z.tuple([degrees,degrees,degrees]),eyeIntensity:n.min(0).max(2),blendShapeSensitivity:n.min(0).max(3),linkedBlink:z.boolean(),blendShapes:z.partialRecord(z.enum(ARKIT_NAMES),BlendShapeRangeSchema),useEyeBones:z.boolean().optional()});
export const TrackingBoneSchema=z.strictObject({rotation:quat,space:z.enum(['raw','normalized']),position:vec.optional(),weight:n.min(0).max(1).optional()});
const bones=z.record(z.string().refine(name=>HUMANOID_BONES.includes(name)),TrackingBoneSchema).refine(v=>Object.keys(v).length<=64);
const expressions=z.record(z.string().min(1).max(128),n.min(0).max(1)).refine(v=>Object.keys(v).length<=64);
const root=z.strictObject({position:vec,rotation:quat});
export const TrackingSampleSchema=z.strictObject({sourceId:id,generation:u,receivedAtMs:n.nonnegative().max(Number.MAX_SAFE_INTEGER),bones,expressions,root:root.optional()});
export const TrackingStatusSchema=z.strictObject({sourceId:id,generation:u,state:z.enum(['stopped','waiting','receiving','stale','error']),packets:u,invalidPackets:u,lastReceivedAtMs:n.nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),error:z.string().max(512).nullable(),inferenceMs:n.nonnegative().max(60000).optional(),unmatchedPackets:u.optional()});
export const TrackingUpdateSchema=z.strictObject({samples:z.array(TrackingSampleSchema).max(4),statuses:z.array(TrackingStatusSchema).max(4)}).refine(v=>new Set(v.samples.map(s=>s.sourceId)).size===v.samples.length&&new Set(v.statuses.map(s=>s.sourceId)).size===v.statuses.length);
const unit=n.min(0).max(1);
export const TrackingProbeParamsSchema=z.strictObject({sourceId:id,resetPeaks:z.boolean().optional()});
export const TrackingProbeSchema=z.strictObject({sourceId:id,generation:u,state:z.enum(['stopped','waiting','receiving','stale','error']),values:z.partialRecord(z.enum(ARKIT_NAMES),unit),peaks:z.partialRecord(z.enum(ARKIT_NAMES),unit),presentChannels:z.array(z.enum(ARKIT_NAMES)).max(ARKIT_NAMES.length).refine(v=>new Set(v).size===v.length),eyeBones:z.boolean()});
const baseBones=z.record(z.string().refine(name=>HUMANOID_BONES.includes(name)),z.strictObject({rotation:quat,space:z.literal('normalized'),position:vec.optional()})).refine(v=>Object.keys(v).length<=64);
const boneOffsets=z.record(z.string().refine(name=>HUMANOID_BONES.includes(name)),quat).refine(v=>Object.keys(v).length<=55);
export const AvatarPoseSchema=z.strictObject({avatarId:id,baseBones:baseBones.optional(),bones,expressions,root:root.optional(),boneOffsets:boneOffsets.optional()});
export function defaultTrackingConfig(kind:TrackingConfig['kind']):TrackingConfig {
 if(kind==='vmc')return {kind,enabled:false,bindAddress:'127.0.0.1',port:39539,senderAddress:null};
 if(kind==='ifacialmocap')return {kind,enabled:false,bindAddress:'0.0.0.0',port:49983,phoneAddress:null};
 return {kind,enabled:false,deviceId:'',face:true,upperBody:true,hands:false,mirror:false};
}
