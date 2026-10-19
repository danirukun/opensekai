import {FaceLandmarker,PoseLandmarker,HandLandmarker,FilesetResolver} from '@mediapipe/tasks-vision';
import type {TrackingConfig,TrackingSample} from '@opensekai/contracts';
import {createRetargeter,type Observation} from './retarget';
export type MediaPipeConfig=Extract<TrackingConfig,{kind:'mediapipe'}>;
export type WorkerRequest=
 |{kind:'init';config:MediaPipeConfig;assetBase:string}
 |{kind:'frame';image:ImageBitmap;timestamp:number;nativeEpochOffsetMs:number;sourceId:string;generation:number}
 |{kind:'stop'};
export type WorkerReply={kind:'ready'}|{kind:'sample';sample:TrackingSample;inferenceMs:number}|{kind:'error';error:string}|{kind:'stopped'};
const scope=self as unknown as {onmessage:((event:MessageEvent<WorkerRequest>)=>void)|null;postMessage:(data:WorkerReply)=>void;close:()=>void;import?:(url:string)=>Promise<void>;ModuleFactory?:unknown};
// The pinned Tasks loader clears ModuleFactory after each model. Reuse the module's
// default export on cache hits, rather than relying on its first import side effect.
scope.import=async url=>{scope.ModuleFactory=(await import(/* @vite-ignore */ url)).default;};
let face:FaceLandmarker|null=null,pose:PoseLandmarker|null=null,hands:HandLandmarker|null=null,config:MediaPipeConfig|null=null,stopped=false;
const retarget=createRetargeter();
function closeModels(){face?.close();pose?.close();hands?.close();face=null;pose=null;hands=null;}
async function initialize(message:Extract<WorkerRequest,{kind:'init'}>){
 config=message.config;const base=message.assetBase.replace(/\/$/,'');const files=await FilesetResolver.forVisionTasks(base+'/wasm',true);
 if(stopped)return;
 const options=(file:string)=>({baseOptions:{modelAssetPath:base+'/'+file,delegate:'CPU' as const},runningMode:'VIDEO' as const});
 if(config.face){const model=await FaceLandmarker.createFromOptions(files,{...options('face_landmarker.task'),numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true});if(stopped){model.close();return;}face=model;}
 if(config.upperBody){const model=await PoseLandmarker.createFromOptions(files,{...options('pose_landmarker_lite.task'),numPoses:1,outputSegmentationMasks:false});if(stopped){model.close();return;}pose=model;}
 if(config.hands){const model=await HandLandmarker.createFromOptions(files,{...options('hand_landmarker.task'),numHands:2});if(stopped){model.close();return;}hands=model;}
 scope.postMessage({kind:'ready'});
}
function infer(message:Extract<WorkerRequest,{kind:'frame'}>){const started=performance.now();
 try{if(stopped||!config)throw new Error('Tracker is stopped');const observation:Observation={};
  if(face){const r=face.detectForVideo(message.image,message.timestamp);observation.face={matrix:r.facialTransformationMatrixes[0]?.data,blendshapes:r.faceBlendshapes[0]?.categories};}
  if(pose){const r=pose.detectForVideo(message.image,message.timestamp);observation.pose=r.worldLandmarks[0];r.close();}
  if(hands){const r=hands.detectForVideo(message.image,message.timestamp);observation.hands=r.worldLandmarks.map((landmarks,i)=>({landmarks,handedness:r.handedness[i]?.[0]?.categoryName??''}));}
  const receivedAtMs=Math.max(0,performance.timeOrigin+performance.now()+message.nativeEpochOffsetMs);
  const sample=retarget.map(observation,config,message.sourceId,message.generation,receivedAtMs);
  scope.postMessage({kind:'sample',sample,inferenceMs:performance.now()-started});
 }finally{message.image.close();}
}
scope.onmessage=event=>{const m=event.data;
 if(m.kind==='stop'){stopped=true;closeModels();scope.postMessage({kind:'stopped'});scope.close();return;}
 if(m.kind==='init'){void initialize(m).catch(error=>{closeModels();if(!stopped)scope.postMessage({kind:'error',error:String(error).slice(0,512)});});return;}
 try{infer(m);}catch(error){scope.postMessage({kind:'error',error:String(error).slice(0,512)});}
};
