import {LIMITS,LightColorSchema,type HazeSettings,type LightSettings,type Quat,type SceneEntity,type SceneView,type Transform} from '@opensekai/contracts';
// −Z along the normalized −[2, 4, 3], no roll: the direction of the built-in light (R10).
export const BUILTIN_LIGHT_ROTATION:Quat=[-0.389047,0.264763,0.117794,0.874453];
const shadow:LightSettings['shadow']={enabled:false,intensity:1,soft:true,bias:-0.0005,normalBias:0.02};
const common={color:'#ffffff',affectCharacters:true,affectProps:true,affectEnvironment:true,shadow};
export const DIRECTIONAL_LIGHT:LightSettings={type:'directional',intensity:3,range:0,...common};
// 20 at 2 m with decay 2 gives 5, near the ambient level.
export const POINT_LIGHT:LightSettings={type:'point',intensity:20,range:10,...common};
// A spot light and an ambient fill for a stage (B13 R11).
export const SPOT_LIGHT:LightSettings={type:'spot',intensity:60,range:15,...common,cone:{angleDegrees:40,penumbra:0.3},volumetric:true};
export const AMBIENT_LIGHT:LightSettings={type:'ambient',intensity:0.3,range:0,...common};
// −Z from (0, 3, 2) toward (0, 1, 0): 45° down, no roll.
export const SPOT_LIGHT_ROTATION:Quat=[-0.382683,0,0,0.92388];
const LIGHT_DEFAULTS:Record<LightSettings['type'],LightSettings>={directional:DIRECTIONAL_LIGHT,point:POINT_LIGHT,spot:SPOT_LIGHT,ambient:AMBIENT_LIGHT};
export function lightTransform(type:LightSettings['type']):Transform {
 if(type==='directional')return {position:[2,4,3],rotation:[...BUILTIN_LIGHT_ROTATION],scale:[1,1,1]};
 if(type==='spot')return {position:[0,3,2],rotation:[...SPOT_LIGHT_ROTATION],scale:[1,1,1]};
 return {position:type==='ambient'?[0,2.5,0]:[0,2,1],rotation:[0,0,0,1],scale:[1,1,1]};
}
// Intensity 2.5: at 1 a beam over a dark OBS background was faint in the owner's macOS check (B13 R11).
export const HAZE:HazeSettings={density:1,smoke:1,intensity:2.5,drift:0.2};
export const hazeTransform=():Transform=>({position:[0,4,0],rotation:[0,0,0,1],scale:[20,8,20]});
export const hazeLimitReached=(entities:readonly SceneEntity[]):boolean=>entities.filter(entity=>entity.kind==='haze').length>=LIMITS.hazes;
export const lightLimitReached=(entities:readonly SceneEntity[]):boolean=>entities.filter(entity=>entity.kind==='light').length>=LIMITS.lights;
export const lightTypeOptions=[{value:'directional',label:'Directional'},{value:'point',label:'Point'},{value:'spot',label:'Spot'},{value:'ambient',label:'Ambient'}];
export const isLightType=(value:string):value is LightSettings['type']=>value in LIGHT_DEFAULTS;
// A type change keeps the color, the affect flags, and the shadow (off for ambient); intensity, range, and cone take the type default (B13 R12).
export function lightForType(type:LightSettings['type'],current:LightSettings):LightSettings {
 if(type===current.type)return current;
 const base=LIGHT_DEFAULTS[type];
 const {cone,volumetric,...rest}=current;
 const next:LightSettings={...rest,type,intensity:base.intensity,range:base.range,shadow:type==='ambient'?{...current.shadow,enabled:false}:current.shadow};
 if(type==='spot')next.cone=cone??base.cone;
 const scatter=volumetric??base.volumetric;
 if((type==='spot'||type==='point')&&scatter!==undefined)next.volumetric=scatter;
 return next;
}
export function parseLightColor(input:string):string|null {
 const value=input.trim().toLowerCase();
 return LightColorSchema.safeParse(value).success?value:null;
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
