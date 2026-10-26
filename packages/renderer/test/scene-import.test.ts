import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {Mesh,Texture} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {inspectContainer} from '../src/assets';

// File boundary: import_integration.rs writes this GLB from the bytes that GET /assets/{id} serves after a multi-file scene import.
const bytes=readFileSync(fileURLToPath(new URL('../../../fixtures/scene-import/packed-room.glb',import.meta.url)));
const buffer=()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
it('accepts a packed scene import as a self-contained GLB',()=>{
 expect(inspectContainer(buffer())).toEqual({extensions:[],imageCount:1});
});
it('parses the packed scene with its embedded image',async()=>{
 const loader=new GLTFLoader();
 // Node has no image decoder.
 loader.register(()=>({name:'test_no_images',loadTexture:()=>Promise.resolve(new Texture())}) as never);
 const gltf=await loader.parseAsync(buffer(),'');
 const meshes:Mesh[]=[];
 gltf.scene.traverse(object=>{if(object instanceof Mesh)meshes.push(object);});
 expect(meshes).toHaveLength(1);
 expect(gltf.parser.json.images[0]).toMatchObject({mimeType:'image/png'});
 expect(gltf.parser.json.images[0].uri).toBeUndefined();
});
