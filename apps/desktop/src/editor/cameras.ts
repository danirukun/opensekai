import {LIMITS,type CameraNavigation,type Id,type SceneEntity,type SceneView} from '@opensekai/contracts';
export type ControlMode=CameraNavigation['mode'];
export const controlModeOptions:{value:ControlMode;label:string}[]=[{value:'none',label:'None'},{value:'freeLook',label:'Free Look'},{value:'orbitCharacter',label:'Orbit Character'}];
export const DEFAULT_NAVIGATION:CameraNavigation={mode:'freeLook',sensitivity:1};
const PIVOT_OFFSET:[number,number,number]=[0,1.3,0];
// A mode change keeps the sensitivity. Orbit Character starts on the first character at chest height (R11).
export function navigationForMode(mode:ControlMode,current:CameraNavigation|undefined,entities:readonly SceneEntity[]):CameraNavigation {
 const sensitivity=current&&current.mode!=='none'?current.sensitivity:1;
 if(mode==='none')return {mode};
 if(mode==='freeLook')return {mode,sensitivity};
 if(current?.mode==='orbitCharacter')return current;
 return {mode,sensitivity,targetId:entities.find(entity=>entity.kind==='avatar')?.id??null,pivotOffset:[...PIVOT_OFFSET]};
}
export function focusOptions(entities:readonly SceneEntity[]):{value:string;label:string}[] {
 return [{value:'',label:'None'},...entities.filter(entity=>entity.kind==='avatar').map(entity=>({value:entity.id,label:entity.name}))];
}
// A number field can hand over a number or a string.
// Tab and Ctrl+Tab: the next or previous camera in scene order, with wrap, from the camera that the preview draws.
export function cycleCamera(scene:SceneView|null,direction:1|-1):Id|null {
 const cameras=scene?.entities.filter(entity=>entity.kind==='camera')??[];
 if(cameras.length<2)return null;
 const current=cameras.findIndex(camera=>camera.id===scene!.outputs.find(output=>output.id==='preview_main')?.cameraId);
 return cameras[(Math.max(0,current)+direction+cameras.length)%cameras.length]!.id;
}
export function cameraLimitReached(entities:readonly SceneEntity[]):boolean {return entities.filter(entity=>entity.kind==='camera').length>=LIMITS.cameras;}
