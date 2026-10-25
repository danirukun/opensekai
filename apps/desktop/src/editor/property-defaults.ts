import {DEFAULT_TRACKING_MAPPING,DEFAULT_TRACKING_SMOOTHING,defaultTrackingConfig,type LightSettings,type SceneEntity} from '@opensekai/contracts';
import {makeAuthoringEntity} from './authoring';
import {VMC_SENDER} from './vmc-sender';
import {AMBIENT_LIGHT,DIRECTIONAL_LIGHT,FPS_COUNTER,HAZE,POINT_LIGHT,SPOT_LIGHT,hazeTransform} from './lights';
// The reset defaults of the Inspector fields (B17 R1–R4). Each value comes from the add defaults, so a reset and an add cannot differ.
export type EntityDefaults=Readonly<Record<string,unknown>>;
const LIGHTS:Record<LightSettings['type'],LightSettings>={directional:DIRECTIONAL_LIGHT,point:POINT_LIGHT,spot:SPOT_LIGHT,ambient:AMBIENT_LIGHT};
const camera=()=>{const added=makeAuthoringEntity('camera','camera_default',[]);if(added.kind!=='camera')throw new Error('camera default');return added;};
const transform=(entity:SceneEntity)=>({position:[0,0,0],rotation:[0,0,0,1],scale:entity.kind==='haze'?hazeTransform().scale:[1,1,1]});
function lightValues(light:LightSettings):Record<string,unknown> {
 return {color:light.color,intensity:light.intensity,range:light.range,angleDegrees:light.cone?.angleDegrees??40,penumbra:light.cone?.penumbra??0,volumetric:light.volumetric===true,affectCharacters:light.affectCharacters,affectProps:light.affectProps,affectEnvironment:light.affectEnvironment,shadow:light.shadow.enabled,shadowIntensity:light.shadow.intensity,soft:light.shadow.soft,bias:light.shadow.bias,normalBias:light.shadow.normalBias};
}
const smoothingValues=(smoothing=DEFAULT_TRACKING_SMOOTHING)=>({smoothing:smoothing.enabled,minCutoff:smoothing.minCutoff,beta:smoothing.beta,derivativeCutoff:smoothing.derivativeCutoff});
const mappingValues=(mapping=DEFAULT_TRACKING_MAPPING)=>({headIntensity:mapping.headIntensity,headOffsetX:mapping.headOffset[0],headOffsetY:mapping.headOffset[1],headOffsetZ:mapping.headOffset[2],eyeIntensity:mapping.eyeIntensity,blendShapeSensitivity:mapping.blendShapeSensitivity,linkedBlink:mapping.linkedBlink});
function configValues(config:Extract<SceneEntity,{kind:'tracking'}>['config']):Record<string,unknown> {
 if(config.kind==='mediapipe')return {face:config.face,upperBody:config.upperBody,hands:config.hands,mirror:config.mirror};
 return {bindAddress:config.bindAddress,port:config.port,address:config.kind==='ifacialmocap'?config.phoneAddress:config.senderAddress};
}
// The current value of each field as the Inspector shows it: a missing optional field takes its fallback (R2).
export function valuesFor(entity:SceneEntity):Record<string,unknown> {
 const base=entity.kind==='tracking'||entity.kind==='vmcSender'?{}:{visible:entity.visible,...entity.transform};
 if(entity.kind==='camera')return {...base,renderEnvironment:entity.renderEnvironment!==false,antiAliasing:entity.antiAliasing??'none',fovDegrees:entity.lens.fovDegrees,near:entity.lens.near,far:entity.lens.far,controlMode:entity.navigation?.mode??'none',sensitivity:entity.navigation&&entity.navigation.mode!=='none'?entity.navigation.sensitivity:undefined};
 if(entity.kind==='light')return {...base,...lightValues(entity.light)};
 if(entity.kind==='haze')return {...base,...entity.haze};
 if(entity.kind==='fpsCounter')return {...base,...entity.fpsCounter};
 if(entity.kind==='vmcSender')return {address:entity.vmcSender.address,port:entity.vmcSender.port};
 if(entity.kind==='environment')return {...base,reflectionsIntensity:entity.reflectionsIntensity??1};
 if(entity.kind==='avatar')return {...base,idleAnimation:entity.idleAnimation?.enabled??false};
 if(entity.kind==='tracking')return {...configValues(entity.config),...smoothingValues(entity.smoothing),...mappingValues(entity.mapping)};
 return base;
}
export function defaultsFor(entity:SceneEntity):EntityDefaults {
 const base=entity.kind==='tracking'||entity.kind==='vmcSender'?{}:{visible:true,...transform(entity)};
 if(entity.kind==='camera'){const added=camera();return {...base,renderEnvironment:true,antiAliasing:'none',...added.lens,controlMode:added.navigation?.mode,sensitivity:added.navigation&&added.navigation.mode!=='none'?added.navigation.sensitivity:undefined};}
 if(entity.kind==='light')return {...base,...lightValues(LIGHTS[entity.light.type])};
 if(entity.kind==='haze')return {...base,...HAZE};
 if(entity.kind==='fpsCounter')return {...base,...FPS_COUNTER};
 if(entity.kind==='vmcSender')return {...VMC_SENDER};
 if(entity.kind==='environment')return {...base,reflectionsIntensity:1};
 if(entity.kind==='avatar'){const added=makeAuthoringEntity('character','avatar_default',[]);return {...base,idleAnimation:added.kind==='avatar'&&added.idleAnimation?.enabled};}
 if(entity.kind==='tracking')return {...configValues(defaultTrackingConfig(entity.config.kind)),...smoothingValues(),...mappingValues()};
 return base;
}
// The reset fields that the Inspector shows for this entity and its light type (R3). The fields of R4 never appear.
export function resetFieldIds(entity:SceneEntity):string[] {
 const base=entity.kind==='tracking'?[]:['visible','position','rotation','scale'];
 if(entity.kind==='camera')return [...base,'renderEnvironment','antiAliasing','fovDegrees','near','far','controlMode',...(entity.navigation&&entity.navigation.mode!=='none'?['sensitivity']:[])];
 if(entity.kind==='light'){
  const {type,shadow}=entity.light,placed=type==='point'||type==='spot';
  return [...base,'color','intensity',...(placed?['range']:[]),...(type==='spot'?['angleDegrees','penumbra']:[]),...(placed?['volumetric']:[]),'affectCharacters','affectProps','affectEnvironment',...(type!=='ambient'?['shadow']:[]),...(type!=='ambient'&&shadow.enabled?['shadowIntensity','soft','bias','normalBias']:[])];
 }
 if(entity.kind==='haze')return [...base,'density','smoke','intensity','drift'];
 // An FPS counter has no Transform section (B19 R5).
 if(entity.kind==='fpsCounter')return ['visible','corner','size','color'];
 // A sender has no Transform or Visible field. Its character default depends on the scene, so it has no reset (B21 R5).
 if(entity.kind==='vmcSender')return ['address','port'];
 if(entity.kind==='environment')return [...base,'reflectionsIntensity'];
 if(entity.kind==='avatar')return [...base,'idleAnimation'];
 if(entity.kind==='tracking')return [...(entity.config.kind==='mediapipe'?['face','upperBody','hands','mirror']:['bindAddress','port','address']),'smoothing','minCutoff','beta','derivativeCutoff','headIntensity','headOffsetX','headOffsetY','headOffsetZ','eyeIntensity','blendShapeSensitivity','linkedBlink'];
 return base;
}
const COLOR=/^#[0-9a-f]{6}$/i;
// Numbers match within floating point noise, colors without case, and vectors by component (R2).
export function sameValue(a:unknown,b:unknown):boolean {
 if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(b));
 if(typeof a==='string'&&typeof b==='string'&&COLOR.test(a)&&COLOR.test(b))return a.toLowerCase()===b.toLowerCase();
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>sameValue(value,b[index]));
 return a===b;
}
// The reset fields whose value differs from the default.
export function changedFields(entity:SceneEntity):Set<string> {
 const values=valuesFor(entity),defaults=defaultsFor(entity);
 return new Set(resetFieldIds(entity).filter(id=>!sameValue(values[id],defaults[id])));
}
// What a field group needs to show its reset marks: the changed fields, their defaults, and whether the marks are disabled (R5–R7).
export interface ResetMarks {changed:ReadonlySet<string>;defaults:EntityDefaults;disabled:boolean}
export const NO_MARKS:ResetMarks={changed:new Set(),defaults:{},disabled:true};
export function resetMarks(entity:SceneEntity,disabled:boolean):ResetMarks {return {changed:changedFields(entity),defaults:defaultsFor(entity),disabled};}
