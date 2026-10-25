import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,expect,it} from 'vitest';
import {Quaternion,Texture,Vector3} from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {VRMLoaderPlugin,VRMUtils,type VRM,type VRMHumanBoneName} from '@pixiv/three-vrm';
import {HUMANOID_BONES,type AvatarPose,type AvatarRig,type Quat,type Vec3} from '@opensekai/contracts';
import {createAvatarBinding} from '../src/avatar-pose';
import {vmcSendPose} from '../../session/src/vmc-send';

// Real file boundary: the downloaded fixture VRM files, parsed by the production loader plugin and posed by the production
// binding. The VMC sender repeats the binding composition in data (B21 R7, Operation 10); this checks that each raw bone
// of the rig gets the same local rotation and position from both.
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
 loader.register(()=>({name:'test_no_images',loadTexture:()=>Promise.resolve(new Texture())}) as never);
 loader.register(parser=>new VRMLoaderPlugin(parser));
 const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'');
 const vrm=gltf.userData.vrm as VRM;
 // As the renderer asset loader does.
 VRMUtils.rotateVRM0(vrm);
 return vrm;
};
// The rig as the host reader makes it from the same file: the rest translation of each humanoid node.
const rigOf=(vrm:VRM):AvatarRig=>{
 const restPositions:Record<string,Vec3>={};let identityRest=true;
 for(const name of HUMANOID_BONES){
  const node=vrm.humanoid.getRawBoneNode(name as VRMHumanBoneName);
  if(!node)continue;
  restPositions[name]=node.position.toArray() as Vec3;
  identityRest&&=node.quaternion.angleTo(new Quaternion())<1e-5;
 }
 return {metaVersion:vrm.meta.metaVersion==='0'?'0':'1',restPositions,identityRest};
};
const q=(axis:[number,number,number],degrees:number):Quat=>new Quaternion().setFromAxisAngle(new Vector3(...axis).normalize(),degrees*Math.PI/180).toArray() as Quat;
const cases:Record<string,Omit<AvatarPose,'avatarId'>>={
 'base only':{baseBones:{hips:{rotation:q([0,1,0],10),space:'normalized',position:[0.05,-0.02,0.1]},spine:{rotation:q([1,0,0],8),space:'normalized'},chest:{rotation:q([0,0,1],-6),space:'normalized'},leftUpperArm:{rotation:q([0,0,1],60),space:'normalized'},head:{rotation:q([0,1,0],-15),space:'normalized'}},bones:{},expressions:{}},
 'base with normalized tracking':{baseBones:{head:{rotation:q([0,1,0],10),space:'normalized'},neck:{rotation:q([1,0,0],5),space:'normalized'}},bones:{head:{rotation:q([1,1,0],30),space:'normalized'},leftLowerArm:{rotation:q([0,1,0],-40),space:'normalized'},hips:{rotation:q([0,1,0],20),space:'normalized',position:[0.1,0,-0.05]}},expressions:{}},
 'partial weights':{baseBones:{head:{rotation:q([0,1,0],10),space:'normalized'},rightUpperArm:{rotation:q([0,0,1],-50),space:'normalized'}},bones:{head:{rotation:q([1,0,0],40),space:'normalized',weight:0.35},rightUpperArm:{rotation:q([1,0,0],20),space:'normalized',weight:0.6},hips:{rotation:q([0,1,0],30),space:'normalized',position:[0.2,0.1,0],weight:0.5}},expressions:{}},
 'raw tracking without base':{bones:{head:{rotation:q([0,1,0],25),space:'raw'},hips:{rotation:q([0,1,0],-20),space:'raw',position:[0.1,0.95,0.05]},leftHand:{rotation:q([1,0,0],30),space:'raw',weight:0.5}},expressions:{}},
 'raw tracking with base':{baseBones:{head:{rotation:q([1,0,0],10),space:'normalized'},hips:{rotation:q([0,1,0],5),space:'normalized',position:[0,0.02,0]}},bones:{head:{rotation:q([0,1,0],25),space:'raw',weight:0.4},hips:{rotation:q([0,1,0],-20),space:'raw',position:[0.1,0.95,0.05],weight:0.5},spine:{rotation:q([0,0,1],12),space:'normalized'}},expressions:{}},
 'offsets on normalized and raw bones':{baseBones:{spine:{rotation:q([1,0,0],5),space:'normalized'},head:{rotation:q([0,1,0],10),space:'normalized'}},bones:{leftUpperArm:{rotation:q([0,0,1],45),space:'raw'},head:{rotation:q([1,0,0],15),space:'normalized'}},boneOffsets:{spine:q([0,1,0],12),chest:q([1,0,0],-7),head:q([0,0,1],9),leftUpperArm:q([0,1,0],20)},expressions:{}},
};
describe('VMC send pose and renderer pose',()=>{
 for(const id of ['fixture_vrm0_arkit','fixture_vrm_1']){
  const path=fixturePath(id);
  // The fixture VRM 1 sample has rest rotations: the sender refuses it (R17), so no pose comparison runs for it.
  const refused=id==='fixture_vrm_1';
  it.skipIf(!path)(refused?`refuses ${id}, a rig with rest rotations`:`give the same raw bones for ${id}`,async()=>{
   const vrm=await loadVrm(path!);
   const rig=rigOf(vrm);
   expect(rig.identityRest).toBe(!refused);
   if(refused)return;
   const binding=createAvatarBinding(vrm);
   let checked=0;
   for(const [name,partial] of Object.entries(cases)){
    const pose={avatarId:'a',...partial} as AvatarPose;
    binding.apply(pose);
    const sent=vmcSendPose(pose,rig);
    for(const [bone,value] of Object.entries(sent.bones)){
     const node=vrm.humanoid.getRawBoneNode(bone as VRMHumanBoneName)!;
     const angle=node.quaternion.angleTo(new Quaternion(...value.rotation));
     expect(angle,`${name} ${bone} rotation`).toBeLessThan(1e-4);
     const distance=node.position.distanceTo(new Vector3(...value.position));
     expect(distance,`${name} ${bone} position`).toBeLessThan(1e-6);
     checked++;
    }
   }
   expect(checked).toBeGreaterThan(Object.keys(cases).length*50);
  },60000);
 }
});
