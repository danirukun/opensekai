import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {Color,Texture,type Material,type Mesh} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MToonMaterialLoaderPlugin,VRMLoaderPlugin} from '@pixiv/three-vrm';
import {MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {materialEntries,materialParameter,type AssetMaterial,type MaterialParameter} from '@opensekai/contracts';
import {inspectContainer} from '../src/assets';

// Real file and library boundary (B38 R15): the downloaded fixture files (fixtures/local), parsed by the loader plugins of
// `createAssetLoader`. The list that the importer computes from the JSON chunk must equal what three.js and three-vrm build.
const manifestPath=fileURLToPath(new URL('../../../fixtures/local/manifest.json',import.meta.url));
const fixturePath=(id:string):string|undefined=>{
 if(!existsSync(manifestPath))return undefined;
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {assets:{path:string;record:{id:string}}[]};
 const path=manifest.assets.find(asset=>asset.record.id===id)?.path;
 return path && existsSync(path) ? path : undefined;
};
type Loaded=Material&Record<string,unknown>&{color?:Color;isOutline?:boolean};
const load=async(path:string)=>{
 const file=readFileSync(path);
 const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer;
 const loader=new GLTFLoader();
 // Node has no image decoder; no checked value reads a texture.
 loader.register(()=>({name:'test_no_images',loadTexture:()=>Promise.resolve(new Texture())}) as never);
 loader.register(parser=>new VRMLoaderPlugin(parser,{mtoonMaterialPlugin:new MToonMaterialLoaderPlugin(parser,{materialType:MToonNodeMaterial})}));
 const gltf=await loader.parseAsync(bytes,'');
 // Each surface material by its glTF index, and whether a mesh of that material has an outline material.
 const surfaces=new Map<number,{material:Loaded;outline:boolean}[]>();
 gltf.scene.traverse(object=>{
  const mesh=object as Mesh;
  if(!mesh.isMesh)return;
  const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as Loaded[];
  const outline=materials.some(material=>material.isOutline===true);
  for(const material of materials){
   const index=gltf.parser.associations.get(material)?.materials;
   if(index===undefined||material.isOutline)continue;
   surfaces.set(index,[...surfaces.get(index)??[],{material,outline}]);
  }
 });
 return {entries:materialEntries(inspectContainer(bytes).json),surfaces};
};
const hexDistance=(a:string,b:string)=>Math.max(...[0,2,4].map(i=>Math.abs(parseInt(a.slice(1+i,3+i),16)-parseInt(b.slice(1+i,3+i),16))));
const loadedValue=(material:Loaded,key:MaterialParameter):string|number=>{
 const value=material[materialParameter(key).field];
 return value instanceof Color ? `#${value.getHexString()}` : value as number;
};
// The differences between the importer and the loaded materials; an empty list is a match.
const differences=(entry:AssetMaterial,surface:{material:Loaded;outline:boolean})=>{
 const {material}=surface;
 const found:string[]=[];
 if(entry.outline!==surface.outline)found.push(`outline ${entry.outline} != ${surface.outline}`);
 if(entry.blend!==material.transparent)found.push(`blend ${entry.blend} != ${material.transparent}`);
 const kind=material.isMeshStandardMaterial?'pbr':material.isMeshBasicMaterial?'unlit':'shadeColorFactor' in material?'mtoon':'other';
 // three-vrm v0compat loads a VRM 0.x Unlit material as MToon.
 if(kind!==entry.profile&&!(entry.profile==='unlit'&&kind==='mtoon'))found.push(`profile ${entry.profile} != ${kind}`);
 for(const [key,model] of Object.entries(entry.model) as [MaterialParameter,string|number][]){
  const loaded=loadedValue(material,key);
  const ok=typeof model==='string' ? typeof loaded==='string'&&hexDistance(model,loaded)<=1 : Math.abs(model-(loaded as number))<=1e-6;
  if(!ok)found.push(`${key} ${model} != ${loaded}`);
 }
 return found;
};

describe('material model values',()=>{
 for(const id of ['fixture_vrm_1','fixture_vrm0_arkit','fixture_glb_stage']){
  const path=fixturePath(id);
  it.skipIf(!path)(`match the loaded materials of ${id}`,async()=>{
   const {entries,surfaces}=await load(path!);
   expect(entries.length).toBeGreaterThan(0);
   let checked=0;
   const mismatches:string[]=[];
   for(const entry of entries){
    for(const surface of surfaces.get(entry.index)??[]){
     checked++;
     for(const difference of differences(entry,surface))mismatches.push(`${entry.index} ${entry.name}: ${difference}`);
    }
   }
   console.log(`${id}: ${entries.length} materials, ${checked} loaded surfaces checked, ${entries.filter(e=>e.outline).length} with outline`);
   expect(mismatches).toEqual([]);
   expect(checked).toBeGreaterThan(0);
  },60000);
 }
});
