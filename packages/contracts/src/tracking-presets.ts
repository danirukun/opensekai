import type {ArkitName} from './expressions';
import {DEFAULT_TRACKING_SMOOTHING,type TrackingConfig,type TrackingSmoothing} from './tracking';

export type TrackingPresetId='selfreflect'|'ifacialmocap'|'vmc';
export type ExpressionStepId='blink'|'mouthWide'|'browsUp'|'smile'|'frown'|'pucker'|'puffCheeks'|'tongueOut'|'lookAround';
export type TrackingSlot='body'|'face'|'fingers';
export interface TrackingPreset {id:TrackingPresetId;label:string;config:TrackingConfig;slots:readonly TrackingSlot[];connect:'showAddress'|'askPhone';smoothing:TrackingSmoothing;steps:readonly ExpressionStepId[]}

const STEPS:readonly ExpressionStepId[]=['blink','mouthWide','browsUp','smile','frown','pucker','puffCheeks','tongueOut','lookAround'];
const vmc=(id:'selfreflect'|'vmc',label:string):TrackingPreset=>({id,label,config:{kind:'vmc',enabled:true,bindAddress:'0.0.0.0',port:39539,senderAddress:null},slots:['body','face','fingers'],connect:'showAddress',smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS});

export const TRACKING_PRESETS:readonly TrackingPreset[]=[
 vmc('selfreflect','SelfReflect'),
 {id:'ifacialmocap',label:'iFacialMocap',config:{kind:'ifacialmocap',enabled:true,bindAddress:'0.0.0.0',port:49983,phoneAddress:null},slots:['face'],connect:'askPhone',smoothing:{...DEFAULT_TRACKING_SMOOTHING},steps:STEPS},
 vmc('vmc','Other VMC app')
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
