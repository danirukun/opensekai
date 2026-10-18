import {LIMITS,LightColorSchema,type LightSettings,type Quat,type SceneEntity,type SceneView,type Transform} from '@opensekai/contracts';
// −Z along the normalized −[2, 4, 3], no roll: the direction of the built-in light (R10).
export const BUILTIN_LIGHT_ROTATION:Quat=[-0.389047,0.264763,0.117794,0.874453];
const shadow:LightSettings['shadow']={enabled:false,intensity:1,soft:true,bias:-0.0005,normalBias:0.02};
const common={color:'#ffffff',affectCharacters:true,affectProps:true,affectEnvironment:true,shadow};
export const DIRECTIONAL_LIGHT:LightSettings={type:'directional',intensity:3,range:0,...common};
// 20 at 2 m with decay 2 gives 5, near the ambient level.
export const POINT_LIGHT:LightSettings={type:'point',intensity:20,range:10,...common};
export function lightTransform(type:LightSettings['type']):Transform {
 return type==='directional'?{position:[2,4,3],rotation:[...BUILTIN_LIGHT_ROTATION],scale:[1,1,1]}:{position:[0,2,1],rotation:[0,0,0,1],scale:[1,1,1]};
}
export const lightLimitReached=(entities:readonly SceneEntity[]):boolean=>entities.filter(entity=>entity.kind==='light').length>=LIMITS.lights;
export const lightTypeOptions=[{value:'directional',label:'Directional'},{value:'point',label:'Point'}];
// A type change keeps the color, the affect flags, and the shadow; intensity and range take the type default.
export function lightForType(type:LightSettings['type'],current:LightSettings):LightSettings {
 if(type===current.type)return current;
 const base=type==='point'?POINT_LIGHT:DIRECTIONAL_LIGHT;
 return {...current,type,intensity:base.intensity,range:base.range};
}
export function parseLightColor(input:string):string|null {
 const value=input.trim().toLowerCase();
 return LightColorSchema.safeParse(value).success?value:null;
}
// A number field can hand over a number or a string.
export function parseBounded(input:string|number,min:number,max:number):number|null {
 const text=String(input).trim(),value=Number(text);
 return text!==''&&Number.isFinite(value)&&value>=min&&value<=max?value:null;
}
// Set Direction From Main Camera: the light keeps its position and takes the rotation of the output_main camera (R13).
export function directionFromMainCamera(scene:SceneView,lightId:string):Transform|null {
 const light=scene.entities.find(entity=>entity.id===lightId&&entity.kind==='light');
 const cameraId=scene.outputs.find(output=>output.id==='output_main')?.cameraId;
 const camera=scene.entities.find(entity=>entity.id===cameraId&&entity.kind==='camera');
 if(!light||!camera)return null;
 // Plain copies: the scene can be a Svelte state proxy, which structuredClone rejects.
 return {position:[...light.transform.position],rotation:[...camera.transform.rotation],scale:[...light.transform.scale]};
}
