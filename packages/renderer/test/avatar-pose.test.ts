import {expect,it,vi} from 'vitest';
import {Object3D,Group,Quaternion,Vector3,Mesh} from 'three';
import {VRM,VRMHumanoid,VRMExpression,VRMExpressionManager,VRMExpressionMorphTargetBind,VRMUtils,type VRMHumanBones} from '@pixiv/three-vrm';
import {arkitNames,canonicalArkitName} from '../src/arkit-expressions';
import {createAvatarBinding,expressionWeights} from '../src/avatar-pose';
function fixture(restRotation = new Quaternion(), restPosition = new Vector3(0,1,0), withChest=false) {
 const scene=new Group(),hips=new Object3D(),head=new Object3D();scene.add(hips);hips.add(head);head.position.copy(restPosition);head.quaternion.copy(restRotation);
 const bones={hips:{node:hips},head:{node:head}} as VRMHumanBones;
 for(const name of ['spine','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'] as const){const node=new Object3D();hips.add(node);bones[name]={node};}
 const torso=bones.spine.node;
 if(withChest){const chest=new Object3D();torso.add(chest);bones.chest={node:chest};}
 const upperTorso=bones.chest?.node ?? torso;
 upperTorso.add(head,bones.leftUpperArm.node,bones.rightUpperArm.node);
 const humanoid=new VRMHumanoid(bones);
 const expressionManager=new VRMExpressionManager();for(const name of ['happy','aa','blinkLeft','Custom'])expressionManager.registerExpression(new VRMExpression(name));
 const vrm=new VRM({scene,humanoid,expressionManager,meta:{metaVersion:'1',name:'generated',authors:['tests'],licenseUrl:'https://example.com'}});
 return {vrm,hips,head,bones,binding:createAvatarBinding(vrm)};
}
it('applies a known normalized head delta then absolute raw overrides and resets absent channels',()=>{
 const {binding,head,hips}=fixture();const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2).toArray();
 binding.apply({avatarId:'a',bones:{head:{rotation:q,space:'normalized'},hips:{rotation:q,space:'raw',position:[1,2,3]}},expressions:{}});
 expect(head.quaternion.toArray()).toEqual(q);expect(hips.quaternion.toArray()).toEqual(q);expect(hips.position.toArray()).toEqual([1,2,3]);
 binding.apply();expect(head.quaternion.toArray()).toEqual([0,0,0,1]);expect(hips.position.toArray()).toEqual([0,0,0]);
});
it('keeps editor transform separate from runtime root and isolates two instances',()=>{
 const a=fixture(),b=fixture();a.binding.root.position.x=10;
 a.binding.apply({avatarId:'a',bones:{head:{rotation:[0,0,1,0],space:'raw'}},expressions:{Joy:.8},root:{position:[1,2,3],rotation:[0,0,0,1]}});
 expect(a.binding.root.position.x).toBe(10);expect(a.binding.root.children[0].position.toArray()).toEqual([1,2,3]);
 expect(b.head.quaternion.toArray()).toEqual([0,0,0,1]);expect(b.vrm.expressionManager!.getValue('happy')).toBe(0);
 expect(a.vrm.expressionManager!.getValue('happy')).toBe(.8);a.binding.apply();expect(a.vrm.expressionManager!.getValue('happy')).toBe(0);
});
it('maps explicit aliases, combines smile halves and preserves exact custom names',()=>{
 expect(expressionWeights({mouthSmile_L:.3,mouthSmile_R:.8,jawOpen:.4,eyeBlink_L:.6,Joy:.2,Custom:.7,missing:1},new Set(['happy','aa','blinkLeft','Custom']))).toEqual({happy:.8,aa:.4,blinkLeft:.6,Custom:.7});
 expect(expressionWeights({Joy:.2},new Set(['Joy','happy']))).toEqual({Joy:.2});
});
it('never runs spring or constraint simulation',()=>{
 const {vrm,binding}=fixture();const update=vi.spyOn(vrm,'update');binding.apply();expect(update).not.toHaveBeenCalled();
});

