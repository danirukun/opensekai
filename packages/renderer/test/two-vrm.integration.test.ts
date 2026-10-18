import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {Mesh,Quaternion,Texture,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,type VRM} from '@pixiv/three-vrm';
import type {AvatarPose} from '@opensekai/contracts';
import {createAvatarBinding} from '../src/avatar-pose';

// Real process boundary: the downloaded fixture files (fixtures/local), parsed by the production loader plugin.
const manifestPath=fileURLToPath(new URL('../../../fixtures/local/manifest.json',import.meta.url));
const fixturePath=(id:string):string|undefined=>{
 if(!existsSync(manifestPath))return undefined;
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {assets:{path:string;record:{id:string}}[]};
 const path=manifest.assets.find(asset=>asset.record.id===id)?.path;
 return path && existsSync(path) ? path : undefined;
};
const loadVrm=async(path:string)=>{
 const bytes=readFileSync(path);
 const loader=new GLTFLoader();
 // Node has no image decoder; the pose path does not read textures.
 loader.register(()=>({name:'test_no_images',loadTexture:()=>Promise.resolve(new Texture())}) as never);
 loader.register(parser=>new VRMLoaderPlugin(parser));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
 return gltf.userData.vrm as VRM;
};
const yaw=(degrees:number)=>new Quaternion().setFromAxisAngle(new Vector3(0,1,0),degrees*Math.PI/180).toArray() as [number,number,number,number];
const headWorld=(vrm:VRM)=>vrm.humanoid.getRawBoneNode('head')!.getWorldQuaternion(new Quaternion());
const pose=(avatarId:string,degrees:number,expressions:Record<string,number>):AvatarPose=>({avatarId,bones:{head:{rotation:yaw(degrees),space:'normalized'}},expressions});

describe('two VRM instances',()=>{
 const vrm1=fixturePath('fixture_vrm_1');
 it.skipIf(!vrm1)('apply each pose to its own fixture_vrm_1 instance only',async()=>{
  const [a,b]=await Promise.all([loadVrm(vrm1!),loadVrm(vrm1!)]);
  const bindA=createAvatarBinding(a),bindB=createAvatarBinding(b);
  bindA.apply();bindB.apply();
  const rest=headWorld(a);
  expect(headWorld(b).angleTo(rest)).toBeLessThan(1e-3);
  bindA.apply(pose('a',30,{happy:1}));bindB.apply(pose('b',-30,{}));
  const headA=headWorld(a),headB=headWorld(b);
  expect(headA.angleTo(rest)).toBeCloseTo(30*Math.PI/180,2);
  expect(headB.angleTo(rest)).toBeCloseTo(30*Math.PI/180,2);
  expect(headA.angleTo(headB)).toBeCloseTo(60*Math.PI/180,2);
  expect(a.expressionManager!.getValue('happy')).toBe(1);
  expect(b.expressionManager!.getValue('happy')).toBe(0);
  bindA.apply(pose('a',30,{}));
  expect(a.expressionManager!.getValue('happy')).toBe(0);
  expect(headWorld(b).angleTo(headB)).toBeLessThan(1e-3);
 },60000);
 const arkit=fixturePath('fixture_vrm0_arkit');
 it.skipIf(!arkit)('apply an ARKit morph to one fixture_vrm0_arkit instance only',async()=>{
  const [a,b]=await Promise.all([loadVrm(arkit!),loadVrm(arkit!)]);
  const bindA=createAvatarBinding(a),bindB=createAvatarBinding(b);
  const influence=(vrm:VRM,name:string)=>{
   let max=0;
   vrm.scene.traverse(node=>{
    const mesh=node as Mesh;const index=mesh.morphTargetDictionary?.[name];
    if(index!==undefined)max=Math.max(max,mesh.morphTargetInfluences![index]);
   });
   return max;
  };
  const target=['jawOpen','JawOpen','jaw_open'].find(name=>{let found=false;a.scene.traverse(node=>{if((node as Mesh).morphTargetDictionary?.[name]!==undefined)found=true;});return found;});
  expect(target).toBeDefined();
  bindA.apply({avatarId:'a',bones:{},expressions:{jawOpen:.8}});bindB.apply({avatarId:'b',bones:{},expressions:{}});
  expect(influence(a,target!)).toBeCloseTo(.8,5);
  expect(influence(b,target!)).toBe(0);
 },60000);
});
