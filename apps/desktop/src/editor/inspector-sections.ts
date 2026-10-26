import type {SceneEntity} from '@opensekai/contracts';
// Inspector sections, their collapse state, and the section that the index marks as current (B17 R10–R16).
export interface InspectorSection {id:string;label:string}
export interface SectionState {version:1;collapsed:string[]}
export const SECTION_STORAGE_KEY='opensekai.inspector.sections';
const MAX_STATE_BYTES=4096;
const section=(id:string,label:string):InspectorSection=>({id,label});
const transform=section('transform','Transform');
export function sectionsFor(entity:SceneEntity,options:{expressions:boolean}):InspectorSection[] {
 if(entity.kind==='camera')return [transform,section('rendering','Rendering'),section('lens','Lens'),section('control','Control'),section('screenshot','Screenshot')];
 if(entity.kind==='light')return [transform,section('light','Light'),section('affect','Affect'),...(entity.light.type!=='ambient'?[section('shadow','Shadow')]:[])];
 if(entity.kind==='haze')return [transform,section('haze','Haze')];
 if(entity.kind==='fpsCounter')return [section('fpsCounter','FPS Counter')];
 if(entity.kind==='vmcSender')return [section('sender','Sender')];
 if(entity.kind==='environment')return [transform,section('environment','Environment')];
 if(entity.kind==='avatar')return [transform,section('model','Model'),...(options.expressions?[section('expressions','Expressions')]:[]),section('tracking','Tracking')];
 if(entity.kind==='tracking')return [section('receiver','Receiver'),section('smoothing','Smoothing'),section('face','Face'),section('diagnostics','Diagnostics')];
 return [transform];
}
// The sections that were inside the closed tracking Advanced disclosure start collapsed (R12).
export const START_STATE:SectionState=Object.freeze({version:1,collapsed:Object.freeze(['tracking:smoothing','tracking:face','tracking:diagnostics']) as string[]});
const key=(kind:string,id:string)=>`${kind}:${id}`;
export function parseSectionState(text:string|null):SectionState {
 if(text===null||text.length>MAX_STATE_BYTES)return START_STATE;
 try{
  const value:unknown=JSON.parse(text);
  if(typeof value!=='object'||value===null)return START_STATE;
  const {version,collapsed}=value as Record<string,unknown>;
  if(version!==1||!Array.isArray(collapsed)||!collapsed.every(item=>typeof item==='string'))return START_STATE;
  return {version:1,collapsed:[...new Set(collapsed as string[])]};
 }catch{return START_STATE;}
}
export const isCollapsed=(state:SectionState,kind:string,id:string):boolean=>state.collapsed.includes(key(kind,id));
export function setCollapsed(state:SectionState,kind:string,id:string,collapsed:boolean):SectionState {
 if(isCollapsed(state,kind,id)===collapsed)return state;
 const item=key(kind,id);
 return {version:1,collapsed:collapsed?[...state.collapsed,item]:state.collapsed.filter(entry=>entry!==item)};
}
export const toggleSection=(state:SectionState,kind:string,id:string):SectionState=>setCollapsed(state,kind,id,!isCollapsed(state,kind,id));
// The last section whose top is at or above the scroll top plus 8 px; the last one at the end of the scroll (R14).
// Each top is relative to the top of the scroll content.
export function currentSection(tops:readonly number[],scrollTop:number,clientHeight:number,scrollHeight:number):number {
 if(tops.length===0)return -1;
 // A column that does not scroll is at its top, not at its end.
 if(scrollHeight>clientHeight&&scrollTop+clientHeight>=scrollHeight-1)return tops.length-1;
 let current=0;
 tops.forEach((top,index)=>{if(top<=scrollTop+8)current=index;});
 return current;
}
