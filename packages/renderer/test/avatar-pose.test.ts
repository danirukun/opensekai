import {expect,it,vi} from 'vitest';
import {Object3D,Group,Quaternion,Vector3} from 'three';
import {VRM,VRMHumanoid,VRMExpression,VRMExpressionManager,type VRMHumanBones} from '@pixiv/three-vrm';
import {createAvatarBinding,expressionWeights} from '../src/avatar-pose';
function fixture() {
 const scene=new Group(),hips=new Object3D(),head=new Object3D();scene.add(hips);hips.add(head);head.position.y=1;
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
