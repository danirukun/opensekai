import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {ShowDocumentSchema} from '../packages/contracts/src/schema';
import {assetTypes,readScene} from './warudo-sceneshare';
// Maps a Warudo scene to an OpenSekai show for the visual benchmark (#240). Research only: it is not an import path.
type Vec3=[number,number,number];type Quat=[number,number,number,number];
type Port={value?:unknown;defaultValue?:unknown};
type SceneAsset={id:string;typeId:string;name:string;active:boolean;dataInputs:Record<string,Port>};
export type WarudoScene={name:string;assets:SceneAsset[];plugins:Record<string,{data?:string}>};
// Warudo Source URI (for example `environment://data/Environments/Stage.warudo`) to an OpenSekai asset ID.
export type Bindings=Record<string,string>;
export type Skipped={name:string;type:string;reason:string};
const rad=Math.PI/180;
const mul=([ax,ay,az,aw]:Quat,[bx,by,bz,bw]:Quat):Quat=>[aw*bx+ax*bw+ay*bz-az*by,aw*by-ax*bz+ay*bw+az*bx,aw*bz+ax*by-ay*bx+az*bw,aw*bw-ax*bx-ay*by-az*bz];
const axis=(i:0|1|2,deg:number):Quat=>{const q:Quat=[0,0,0,Math.cos(deg*rad/2)];q[i]=Math.sin(deg*rad/2);return q;};
// Unity applies Euler angles Z, then X, then Y.
export const unityEuler=({x,y,z}:{x:number;y:number;z:number}):Quat=>mul(mul(axis(1,y),axis(0,x)),axis(2,z));
// Unity is left-handed; glTF and three.js are right-handed. A mirror on X maps one to the other.
export const mirrorPosition=({x,y,z}:{x:number;y:number;z:number}):Vec3=>[-x,y,z];
export const mirrorRotation=([x,y,z,w]:Quat):Quat=>[x,-y,-z,w];
// A Unity camera or light looks along local +Z; an OpenSekai camera or light looks along local -Z.
const faceMinusZ=(q:Quat)=>mul(q,axis(1,180));
const normalize=(q:Quat):Quat=>{const n=Math.hypot(...q);return q.map(v=>Math.round(v/n*1e6)/1e6) as Quat;};
const read=(p:Port|undefined)=>{const v=p?.value??p?.defaultValue;if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
const port=<T>(a:SceneAsset,key:string)=>read(a.dataInputs[key]) as T;
const label=(a:SceneAsset,key:string)=>port<{label?:string}|undefined>(a,key)?.label;
const hex=({r,g,b}:{r:number;g:number;b:number})=>'#'+[r,g,b].map(c=>Math.round(Math.min(1,Math.max(0,c))*255).toString(16).padStart(2,'0')).join('');
type XYZ={x:number;y:number;z:number};
export function transformOf(a:SceneAsset,facing=false){
 const t=port<{dataInputs?:Record<string,Port>}|undefined>(a,'Transform')?.dataInputs??{};
 const position=(read(t.Position) as XYZ|undefined)??{x:0,y:0,z:0},rotation=(read(t.Rotation) as XYZ|undefined)??{x:0,y:0,z:0},scale=(read(t.Scale) as XYZ|undefined)??{x:1,y:1,z:1};
 const q=mirrorRotation(unityEuler(rotation));
 return {position:mirrorPosition(position),rotation:normalize(facing?faceMinusZ(q):q),scale:[scale.x,scale.y,scale.z] as Vec3};
}
type Mapped={entity?:Record<string,unknown>;reason?:string};
type Context={bindings:Bindings;characters:Set<string>};
const bound=(a:SceneAsset,c:Context):Mapped&{assetId?:string}=>{const source=port<string|undefined>(a,'Source');const assetId=source&&c.bindings[source];return assetId?{assetId}:{reason:`no OpenSekai asset is bound to ${source??'an empty source'}`};};
const sensitivity=(a:SceneAsset)=>Math.min(10,Math.max(0.1,port<number>(a,'ControlSensitivity')??1));
// Warudo types that OpenSekai plans but does not support yet, with the tracking issue.
const planned:Record<string,string>={Prop:'prop import is planned (ENV-03, #41)'};
// One entry per Warudo asset type that has an OpenSekai counterpart. A type without an entry is reported as skipped.
const mappers:Record<string,(a:SceneAsset,c:Context)=>Mapped>={
 Character:(a,c)=>{const b=bound(a,c);return b.assetId?{entity:{kind:'avatar',assetId:b.assetId,...transformOf(a)}}:b;},
 Environment:(a,c)=>{const b=bound(a,c);if(!b.assetId)return b;
  const reflections=port<boolean>(a,'EnvironmentReflectionsIntensityOverride')?{reflectionsIntensity:Math.min(2,port<number>(a,'EnvironmentReflectionsIntensity'))}:{};
  return {entity:{kind:'environment',assetId:b.assetId,...reflections,...transformOf(a)}};},
 Camera:(a,c)=>{const mode=label(a,'ControlMode'),target=port<{id?:string}|null>(a,'FocusCharacter')?.id;
  const navigation=mode==='Free Look'?{mode:'freeLook',sensitivity:sensitivity(a)}:mode==='Orbit Character'?{mode:'orbitCharacter',sensitivity:sensitivity(a),targetId:target&&c.characters.has(target)?target:null,pivotOffset:[0,0,0]}:{mode:'none'};
  return {entity:{kind:'camera',lens:{fovDegrees:port<number>(a,'FieldOfView'),near:port<number>(a,'NearClipPlane'),far:port<number>(a,'FarClipPlane')},navigation,...transformOf(a,true)}};},
 // Unity's diffuse term has no 1/π; three.js divides by π. So Warudo intensity 1 is three.js intensity π.
 'Directional Light':a=>({entity:{kind:'light',light:{type:'directional',color:hex(port(a,'Color')),intensity:Math.PI*port<number>(a,'Intensity'),range:0,affectCharacters:true,affectProps:true,affectEnvironment:true,
  shadow:{enabled:port<boolean>(a,'ShadowEnabled'),intensity:port<number>(a,'ShadowIntensity'),soft:port<boolean>(a,'SoftShadows'),bias:-0.0005,normalBias:0.02}},...transformOf(a,true)}}),
};
// Warudo hides an asset with scale 0; an OpenSekai transform needs a positive scale.
const hiddenByScale=(a:SceneAsset)=>transformOf(a).scale.some(s=>s<=0);
export function toShow(scene:WarudoScene,bindings:Bindings){
 const typeOf=(a:SceneAsset)=>assetTypes[a.typeId]??a.typeId;
 // Orbit cameras can target only a character that becomes an OpenSekai avatar.
 const characters=new Set(scene.assets.filter(a=>typeOf(a)==='Character'&&!hiddenByScale(a)&&bound(a,{bindings,characters:new Set()}).assetId).map(a=>a.id));
 const skipped:Skipped[]=[],entities:Record<string,unknown>[]=[];
 for(const a of scene.assets){
  const type=typeOf(a),map=mappers[type];
  const result:Mapped=!map?{reason:planned[type]??'no OpenSekai mapping for this type'}:hiddenByScale(a)?{reason:'scale 0 hides it in Warudo'}:map(a,{bindings,characters});
  if(!result.entity){skipped.push({name:a.name,type,reason:result.reason!});continue;}
  const {kind,position,rotation,scale,...rest}=result.entity;
  entities.push({id:a.id,name:a.name,visible:a.active&&port<boolean|undefined>(a,'Enabled')!==false,transform:{position,rotation,scale},kind,...rest});
 }
 const cameras=entities.filter(e=>e.kind==='camera').map(e=>e.id as string);
 const core=scene.plugins['Warudo.Core']?.data,main=core?(JSON.parse(core) as {mainCamera?:string}).mainCamera:undefined;
 const cameraId=main&&cameras.includes(main)?main:cameras[0];
 if(!cameraId)throw new Error('The scene has no camera');
 const outputs=['output_main','preview_main'].map(id=>({id,cameraId,width:1920,height:1080,fps:60}));
 return {show:{schemaVersion:1,name:scene.name,scene:{schemaVersion:1,sceneId:'scene_warudo',revision:0,entities,outputs},blueprints:[]},skipped};
}
async function main([file,bindings,out]:string[]){
 if(!file||!bindings||!out)throw new Error('Usage: warudo-show <file.sceneshare> <bindings.json> <out.osekai>');
 const {show,skipped}=toShow(await readScene(file),JSON.parse(await readFile(bindings,'utf8')));
 await writeFile(out,JSON.stringify(ShowDocumentSchema.parse(show),null,1)+'\n');
 console.log(JSON.stringify({entities:show.scene.entities.length,skipped},null,1));
}
if(process.argv[1]===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:e);process.exit(1);});
