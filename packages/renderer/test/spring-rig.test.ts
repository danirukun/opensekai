import {expect,it} from 'vitest';
import type {VRMSpringBoneColliderShapeSphere} from '@pixiv/three-vrm';
import {createSpringRig} from '../src/spring-rig';
import {springAvatar} from './spring-fixture';
// B43 R10: no rig for a model without spring joints.
it('returns null for a model without spring joints',()=>{
 expect(createSpringRig(springAvatar({springs:false}).vrm)).toBeNull();
 const {vrm}=springAvatar();const manager=vrm.springBoneManager!;for(const joint of [...manager.joints])manager.deleteJoint(joint);
 expect(createSpringRig(vrm)).toBeNull();
});
// B43 R13: the file values times the scale; drag does not change.
it('scales hit radius, stiffness, gravity, and collider radius from the file values',()=>{
 const {vrm}=springAvatar();const rig=createSpringRig(vrm)!;
 const joint=[...vrm.springBoneManager!.joints][0];const shape=vrm.springBoneManager!.colliders[0].shape as VRMSpringBoneColliderShapeSphere;
 rig.setScale(2);expect(joint.settings).toMatchObject({hitRadius:.04,stiffness:2,gravityPower:1,dragForce:.4});expect(shape.radius).toBeCloseTo(.16,12);
 rig.setScale(.5);expect(joint.settings).toMatchObject({hitRadius:.01,stiffness:.5,gravityPower:.25});expect(shape.radius).toBeCloseTo(.04,12);
 rig.setScale(1);expect(joint.settings).toMatchObject({hitRadius:.02,stiffness:1,gravityPower:.5});expect(shape.radius).toBeCloseTo(.08,12);
});
it('writes nothing when the scale does not change',()=>{
 const {vrm}=springAvatar();const rig=createSpringRig(vrm)!;const joint=[...vrm.springBoneManager!.joints][0];
 rig.setScale(2);joint.settings.stiffness=7;rig.setScale(2);expect(joint.settings.stiffness).toBe(7);
});
it('lists the joint bones',()=>{const {vrm,hair}=springAvatar();const joints=[...createSpringRig(vrm)!.joints];expect(joints).toHaveLength(3);joints.forEach((bone,index)=>expect(bone).toBe(hair[index]));});
