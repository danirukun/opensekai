import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Material,Mesh} from 'three';
import {LILTOON_GLTF_EXTENSION} from '@mochiya/three-liltoon/webgpu';
import {createAssetLoader,inspectContainer} from '../src/assets';
import {CharacterLilToonMaterial} from '../src/character-liltoon';

// Real file boundary (lilToon on WebGPU R8): the local lilToon sample (fixtures/local, never committed), through the production
// asset loader and its plugins. Node has no image decoder, so each image decodes to a 4 × 4 stand-in; no checked value reads a pixel.
const manifestPath=fileURLToPath(new URL('../../../fixtures/local/manifest.json',import.meta.url));
const fixturePath=(id:string):string|undefined=>{
 if(!existsSync(manifestPath))return undefined;
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {assets:{path:string;record:{id:string}}[]};
 const path=manifest.assets.find(asset=>asset.record.id===id)?.path;
 return path && existsSync(path) ? path : undefined;
};
// The load warnings of the sample: none at fork commit 66e7791. docs/evaluation/liltoon-webgpu.md lists the same warnings; change
// both together.
const SAMPLE_WARNINGS:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();});

describe('lilToon sample avatar',()=>{
 const sample=fixturePath('fixture_vrm_liltoon');
 it.skipIf(!sample)('loads each material with the lilToon extension as a character lilToon material',async()=>{
  // GLTFLoader reads `self.URL` for the blob URL of an embedded image.
  vi.stubGlobal('self',globalThis);
  vi.stubGlobal('createImageBitmap',async()=>({width:4,height:4,close(){}}));
  const file=readFileSync(sample!);
  const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer;
  const json=inspectContainer(bytes).json as {materials:{name:string;extensions?:Record<string,unknown>}[]};
  const lilToon=new Set(json.materials.filter(material=>material.extensions?.[LILTOON_GLTF_EXTENSION]).map(material=>material.name));
  expect(lilToon.size).toBeGreaterThan(0);
  const asset=await createAssetLoader({readAsset:async()=>bytes})('fixture_vrm_liltoon');
  const loaded:Material[]=[];
  asset.scene.traverse(object=>{const mesh=object as Mesh;if(mesh.isMesh)loaded.push(...[mesh.material].flat());});
  const surfaces=loaded.filter(material=>lilToon.has(material.name));
  expect(new Set(surfaces.map(material=>material.name))).toEqual(lilToon);
  for(const material of surfaces)expect(material).toBeInstanceOf(CharacterLilToonMaterial);
  // The outline variants of the sample draw a second, outline material.
  const outlines=loaded.filter(material=>(material as CharacterLilToonMaterial).isOutline===true);
  expect(outlines.length).toBeGreaterThan(0);
  for(const material of outlines)expect(material).toBeInstanceOf(CharacterLilToonMaterial);
  expect(asset.warnings.map(warning=>warning.message)).toEqual(SAMPLE_WARNINGS);
  expect(asset.warnings.every(warning=>warning.code==='UNSUPPORTED')).toBe(true);
  asset.dispose();
 },120000);
});
