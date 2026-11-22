import {
 DEFAULT_CAMERA_EFFECTS,DEFAULT_CAMERA_GRADING,DEFAULT_CAMERA_LENS,concertFocalLengthMm,lensWithFocalLength,
 type CameraEffects,type CameraGrading,type CameraLens,type Id,type PatchOp
} from '@opensekai/contracts';
// Named Lens presets (#343 design table). Only Cinematic is a documented full look, so only it returns a grading change.
export type LensPresetId='default'|'portrait'|'wide'|'cinematic'|'concert';
export const LENS_PRESETS:readonly {id:LensPresetId;label:string}[]=[
 {id:'default',label:'Default'},{id:'portrait',label:'Portrait'},{id:'wide',label:'Wide'},{id:'cinematic',label:'Cinematic'},{id:'concert',label:'Concert'}
];
// The look-stack groups a preset always sets, so callers can read them without an optional-chain.
type LensPresetEffects=CameraEffects&Required<Pick<CameraEffects,'depthOfField'|'lensFlare'|'anamorphicFlare'|'filmGrain'|'vignetting'>>;
export interface LensPresetResult {lens:CameraLens;effects?:LensPresetEffects;grading?:CameraGrading}
interface PresetSpec {
 focalLengthMm:number;fStop:number;autofocus:boolean;
 depthOfField:boolean;lensFlare:boolean;anamorphicFlare:boolean;filmGrain:boolean;vignetting:boolean;
 grading?:CameraGrading;
}
// All presets are defined against Full Frame, so applying one also resets the sensor (D-343 Task 8).
const PRESETS:Record<LensPresetId,PresetSpec>={
 default:{focalLengthMm:DEFAULT_CAMERA_LENS.focalLengthMm,fStop:DEFAULT_CAMERA_LENS.fStop,autofocus:false,depthOfField:false,lensFlare:false,anamorphicFlare:false,filmGrain:false,vignetting:false},
 portrait:{focalLengthMm:85,fStop:1.8,autofocus:true,depthOfField:true,lensFlare:false,anamorphicFlare:false,filmGrain:false,vignetting:false},
 wide:{focalLengthMm:24,fStop:2.8,autofocus:false,depthOfField:false,lensFlare:false,anamorphicFlare:false,filmGrain:false,vignetting:false},
 cinematic:{focalLengthMm:35,fStop:2,autofocus:false,depthOfField:false,lensFlare:false,anamorphicFlare:false,filmGrain:true,vignetting:true,grading:{...DEFAULT_CAMERA_GRADING,toneMapping:'aces'}},
 concert:{focalLengthMm:concertFocalLengthMm(),fStop:4,autofocus:false,depthOfField:false,lensFlare:false,anamorphicFlare:false,filmGrain:false,vignetting:false}
};
// The physical lens plus the look-stack flags the preset sets. Unrelated effect groups (lens dirt, night
// vision, blur, pixelate) and the focus distance / clip planes carry over from the current camera.
export function applyLensPreset(id:LensPresetId,lens:CameraLens,effects?:CameraEffects):LensPresetResult {
 const spec=PRESETS[id];
 const nextLens=lensWithFocalLength({...lens,sensorPreset:'fullFrame',fStop:spec.fStop,autofocus:spec.autofocus},spec.focalLengthMm);
 const nextEffects:LensPresetEffects={
  ...effects,
  depthOfField:{...DEFAULT_CAMERA_EFFECTS.depthOfField,...effects?.depthOfField,enabled:spec.depthOfField},
  lensFlare:{...DEFAULT_CAMERA_EFFECTS.lensFlare,...effects?.lensFlare,enabled:spec.lensFlare},
  anamorphicFlare:{...DEFAULT_CAMERA_EFFECTS.anamorphicFlare,...effects?.anamorphicFlare,enabled:spec.anamorphicFlare},
  filmGrain:{...DEFAULT_CAMERA_EFFECTS.filmGrain,...effects?.filmGrain,enabled:spec.filmGrain},
  vignetting:{...DEFAULT_CAMERA_EFFECTS.vignetting,...effects?.vignetting,enabled:spec.vignetting}
 };
 return spec.grading?{lens:nextLens,effects:nextEffects,grading:spec.grading}:{lens:nextLens,effects:nextEffects};
}
// One scene patch for the whole preset, so it applies and undoes as one step.
export const lensPresetOperations=(entityId:Id,result:LensPresetResult):PatchOp[]=>[
 {kind:'setCameraLens',entityId,lens:result.lens},
 ...(result.effects?[{kind:'setCameraEffects' as const,entityId,effects:result.effects}]:[]),
 ...(result.grading?[{kind:'setCameraGrading' as const,entityId,grading:result.grading}]:[])
];
