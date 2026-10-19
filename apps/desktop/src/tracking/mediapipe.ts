import type {TrackingConfig,TrackingSample,TrackingStatus} from '@opensekai/contracts';
import {createLatestQueue,createStartGate} from './lifecycle';
import type {MediaPipeConfig,WorkerRequest,WorkerReply} from './mediapipe-worker';
export interface MediaPipeSource {id:string;generation:number;config:TrackingConfig}
export interface CameraDevice {deviceId:string;label:string}
interface WorkerPort {
 postMessage(message:WorkerRequest,transfer?:Transferable[]):void;
 onmessage:((event:MessageEvent<WorkerReply>)=>void)|null;
 onerror:((event:ErrorEvent)=>void)|null;
 terminate():void;
}
export interface TrackerDependencies {
 getUserMedia:(constraints:MediaStreamConstraints)=>Promise<MediaStream>;
 enumerateDevices:()=>Promise<MediaDeviceInfo[]>;
 createWorker:()=>WorkerPort;
 createVideo:()=>HTMLVideoElement;
 createBitmap:(video:HTMLVideoElement)=>Promise<ImageBitmap>;
}
export interface MediaPipeTrackerOptions {
 onSample:(sample:TrackingSample)=>void;
 onStatus:(status:TrackingStatus)=>void;
 onDevices?:(devices:CameraDevice[])=>void;
 onInference?:(sourceId:string,milliseconds:number)=>void;
 /** Convert browser time to the native publisher's elapsed clock domain. */
 now:()=>number;
 dependencies?:Partial<TrackerDependencies>;
}
const newWorker=()=>new Worker(new URL('./mediapipe-worker.ts',import.meta.url),{type:'module'}) as WorkerPort;
const errorText=(error:unknown)=>error instanceof Error?`${error.name}: ${error.message}`.slice(0,512):String(error).slice(0,512);
function waitForReply(worker:WorkerPort,request:WorkerRequest,kind:'ready'|'sample',timeout:number,signal?:AbortSignal):Promise<WorkerReply>{
 return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};const abort=()=>{cleanup();reject(new Error('Tracker stopped'));};const timer=setTimeout(()=>{cleanup();reject(new Error('MediaPipe worker timed out'));},timeout);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}worker.onmessage=event=>{if(event.data.kind===kind){cleanup();resolve(event.data);}else if(event.data.kind==='error'){cleanup();reject(new Error(event.data.error));}};worker.onerror=event=>{cleanup();reject(new Error(event.message||'MediaPipe worker failed'));};try{worker.postMessage(request,request.kind==='frame'?[request.image]:[]);}catch(error){cleanup();reject(error);}});
}
export function createMediaPipeTracker(options:MediaPipeTrackerOptions){
 const dependencies:TrackerDependencies={
  getUserMedia:constraints=>navigator.mediaDevices.getUserMedia(constraints),
  enumerateDevices:()=>navigator.mediaDevices.enumerateDevices(),
  createWorker:newWorker,createVideo:()=>document.createElement('video'),createBitmap:video=>createImageBitmap(video),...options.dependencies,
 };
 interface Run {source:MediaPipeSource&{config:MediaPipeConfig};signature:string;abort:AbortController;gate:ReturnType<typeof createStartGate>;token:number;stream:MediaStream|null;video:HTMLVideoElement|null;worker:WorkerPort|null;queue:ReturnType<typeof createLatestQueue<ImageBitmap>>|null;timer:ReturnType<typeof setTimeout>|null;disposed:boolean;status:TrackingStatus}
 const runs=new Map<string,Run>();let shutdown=false;
 const status=(run:Run,state:TrackingStatus['state'],error:string|null=null)=>{run.status={...run.status,state,error};if(state==='stopped'||state==='error')delete run.status.inferenceMs;options.onStatus({...run.status});};
 function dispose(run:Run){if(run.disposed)return;run.disposed=true;run.abort.abort();run.gate.stop();if(run.timer!==null)clearTimeout(run.timer);run.queue?.stop();run.stream?.getTracks().forEach(track=>track.stop());if(run.video){run.video.pause();run.video.srcObject=null;}if(run.worker){run.worker.postMessage({kind:'stop'});const worker=run.worker;setTimeout(()=>worker.terminate(),100);}run.worker=null;}
 function fail(run:Run,error:unknown){if(run.disposed)return;dispose(run);status(run,'error',errorText(error));}
 async function start(run:Run){const current=()=>!run.disposed&&run.gate.current(run.token);
  try{
   const stream=await dependencies.getUserMedia({audio:false,video:{deviceId:run.source.config.deviceId?{exact:run.source.config.deviceId}:undefined,width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}}});
   if(!current()){stream.getTracks().forEach(track=>track.stop());return;}run.stream=stream;
   for(const track of stream.getVideoTracks())track.onended=()=>fail(run,new Error('Camera device disconnected'));
   const video=dependencies.createVideo();run.video=video;video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();if(!current())return;
   const devices=await dependencies.enumerateDevices();if(!current())return;options.onDevices?.(devices.filter(d=>d.kind==='videoinput').map(d=>({deviceId:d.deviceId,label:d.label})));
   const worker=dependencies.createWorker();run.worker=worker;
   await waitForReply(worker,{kind:'init',config:run.source.config,assetBase:new URL('/tracking/',location.href).href},'ready',30000,run.abort.signal);if(!current())return;
   run.queue=createLatestQueue<ImageBitmap>(async image=>{
    if(!current())return;
    const reply=await waitForReply(worker,{kind:'frame',image,timestamp:performance.now(),nativeEpochOffsetMs:options.now()-performance.timeOrigin-performance.now(),sourceId:run.source.id,generation:run.source.generation},'sample',15000,run.abort.signal);
    if(!current()||reply.kind!=='sample')return;
    if(!Number.isFinite(reply.inferenceMs)||reply.inferenceMs<0||reply.inferenceMs>60000)throw new Error('Invalid MediaPipe inference duration');
    run.status.inferenceMs=reply.inferenceMs;
    options.onInference?.(run.source.id,reply.inferenceMs);
    const sample=reply.sample;
    if(Object.keys(sample.bones).length||Object.keys(sample.expressions).length){run.status.packets++;run.status.lastReceivedAtMs=sample.receivedAtMs;options.onSample(sample);status(run,'receiving');}
    else status(run,run.status.lastReceivedAtMs!==null&&options.now()-run.status.lastReceivedAtMs>500?'stale':run.status.state);
   },error=>fail(run,error));
   let capturePending=false,lastVideoTime=-1,lastCapture=-Infinity;
   const tick=()=>{if(!current())return;run.timer=setTimeout(tick,Math.max(1,1000/30-(performance.now()-lastCapture)));
    if(capturePending||video.readyState<2||video.currentTime===lastVideoTime||performance.now()-lastCapture<1000/30)return;
    run.queue?.dropPending();capturePending=true;lastVideoTime=video.currentTime;lastCapture=performance.now();
    void dependencies.createBitmap(video).then(image=>{if(!current())image.close();else run.queue?.push(image);}).catch(error=>fail(run,error)).finally(()=>{capturePending=false;});
    if(run.status.lastReceivedAtMs!==null&&options.now()-run.status.lastReceivedAtMs>500&&run.status.state==='receiving')status(run,'stale');
   };tick();
  }catch(error){fail(run,error);}
 }
 return {
  reconcile(sources:readonly MediaPipeSource[]){if(shutdown)return;const wanted=new Map(sources.filter((s):s is MediaPipeSource&{config:MediaPipeConfig}=>s.config.kind==='mediapipe').map(s=>[s.id,s]));
   for(const [id,run] of runs){const source=wanted.get(id),signature=source?JSON.stringify([source.generation,source.config]):'';if(signature!==run.signature){dispose(run);status(run,'stopped');runs.delete(id);}}
   for(const source of wanted.values()){if(runs.has(source.id))continue;const gate=createStartGate(),run:Run={source,signature:JSON.stringify([source.generation,source.config]),abort:new AbortController(),gate,token:gate.begin(),stream:null,video:null,worker:null,queue:null,timer:null,disposed:false,status:{sourceId:source.id,generation:source.generation,state:'stopped',packets:0,invalidPackets:0,lastReceivedAtMs:null,error:null}};runs.set(source.id,run);if(source.config.enabled){status(run,'waiting');void start(run);}else status(run,'stopped');}
  },
  stop(){for(const run of runs.values()){dispose(run);status(run,'stopped');}runs.clear();},
  shutdown(){shutdown=true;this.stop();},
 };
}
/** Runs actual bundled model initialization and inference without camera permission. */
export async function diagnoseMediaPipe():Promise<{modelsLoaded:true;inferenceCompleted:true;inferenceMs:number}> {
 const worker=newWorker();let image:ImageBitmap|null=null;
 try{await waitForReply(worker,{kind:'init',assetBase:new URL('/tracking/',location.href).href,config:{kind:'mediapipe',enabled:true,deviceId:'',face:true,upperBody:true,hands:true,mirror:false}},'ready',60000);
  const canvas=new OffscreenCanvas(256,256);const context=canvas.getContext('2d');if(!context)throw new Error('OffscreenCanvas unavailable');context.fillStyle='#808080';context.fillRect(0,0,256,256);image=canvas.transferToImageBitmap();
  const reply=await waitForReply(worker,{kind:'frame',image,timestamp:performance.now(),nativeEpochOffsetMs:-performance.timeOrigin,sourceId:'diagnostic',generation:0},'sample',30000);if(reply.kind!=='sample')throw new Error('No inference reply');return {modelsLoaded:true,inferenceCompleted:true,inferenceMs:reply.inferenceMs};
 }finally{image?.close();worker.postMessage({kind:'stop'});setTimeout(()=>worker.terminate(),100);}
}
