import {Group,Object3D,Vector3} from 'three';
import {VRM,VRMExpressionManager,VRMHumanoid,VRMSpringBoneCollider,VRMSpringBoneColliderShapeSphere,VRMSpringBoneJoint,VRMSpringBoneManager,type VRMHumanBones} from '@pixiv/three-vrm';
const SETTINGS={stiffness:1,gravityPower:.5,gravityDir:new Vector3(0,-1,0),dragForce:.4,hitRadius:.02};
// The humanoid of the avatar-pose.test.ts fixture, plus a 3-joint hair chain behind the head and a sphere collider on the head.
export function springAvatar({springs=true,humanoidJoint=false}:{springs?:boolean;humanoidJoint?:boolean}={}){
 const scene=new Group(),hips=new Object3D(),head=new Object3D();scene.add(hips);hips.add(head);head.position.set(0,1,0);
 const bones={hips:{node:hips},head:{node:head}} as VRMHumanBones;
 for(const name of ['spine','leftUpperLeg','leftLowerLeg','leftFoot','rightUpperLeg','rightLowerLeg','rightFoot','leftUpperArm','leftLowerArm','leftHand','rightUpperArm','rightLowerArm','rightHand'] as const){const node=new Object3D();hips.add(node);bones[name]={node};}
 bones.spine.node.add(head,bones.leftUpperArm.node,bones.rightUpperArm.node);
 const hand=bones.leftHand.node;if(humanoidJoint)hand.position.set(.3,0,0);
 const hair=[new Object3D(),new Object3D(),new Object3D()];head.add(hair[0]);hair[0].add(hair[1]);hair[1].add(hair[2]);
 hair[0].position.set(0,.1,-.12);hair[1].position.set(0,-.1,0);hair[2].position.set(0,-.1,0);
 const collider=new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeSphere({radius:.08}));head.add(collider);
 const groups=[{colliders:[collider]}];
 const manager=new VRMSpringBoneManager();
 hair.forEach((bone,index)=>manager.addJoint(new VRMSpringBoneJoint(bone,hair[index+1]??null,SETTINGS,groups)));
 if(humanoidJoint)manager.addJoint(new VRMSpringBoneJoint(hand,null,SETTINGS,groups));
 const vrm=new VRM({scene,humanoid:new VRMHumanoid(bones),expressionManager:new VRMExpressionManager(),meta:{metaVersion:'1',name:'generated',authors:['tests'],licenseUrl:'https://example.com'},...(springs?{springBoneManager:manager}:{})});
 return {vrm,head,hair,hand};
}
