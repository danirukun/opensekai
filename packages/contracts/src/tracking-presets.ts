import type {ArkitName} from './expressions';
import {DEFAULT_TRACKING_SMOOTHING,defaultTrackingConfig,type TrackingConfig,type TrackingSmoothing,type VmcPositionRule} from './tracking';

export type TrackingPresetId='selfreflect'|'ifacialmocap'|'vmc'|'webcam'|'openseeface'|'facekit';
export type ExpressionStepId='blink'|'mouthWide'|'browsUp'|'smile'|'frown'|'pucker'|'puffCheeks'|'tongueOut'|'lookAround';
export type TrackingSlot='body'|'face'|'fingers';
export interface TrackingPreset {id:TrackingPresetId;label:string;config:TrackingConfig;slots:readonly TrackingSlot[];connect:'showAddress'|'askPhone'|'pickCamera'|'pickHostCamera';calibrate:boolean;smoothing:TrackingSmoothing;steps:readonly ExpressionStepId[]}

const STEPS:readonly ExpressionStepId[]=['blink','mouthWide','browsUp','smile','frown','pucker','puffCheeks','tongueOut','lookAround'];
const vmc=(id:'selfreflect'|'vmc',label:string,rule?:VmcPositionRule):TrackingPreset=>({id,label,config:{kind:'vmc',enabled:true,bindAddress:'0.0.0.0',port:39539,senderAddress:null,...(rule?{positions:rule}:{})},slots:['body','face','fingers'],connect:'showAddress',calibrate:false,smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS});

export const TRACKING_PRESETS:readonly TrackingPreset[]=[
 // Gate 1 (TRK-23 S3): SelfReflect bone positions are on mixed scales (hands in cm, hips below the floor, zero for the other bones).
 vmc('selfreflect','SelfReflect','rotationsOnly'),
 {id:'ifacialmocap',label:'iFacialMocap',config:{kind:'ifacialmocap',enabled:true,bindAddress:'0.0.0.0',port:49983,phoneAddress:null},slots:['face'],connect:'askPhone',calibrate:true,smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS},
 vmc('vmc','Other VMC app'),
 // The guide sets face, upperBody, and hands from the slots that the webcam fills. An empty deviceId is the default camera.
 {id:'webcam',label:'Webcam',config:{kind:'mediapipe',enabled:true,deviceId:'',face:true,upperBody:true,hands:true,mirror:false},slots:['body','face','fingers'],connect:'pickCamera',calibrate:true,smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS},
 {id:'openseeface',label:'OpenSeeFace',config:{...defaultTrackingConfig('openseeface'),enabled:true},slots:['face'],connect:'showAddress',calibrate:true,smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS},
 {id:'facekit',label:'FaceKit',config:{kind:'facekit',enabled:true,deviceId:''},slots:['face'],connect:'pickHostCamera',calibrate:true,smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS}
];

export const EXPRESSION_STEPS:Record<ExpressionStepId,{main:readonly ArkitName[];also:readonly ArkitName[]}>={
 blink:{main:['eyeBlinkLeft','eyeBlinkRight'],also:['eyeSquintLeft','eyeSquintRight']},
 mouthWide:{main:['jawOpen'],also:['mouthStretchLeft','mouthStretchRight','mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight']},
 browsUp:{main:['browInnerUp'],also:['browOuterUpLeft','browOuterUpRight']},
 smile:{main:['mouthSmileLeft','mouthSmileRight'],also:['cheekSquintLeft','cheekSquintRight','mouthDimpleLeft','mouthDimpleRight']},
 frown:{main:['mouthFrownLeft','mouthFrownRight'],also:['browDownLeft','browDownRight','noseSneerLeft','noseSneerRight']},
 pucker:{main:['mouthPucker'],also:['mouthFunnel','mouthRollLower','mouthRollUpper','mouthPressLeft','mouthPressRight']},
 puffCheeks:{main:['cheekPuff'],also:[]},
 tongueOut:{main:['tongueOut'],also:[]},
 lookAround:{main:['eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight'],also:[]}
};