it('keeps prototype-shaped expression names finite and resets them when absent',()=>{
 const names=['constructor','toString','__proto__'];
 const input=Object.fromEntries(names.map(name=>[name,.6]));
 const weights=expressionWeights(input,new Set(names));
 for(const name of names) expect(weights[name]).toBe(.6);
 const {vrm,binding}=fixture();
 for(const name of names)vrm.expressionManager!.registerExpression(new VRMExpression(name));
 // Binding captures the registered expression set at creation.
 const bound=createAvatarBinding(vrm);
 const set=vi.spyOn(vrm.expressionManager!,'setValue');
 bound.apply({avatarId:'a',bones:{},expressions:input});
 for(const name of names) expect(set).toHaveBeenCalledWith(name,.6);
 set.mockClear();bound.apply();
 for(const name of names) expect(set).toHaveBeenCalledWith(name,0);
});
it('fades raw pose to each instance rest rotation and position, with normalized delta fade',()=>{
 const rest=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/3);
 const a=fixture(rest,new Vector3(1,2,3)),b=fixture(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4));
 const sample=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/2);
 a.binding.apply({avatarId:'a',bones:{head:{rotation:sample.toArray(),position:[5,6,7],space:'raw',weight:.5}},expressions:{}});
 expect(a.head.quaternion.angleTo(rest.clone().slerp(sample,.5))).toBeLessThan(1e-7);
 expect(a.head.position.toArray()).toEqual([3,4,5]);
 expect(b.head.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/4))).toBeLessThan(1e-7);
 a.binding.apply({avatarId:'a',bones:{head:{rotation:sample.toArray(),position:[5,6,7],space:'raw',weight:0}},expressions:{}});
 expect(a.head.quaternion.angleTo(rest)).toBeLessThan(1e-7);expect(a.head.position.toArray()).toEqual([1,2,3]);
 const normal=fixture();normal.binding.apply({avatarId:'n',bones:{head:{rotation:sample.toArray(),space:'normalized',weight:.5}},expressions:{}});
 expect(normal.head.quaternion.angleTo(new Quaternion().slerp(sample,.5))).toBeLessThan(1e-7);
});
it('applies official Tasks ARKit blink and smile category names through the VRM expression manager',()=>{
 const {vrm,binding}=fixture();
 vrm.expressionManager!.registerExpression(new VRMExpression('blinkRight'));
 const bound=createAvatarBinding(vrm);
 // The face retarget adapter preserves the official Tasks category names.
 bound.apply({avatarId:'a',bones:{},expressions:{eyeBlinkLeft:.7,eyeBlinkRight:.4,mouthSmileLeft:.2,mouthSmileRight:.8,jawOpen:.5}});
 expect(vrm.expressionManager!.getValue('blinkLeft')).toBe(.7);
 expect(vrm.expressionManager!.getValue('blinkRight')).toBe(.4);
 expect(vrm.expressionManager!.getValue('happy')).toBe(.8);
 expect(vrm.expressionManager!.getValue('aa')).toBe(.5);
 bound.apply();
 for(const name of ['blinkLeft','blinkRight','happy','aa'])expect(vrm.expressionManager!.getValue(name)).toBe(0);
});

it('uses spine for normalized chest on a valid chestless rig and composes explicit spine delta',()=>{
 const a=fixture(),b=fixture(),withChest=fixture(new Quaternion(),new Vector3(0,1,0),true);
 const torso=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/6);
 const inverse=torso.clone().invert().toArray();
 const pose={avatarId:'a',bones:{chest:{rotation:torso.toArray(),space:'normalized' as const},head:{rotation:inverse,space:'normalized' as const},leftUpperArm:{rotation:inverse,space:'normalized' as const}},expressions:{}};
 a.binding.apply(pose);
 expect(a.bones.spine.node.quaternion.angleTo(torso)).toBeLessThan(1e-7);
 expect(a.head.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(1e-7);
 expect(a.bones.leftUpperArm.node.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion())).toBeLessThan(1e-7);
 expect(b.bones.spine.node.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
 withChest.binding.apply(pose);
 expect(withChest.bones.spine.node.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
 expect(withChest.bones.chest!.node.quaternion.angleTo(torso)).toBeLessThan(1e-7);
 const spine=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),Math.PI/5);
 a.binding.apply({...pose,bones:{...pose.bones,spine:{rotation:spine.toArray(),space:'normalized'}}});
 expect(a.bones.spine.node.quaternion.angleTo(spine.clone().multiply(torso))).toBeLessThan(1e-7);
 a.binding.apply({avatarId:'a',bones:{chest:{rotation:torso.toArray(),space:'raw'}},expressions:{}});
 expect(a.bones.spine.node.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
});

