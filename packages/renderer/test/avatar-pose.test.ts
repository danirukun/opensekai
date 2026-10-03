import {expect,it,vi} from 'vitest';
import {Object3D,Group,Quaternion,Vector3} from 'three';
import {VRM,VRMHumanoid,VRMExpression,VRMExpressionManager,type VRMHumanBones} from '@pixiv/three-vrm';
import {createAvatarBinding,expressionWeights} from '../src/avatar-pose';
function fixture(restRotation = new Quaternion(), restPosition = new Vector3(0,1,0)) {
 const scene=new Group(),hips=new Object3D(),head=new Object3D();scene.add(hips);hips.add(head);head.position.copy(restPosition);head.quaternion.copy(restRotation);
 const bones={hips:{node:hips},head:{node:head}} as VRMHumanBones;
 for(const name of ['spine','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'] as const){const node=new Object3D();hips.add(node);bones[name]={node};}
 const humanoid=new VRMHumanoid(bones);
 const expressionManager=new VRMExpressionManager();for(const name of ['happy','aa','blinkLeft','Custom'])expressionManager.registerExpression(new VRMExpression(name));
 const vrm=new VRM({scene,humanoid,expressionManager,meta:{metaVersion:'1',name:'generated',authors:['tests'],licenseUrl:'https://example.com'}});
 return {vrm,hips,head,binding:createAvatarBinding(vrm)};
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
