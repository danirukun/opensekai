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

// Stored values keep the entries that pass the size checks here; the Worker checks compile and empty match again.
export function loadHiddenCameras(storage:Storage|null):string[]{
 try{
  const raw:unknown=JSON.parse(storage?.getItem(HIDDEN_CAMERAS_KEY)??'null');
  if(Array.isArray(raw))return raw.filter((item):item is string=>typeof item==='string'&&item.trim()!==''&&item.length<=MAX_PATTERN).slice(0,MAX_PATTERNS);
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
// The Worker posts `{ready: true}` once its module loads; the deadline counts only the match, not the Worker start.
export function createHiddenCameras({spawn,storage,deadline=MATCH_DEADLINE}:{spawn:()=>WorkerPort;storage:Storage|null;deadline?:number}){
 interface Request {id:number;text:string;sent:CameraDevice[]}
 let state:HiddenCamerasState={text:loadHiddenCameras(storage).join('\n'),hidden:[],alert:null},devices:CameraDevice[]=[];
 let worker:WorkerPort|null=null,ready=false,pending:Request|null=null,active:Request|null=null,timer:ReturnType<typeof setTimeout>|undefined,seq=0;
 const listeners=new Set<(state:HiddenCamerasState)=>void>();
 const set=(next:Partial<HiddenCamerasState>)=>{state={...state,...next};for(const fn of listeners)fn(state);};
 const stop=()=>{clearTimeout(timer);worker?.terminate();worker=null;ready=false;active=null;};
 function send(){
  if(!worker||!ready||active||!pending)return;
  const request=pending;pending=null;active=request;
  timer=setTimeout(()=>{if(active!==request)return;stop();set({hidden:[],alert:'Patterns take too long.'});},deadline);
  worker.postMessage({text:request.text,labels:request.sent.map(device=>device.label)} satisfies MatchRequest);
 }
 function start(){
  let port:WorkerPort;
  try{port=spawn();}catch{set({hidden:[]});return;}
  worker=port;
  port.onmessage=({data})=>{
   if(port!==worker)return;
   if((data as {ready?:unknown}).ready===true){ready=true;send();return;}
   clearTimeout(timer);const request=active;active=null;
   if(request?.id===seq){
    const reply=data as MatchReply;
    saveHiddenCameras(storage,reply.patterns);
    set({hidden:request.sent.filter((_,index)=>reply.hidden[index]).map(device=>device.deviceId),alert:reply.invalidLine===null?null:`Line ${reply.invalidLine} is not used.`});
   }
   send();
  };
 }
 function run(){
  pending={id:++seq,text:state.text,sent:devices};
  // A match for older input that is still running is stale; a cold Worker keeps loading.
  if(active)stop();
  if(!worker)start();
  send();
 }
 const setText=(text:string)=>{if(text===state.text)return;set({text});run();};
 return {
  state:()=>state,
  setText,
  restoreDefaults:()=>setText(DEFAULT_HIDDEN_CAMERAS.join('\n')),
  setDevices(next:readonly CameraDevice[]){if(seq>0&&JSON.stringify(next)===JSON.stringify(devices))return;devices=[...next];run();},
  subscribe(fn:(state:HiddenCamerasState)=>void){listeners.add(fn);return ()=>{listeners.delete(fn);};},
  dispose(){seq++;pending=null;stop();},
 };
}
