import {expect,it,vi} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {createAvatarBinding} from '../src/avatar-pose';
import {springAvatar} from './spring-fixture';
const Y=new Vector3(0,1,0);
const clock=(tick:number,resets=0)=>({sessionId:'s',tick,elapsedMs:tick*1000/60+1,resets});
const make=(options?:Parameters<typeof springAvatar>[0])=>{const a=springAvatar(options);return {...a,binding:createAvatarBinding(a.vrm)};};
// One renderer frame: apply, the transform that place sets, then the spring stage.
const drive=({binding,head}:ReturnType<typeof make>,tick:number,scale=1,resets=0)=>{
 binding.apply();head.quaternion.setFromAxisAngle(Y,Math.sin(tick/20)*.6);
 binding.root.position.set(Math.sin(tick/30)*.3*scale,0,0);binding.root.scale.setScalar(scale);binding.root.updateMatrixWorld(true);
 binding.advanceSprings(clock(tick,resets));};
const mean=(a:ReturnType<typeof make>,b:ReturnType<typeof make>)=>a.hair.reduce((sum,bone,i)=>sum+bone.quaternion.angleTo(b.hair[i].quaternion),0)/a.hair.length;
// B43 R6, R8: the same frames give the same steps.
it('gives the same spring pose in two instances for the same frames',()=>{
 const a=make(),b=make();for(let t=1;t<=300;t++){drive(a,t);drive(b,t);}
 expect(a.hair[2].quaternion.angleTo(new Quaternion())).toBeGreaterThan(1e-3);
 a.hair.forEach((bone,i)=>expect(bone.quaternion.toArray()).toEqual(b.hair[i].quaternion.toArray()));
});
// B43 R8: interpolation keeps a renderer that gets fewer frames close.
it('stays within 1 degree mean when an instance gets every second frame',()=>{
 const a=make(),b=make();
 for(let t=1;t<=600;t++){drive(a,t);if(t%2===0){drive(b,t);if(t>150)expect(mean(a,b)).toBeLessThan(Math.PI/180);}}
});
// B43 R7: a reset count change puts each joint at rest under the current parent.
it('returns the joints to rest under the current parent when the reset count changes',()=>{
 const a=make();for(let t=1;t<=60;t++)drive(a,t);drive(a,60,1,1);
 for(const bone of a.hair)expect(bone.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-9);
});
// B43 R13: a scaled avatar is a scaled copy.
it('moves a scaled avatar as a scaled copy',()=>{
 const a=make(),b=make();for(let t=1;t<=300;t++){drive(a,t);drive(b,t,2);}
 a.hair.forEach((bone,i)=>expect(bone.quaternion.angleTo(b.hair[i].quaternion)).toBeLessThan(1e-4));
});
// B43 R10.
it('never calls vrm.update',()=>{const a=make();const update=vi.spyOn(a.vrm,'update');for(let t=1;t<=30;t++)drive(a,t);expect(update).not.toHaveBeenCalled();});
it('does nothing for a model without spring joints',()=>{
 const a=make({springs:false});a.binding.apply();const rest=a.head.quaternion.clone();
 a.binding.advanceSprings(clock(1));a.binding.advanceSprings(clock(2));expect(a.head.quaternion.toArray()).toEqual(rest.toArray());
});
// B43 R9.
it('keeps a humanoid bone that is a spring joint at its spring result, also on a frame with no step',()=>{
 const a=make({humanoidJoint:true});const rest=a.hand.quaternion.clone();for(let t=1;t<=30;t++)drive(a,t);
 const moved=a.hand.quaternion.clone();expect(moved.angleTo(rest)).toBeGreaterThan(1e-3);
 drive(a,30);expect(a.hand.quaternion.angleTo(moved)).toBeLessThan(1e-12);
});
// B43 R6: no due step, no solver step.
it('runs no extra step when the same frame is applied twice',()=>{
 const a=make(),b=make();for(let t=1;t<=120;t++){drive(a,t);drive(b,t);drive(b,t);}
 a.hair.forEach((bone,i)=>expect(bone.quaternion.toArray()).toEqual(b.hair[i].quaternion.toArray()));
});
