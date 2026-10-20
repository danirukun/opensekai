// Hidden tracker cameras (B18, TRK-22). The pattern list is per user in the Editor window storage, never in the show.
// This file has no runtime imports, so the match Worker and a Node worker thread can both load it.
import type {CameraDevice} from './mediapipe';

export const HIDDEN_CAMERAS_KEY='opensekai.tracking.hiddenCameras';
export const DEFAULT_HIDDEN_CAMERAS:readonly string[]=['VSeeFace','VTube Studio','VMC','Unity Video Capture','OpenSekai'];
export const MAX_PATTERNS=32,MAX_PATTERN=128,MATCH_DEADLINE=100;
export interface PatternCheck {patterns:string[];invalidLine:number|null}
export interface MatchRequest {text:string;labels:string[]}
export interface MatchReply {hidden:boolean[];patterns:string[];invalidLine:number|null}
export interface HiddenCamerasState {text:string;hidden:string[];alert:string|null}
export interface WorkerPort {postMessage(message:unknown):void;onmessage:((event:{data:unknown})=>void)|null;terminate():void}
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'>;

const compile=(line:string)=>{try{const pattern=new RegExp(line,'i');return pattern.test('')?null:pattern;}catch{return null;}};
// Runs user patterns: call it only in the match Worker or a test, never on the Editor main thread.
export function checkPatterns(text:string):PatternCheck{
 const patterns:string[]=[];let invalidLine:number|null=null,count=0;
 text.split('\n').forEach((raw,index)=>{
  const line=raw.trim();if(!line)return;count++;
  if(count>MAX_PATTERNS||line.length>MAX_PATTERN||!compile(line)){invalidLine??=index+1;return;}
  patterns.push(line);
 });
 return {patterns,invalidLine};
}
export const matchLabels=(patterns:readonly string[],labels:readonly string[]):boolean[]=>{
 const compiled=patterns.map(pattern=>new RegExp(pattern,'i'));
 return labels.map(label=>label!==''&&compiled.some(pattern=>pattern.test(label)));
};
export function matchRequest({text,labels}:MatchRequest):MatchReply{const {patterns,invalidLine}=checkPatterns(text);return {hidden:matchLabels(patterns,labels),patterns,invalidLine};}
// The selected device stays visible, so a pattern never makes a saved camera look unavailable.
export const visibleCameras=(devices:readonly CameraDevice[],hidden:readonly string[],selectedId:string):CameraDevice[]=>devices.filter(device=>device.deviceId===selectedId||!hidden.includes(device.deviceId));

// Stored values get the shape and size checks here; the Worker checks compile and empty match again.
export function loadHiddenCameras(storage:Storage|null):string[]{
 try{
  const raw:unknown=JSON.parse(storage?.getItem(HIDDEN_CAMERAS_KEY)??'null');
  if(Array.isArray(raw)&&raw.length<=MAX_PATTERNS&&raw.every(item=>typeof item==='string'&&item.trim()!==''&&item.length<=MAX_PATTERN))return raw;
 }catch{/* fall through to the defaults */}
 return [...DEFAULT_HIDDEN_CAMERAS];
}
export function saveHiddenCameras(storage:Storage|null,patterns:readonly string[]){try{storage?.setItem(HIDDEN_CAMERAS_KEY,JSON.stringify(patterns));}catch{/* edits then last until the Editor window closes */}}
// The Scene window sends this prefix as one `trackingDevices` message, which the Editor rejects above the byte limit.
export function fitDevices(devices:readonly CameraDevice[],limit=16,bytes=4096):CameraDevice[]{
 const size=(list:CameraDevice[])=>new TextEncoder().encode(JSON.stringify({kind:'trackingDevices',devices:list})).length;
 const fitted:CameraDevice[]=[];
 for(const device of devices.slice(0,limit)){if(size([...fitted,device])>bytes)break;fitted.push(device);}
 return fitted;
}

// One shared state for every inspector. Each change of text or labels runs one Worker request with a deadline.
export function createHiddenCameras({spawn,storage,deadline=MATCH_DEADLINE}:{spawn:()=>WorkerPort;storage:Storage|null;deadline?:number}){
 let state:HiddenCamerasState={text:loadHiddenCameras(storage).join('\n'),hidden:[],alert:null},devices:CameraDevice[]=[];
 let worker:WorkerPort|null=null,busy=false,timer:ReturnType<typeof setTimeout>|undefined,seq=0;
 const listeners=new Set<(state:HiddenCamerasState)=>void>();
 const set=(next:Partial<HiddenCamerasState>)=>{state={...state,...next};for(const fn of listeners)fn(state);};
 const stop=()=>{worker?.terminate();worker=null;busy=false;};
 function run(){
  const id=++seq,sent=devices;clearTimeout(timer);
  if(busy)stop();
  worker??=spawn();busy=true;
  const port=worker;
  port.onmessage=({data})=>{
   if(id!==seq)return;clearTimeout(timer);busy=false;
   const reply=data as MatchReply;
   saveHiddenCameras(storage,reply.patterns);
   set({hidden:sent.filter((_,index)=>reply.hidden[index]).map(device=>device.deviceId),alert:reply.invalidLine===null?null:`Line ${reply.invalidLine} is not used.`});
  };
  timer=setTimeout(()=>{if(id!==seq)return;stop();set({hidden:[],alert:'Patterns take too long.'});},deadline);
  port.postMessage({text:state.text,labels:sent.map(device=>device.label)} satisfies MatchRequest);
 }
 const setText=(text:string)=>{if(text===state.text)return;set({text});run();};
 return {
  state:()=>state,
  setText,
  restoreDefaults:()=>setText(DEFAULT_HIDDEN_CAMERAS.join('\n')),
  setDevices(next:readonly CameraDevice[]){if(seq>0&&JSON.stringify(next)===JSON.stringify(devices))return;devices=[...next];run();},
  subscribe(fn:(state:HiddenCamerasState)=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};},
  dispose(){clearTimeout(timer);seq++;stop();},
 };
}