it('seeds idle baseline and blends normalized tracking without accumulating across frames',()=>{
 const {binding,head,hips,vrm}=fixture();const baseline=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.6),sample=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.8);
 const baseBones={head:{rotation:baseline.toArray(),space:'normalized' as const},hips:{rotation:[0,0,0,1] as [number,number,number,number],position:[1,2,3] as [number,number,number],space:'normalized' as const}};
 const update=vi.spyOn(vrm.humanoid,'update');
 binding.apply({avatarId:'a',baseBones,bones:{},expressions:{}});
 expect(head.quaternion.angleTo(baseline)).toBeLessThan(1e-7);expect(hips.position.toArray()).toEqual([1,2,3]);
 for(const weight of [0,.5,1,.5]){
  update.mockClear();binding.apply({avatarId:'a',baseBones,bones:{head:{rotation:sample.toArray(),space:'normalized',weight},hips:{rotation:[0,0,0,1],position:[3,4,5],space:'normalized',weight}},expressions:{}});
  expect(head.quaternion.angleTo(baseline.clone().slerp(sample,weight))).toBeLessThan(1e-7);
  expect(hips.position.toArray()).toEqual([1+2*weight,2+2*weight,3+2*weight]);expect(update).toHaveBeenCalledOnce();
 }
});
it('blends raw absolute tracking from mapped idle and returns continuously to idle',()=>{
 const rest=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.4),a=fixture(rest,new Vector3(1,2,3)),b=fixture();
 const idle=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.6),sample=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.8);
 const baseBones={head:{rotation:idle.toArray(),position:[2,1,0] as [number,number,number],space:'normalized' as const}};
 a.binding.apply({avatarId:'a',baseBones,bones:{},expressions:{}});const mapped=a.head.quaternion.clone(),position=a.head.position.clone();
 expect(mapped.angleTo(rest)).toBeGreaterThan(.1);
 for(const weight of [1,.5,0]){
  a.binding.apply({avatarId:'a',baseBones,bones:{head:{rotation:sample.toArray(),position:[5,6,7],space:'raw',weight}},expressions:{}});
  expect(a.head.quaternion.angleTo(mapped.clone().slerp(sample,weight))).toBeLessThan(1e-7);
  expect(a.head.position.distanceTo(position.clone().lerp(new Vector3(5,6,7),weight))).toBeLessThan(1e-7);
 }
 a.binding.apply({avatarId:'a',baseBones,bones:{},expressions:{}});expect(a.head.quaternion.angleTo(mapped)).toBeLessThan(1e-7);
 expect(b.head.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
});
it('composes idle and tracking before one chestless fallback and retains sparse arm idle',()=>{
 const a=fixture(),chested=fixture(new Quaternion(),new Vector3(0,1,0),true);
 const idle=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.2),tracked=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4),arm=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.8);
 const pose={avatarId:'a',baseBones:{chest:{rotation:idle.toArray(),space:'normalized' as const},leftUpperArm:{rotation:arm.toArray(),space:'normalized' as const}},bones:{chest:{rotation:tracked.toArray(),space:'normalized' as const,weight:.5}},expressions:{}};
 a.binding.apply(pose);chested.binding.apply(pose);const expected=idle.clone().slerp(tracked,.5);
 expect(a.bones.spine.node.quaternion.angleTo(expected)).toBeLessThan(1e-7);expect(a.bones.leftUpperArm.node.quaternion.angleTo(arm)).toBeLessThan(1e-7);
 expect(chested.bones.chest!.node.quaternion.angleTo(expected)).toBeLessThan(1e-7);expect(chested.bones.spine.node.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
});
it('lets normalized spine tracking replace the chestless effective idle baseline before composing tracked chest',()=>{
 const a=fixture(),idle=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.3),spine=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.5),chest=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.2);
 const baseBones={chest:{rotation:idle.toArray(),space:'normalized' as const}};
 for(const weight of [0,.5,1]){
  a.binding.apply({avatarId:'a',baseBones,bones:{spine:{rotation:spine.toArray(),space:'normalized',weight}},expressions:{}});
  expect(a.bones.spine.node.quaternion.angleTo(idle.clone().slerp(spine,weight))).toBeLessThan(1e-7);
 }
 a.binding.apply({avatarId:'a',baseBones,bones:{spine:{rotation:spine.toArray(),space:'normalized'},chest:{rotation:chest.toArray(),space:'normalized'}},expressions:{}});
 expect(a.bones.spine.node.quaternion.angleTo(spine.clone().multiply(chest))).toBeLessThan(1e-7);
 a.binding.apply({avatarId:'a',baseBones,bones:{chest:{rotation:chest.toArray(),space:'normalized',weight:.5}},expressions:{}});
 expect(a.bones.spine.node.quaternion.angleTo(idle.clone().slerp(chest,.5))).toBeLessThan(1e-7);
});

