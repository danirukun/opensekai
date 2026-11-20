import {expect,it} from 'vitest';
import {modelInfo,type AssetDebug} from '@opensekai/contracts';
import {debugCopy,formatBytes,textureRows} from '../src/editor/avatar-debug';

const info=modelInfo({
 extensionsUsed:['VRMC_vrm'],extensions:{VRMC_vrm:{specVersion:'1.0'}},
 images:[{name:'Body',mimeType:'image/png',bufferView:0}],bufferViews:[{byteLength:2048}],textures:[{source:0}],
 materials:[{name:'Body',pbrMetallicRoughness:{baseColorTexture:{index:0}},normalTexture:{index:0}}],
});
const debug:AssetDebug={info,textures:[{material:0,slot:'baseColorTexture',width:1024,height:512,colorSpace:'srgb'}],warnings:[{code:'UNSUPPORTED',message:'x',ids:['a']}]};

it('joins each file texture slot with its live texture (Debug R10)',()=>{
 expect(textureRows(info.materials[0]!,debug)).toEqual([
  {slot:'baseColorTexture',image:0,name:'Body',mimeType:'image/png',bytes:2048,width:1024,height:512,colorSpace:'srgb'},
  {slot:'normalTexture',image:0,name:'Body',mimeType:'image/png',bytes:2048,width:null,height:null,colorSpace:null},
 ]);
});
it('copies the file, the materials with their textures, and the warnings (Debug R12)',()=>{
 const copy=debugCopy(debug,{bytes:30876476,sha256:'f1'});
 expect(copy.file).toEqual({vrm:'1.0',generator:null,gltf:null,bytes:30876476,sha256:'f1'});
 expect(copy.materials[0]!.textures[0]!.width).toBe(1024);
 expect(copy.warnings).toEqual([{code:'UNSUPPORTED',message:'x'}]);
 expect(formatBytes(30876476)).toBe('29.4 MB');
});
