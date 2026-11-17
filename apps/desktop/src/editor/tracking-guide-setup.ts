import {TRACKING_PRESETS,type Id,type SceneEntity,type SceneView,type TrackingConfig,type TrackingPreset,type TrackingPresetId} from '@opensekai/contracts';

export type FaceChoice='webcam'|'facekit'|'ifacialmocap'|'selfreflect'|'vmc'|'openseeface'|'none';
export type BodyChoice='same'|'webcam'|'selfreflect'|'vmc'|'none';
export interface SetupChoice {face:FaceChoice;body:BodyChoice;hands:boolean}
export type SetupRole='face'|'body'|'fingers';
export interface SetupPart {preset:TrackingPreset;roles:SetupRole[];config:TrackingConfig}
export interface ChoiceOption<T extends string> {value:T;label:string;disabled:boolean}

type Source=Extract<SceneEntity,{kind:'tracking'}>;
type Avatar=Extract<SceneEntity,{kind:'avatar'}>;

const FACE_ORDER:readonly FaceChoice[]=['webcam','facekit','ifacialmocap','selfreflect','vmc','openseeface','none'];
const BODY_ORDER:readonly BodyChoice[]=['same','webcam','selfreflect','vmc','none'];
// These faces cannot drive a body, so Body "Same as face" does not apply.
const NO_SAME:readonly FaceChoice[]=['facekit','ifacialmocap','openseeface','none'];

const presetOf=(id:TrackingPresetId):TrackingPreset=>TRACKING_PRESETS.find(p=>p.id===id)!;
const labelOf=(choice:FaceChoice|BodyChoice)=>choice==='none'?'None':choice==='same'?'Same as face':presetOf(choice).label;
const avatarOf=(scene:SceneView,avatarId:Id)=>scene.entities.find((e):e is Avatar=>e.kind==='avatar'&&e.id===avatarId);
const sourceOf=(scene:SceneView,id:Id|null|undefined)=>id?scene.entities.find((e):e is Source=>e.kind==='tracking'&&e.id===id):undefined;
const boundIds=(avatar:Avatar)=>[avatar.tracking?.bodySourceId,avatar.tracking?.faceSourceId,avatar.tracking?.fingersSourceId];

// Only one FaceKit session runs, so a FaceKit source of the other character makes the option unavailable.
export function faceOptions(isMac:boolean,scene:SceneView,avatarId:Id):ChoiceOption<FaceChoice>[] {
 const held=scene.entities.some(e=>e.kind==='avatar'&&e.id!==avatarId&&boundIds(e).some(id=>{const s=sourceOf(scene,id);return s?.config.kind==='facekit'&&s.config.enabled;}));
 return FACE_ORDER.filter(face=>face!=='facekit'||isMac).map(value=>({value,label:labelOf(value),disabled:value==='facekit'&&held}));
}

export const bodyOptions=(face:FaceChoice):ChoiceOption<BodyChoice>[]=>BODY_ORDER.map(value=>({value,label:labelOf(value),disabled:value==='same'&&NO_SAME.includes(face)}));

export const changeFace=(choice:SetupChoice,face:FaceChoice):SetupChoice=>({...choice,face,body:choice.body==='same'&&NO_SAME.includes(face)?'none':choice.body});

const bodyPreset=(choice:SetupChoice):TrackingPresetId|null=>
 choice.body==='none'?null:choice.body==='same'?(NO_SAME.includes(choice.face)?null:choice.face as TrackingPresetId):choice.body;

export const showsHands=(choice:SetupChoice):boolean=>bodyPreset(choice)==='webcam';
export const canContinue=(choice:SetupChoice):boolean=>!(choice.face==='none'&&choice.body==='none');

const choiceOf=(config:TrackingConfig):Exclude<FaceChoice,'none'>=>
 config.kind==='vmc'?(config.positions==='rotationsOnly'?'selfreflect':'vmc'):config.kind==='mediapipe'?'webcam':config.kind;

// A character with no face and no body source starts at the webcam (owner question Q1, answer a).
// Hands is on unless a bound webcam source is missing from the fingers slot.
export function initialChoice(scene:SceneView,avatarId:Id):SetupChoice {
 const tracking=avatarOf(scene,avatarId)?.tracking;
 const face=sourceOf(scene,tracking?.faceSourceId),body=sourceOf(scene,tracking?.bodySourceId);
 if(!face&&!body)return {face:'webcam',body:'same',hands:true};
 const faceChoice:FaceChoice=face?choiceOf(face.config):'none';
 const bodyKind=body?choiceOf(body.config):'none';
 const bodyChoice:BodyChoice=body&&body.id===face?.id?'same':bodyKind==='webcam'||bodyKind==='selfreflect'||bodyKind==='vmc'?bodyKind:'none';
 const webcam=[body,face].find(s=>s?.config.kind==='mediapipe');
 return {face:faceChoice,body:bodyChoice,hands:webcam?tracking?.fingersSourceId===webcam.id:true};
}

// A webcam part turns on only the channels of its roles.
function partOf(id:TrackingPresetId,roles:SetupRole[]):SetupPart {
 const preset=presetOf(id);
 const config:TrackingConfig=preset.config.kind==='mediapipe'?{...preset.config,face:roles.includes('face'),upperBody:roles.includes('body'),hands:roles.includes('fingers')}:{...preset.config};
 return {preset,roles,config};
}

// Fingers follow a VMC body, or a webcam body with Hands on. One preset on both sides gives one part.
export function resolveSetup(choice:SetupChoice):SetupPart[] {
 const face=choice.face==='none'?null:choice.face,body=bodyPreset(choice);
 const fingers=body!==null&&(body!=='webcam'||choice.hands);
 const bodyRoles:SetupRole[]=body===null?[]:fingers?['body','fingers']:['body'];
 if(face!==null&&face===body)return [partOf(face,['face',...bodyRoles])];
 return [...(face!==null?[partOf(face,['face'])]:[]),...(body!==null?[partOf(body,bodyRoles)]:[])];
}