function orientedArmFixture(version:'0'|'1') {
 const base=fixture();
 const direction=version==='0'?-1:1;
 for(const [side,sign] of [['left',direction],['right',-direction]] as const){
  const upper=base.bones[`${side}UpperArm`].node,lower=base.bones[`${side}LowerArm`].node,hand=base.bones[`${side}Hand`].node;
  upper.position.set(sign*.2,1,0);lower.position.set(sign*.3,0,0);hand.position.set(sign*.3,0,0);upper.add(lower);lower.add(hand);
 }
 base.vrm.scene.updateMatrixWorld(true);
 const vrm=new VRM({scene:base.vrm.scene,humanoid:new VRMHumanoid(base.bones),meta:version==='0'?{metaVersion:'0',title:'generated'}:{metaVersion:'1',name:'generated',authors:['test'],licenseUrl:'https://example.com'}});
 VRMUtils.rotateVRM0(vrm);
 return {...base,vrm,binding:createAvatarBinding(vrm)};
}
it('keeps canonical idle hands below shoulders on VRM0 and VRM1 without changing tracking axes',()=>{
 const left=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.9),right=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.9);
 for(const version of ['0','1'] as const){
  const a=orientedArmFixture(version);const baseBones={leftUpperArm:{rotation:left.toArray(),space:'normalized' as const},rightUpperArm:{rotation:right.toArray(),space:'normalized' as const}};
  a.binding.apply({avatarId:'a',baseBones,bones:{},expressions:{}});
  for(const side of ['left','right'] as const)expect(a.bones[`${side}Hand`].node.getWorldPosition(new Vector3()).y).toBeLessThan(a.bones[`${side}UpperArm`].node.getWorldPosition(new Vector3()).y);
  const tracking=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.4);
  a.binding.apply({avatarId:'a',baseBones,bones:{leftUpperArm:{rotation:tracking.toArray(),space:'normalized'}},expressions:{}});
  expect(a.bones.leftUpperArm.node.quaternion.angleTo(tracking)).toBeLessThan(1e-7);
  a.binding.apply({avatarId:'a',baseBones,bones:{leftUpperArm:{rotation:tracking.toArray(),space:'raw'}},expressions:{}});
  expect(a.bones.leftUpperArm.node.quaternion.angleTo(tracking)).toBeLessThan(1e-7);
 }
});
it('adapts canonical baseline X/Z quaternion and position components only for VRM0',()=>{
 for(const version of ['0','1'] as const){
  const a=orientedArmFixture(version),q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),.5);
  const set=vi.spyOn(a.vrm.humanoid,'setNormalizedPose');
  a.binding.apply({avatarId:'a',baseBones:{hips:{rotation:q.toArray(),position:[1,2,3],space:'normalized'}},bones:{},expressions:{}});
  const sign=version==='0'?-1:1;
  expect(set).toHaveBeenLastCalledWith({hips:{rotation:[q.x*sign,q.y,q.z*sign,q.w],position:[sign,2,3*sign]}});
 }
});

function morphMesh(names:string[]) {
 const mesh=new Mesh();mesh.morphTargetDictionary=Object.fromEntries(names.map((name,index)=>[name,index]));mesh.morphTargetInfluences=names.map(()=>0);return mesh;
}
it('drives all 52 named ARKit morphs on every mesh and resets sparse channels only',()=>{
 expect(arkitNames).toHaveLength(52);
 const {vrm}=fixture(),a=morphMesh([...arkitNames,'unrelated']),b=morphMesh([...arkitNames]);
 vrm.scene.add(a,b);a.morphTargetInfluences![52]=.3;const binding=createAvatarBinding(vrm);
 binding.apply({avatarId:'a',bones:{},expressions:Object.fromEntries(arkitNames.map(name=>[name,.6]))});
 expect(a.morphTargetInfluences!.slice(0,52)).toEqual(arkitNames.map(()=>.6));expect(b.morphTargetInfluences).toEqual(arkitNames.map(()=>.6));
 expect(vrm.expressionManager!.getValue('aa')).toBe(0);expect(vrm.expressionManager!.getValue('happy')).toBe(0);
 binding.apply({avatarId:'a',bones:{},expressions:{jawOpen:.2}});
 expect(a.morphTargetInfluences![arkitNames.indexOf('jawOpen')]).toBe(.2);expect(a.morphTargetInfluences![0]).toBe(0);
 binding.apply();expect(a.morphTargetInfluences!.slice(0,52)).toEqual(arkitNames.map(()=>0));expect(a.morphTargetInfluences![52]).toBe(.3);
});
it('canonicalizes side aliases and prefers registered canonical or exact custom expressions',()=>{
 const {vrm}=fixture(),mesh=morphMesh(['eyeBlink_L','jawOpen']);vrm.scene.add(mesh);
 for(const name of ['jawOpen','eyeBlinkLeft'])vrm.expressionManager!.registerExpression(new VRMExpression(name));
 const binding=createAvatarBinding(vrm);binding.apply({avatarId:'a',bones:{},expressions:{eyeBlink_L:.7,jawOpen:.4}});
 expect(vrm.expressionManager!.getValue('eyeBlinkLeft')).toBe(.7);expect(vrm.expressionManager!.getValue('jawOpen')).toBe(.4);expect(vrm.expressionManager!.getValue('aa')).toBe(0);expect(mesh.morphTargetInfluences).toEqual([0,0]);
 for(const name of arkitNames)expect(canonicalArkitName(name.replace(/Left$/,'_L').replace(/Right$/,'_R'))).toBe(name);
 expect(canonicalArkitName('notArkit')).toBeUndefined();
});
it('applies direct morphs after real VRM binds and preserves their writes after direct input disappears',()=>{
 const {vrm}=fixture(),mesh=morphMesh(['jawOpen','unrelated']);vrm.scene.add(mesh);
 vrm.expressionManager!.getExpression('aa')!.addBind(new VRMExpressionMorphTargetBind({primitives:[mesh],index:0,weight:1}));
 const binding=createAvatarBinding(vrm);
 binding.apply({avatarId:'a',bones:{},expressions:{jawOpen:.8}});expect(mesh.morphTargetInfluences![0]).toBe(.8);expect(vrm.expressionManager!.getValue('aa')).toBe(0);
 binding.apply({avatarId:'a',bones:{},expressions:{A:.4}});expect(mesh.morphTargetInfluences![0]).toBe(.4);
 binding.apply();expect(mesh.morphTargetInfluences![0]).toBe(0);
});
