import {expect,it} from 'vitest';
import {defaultTrackingConfig,makeSmokeScene,type SceneEntity,type TrackingConfig,type TrackingSample} from '@opensekai/contracts';
import {createSession} from '../src/session';
import {applyPositionRule} from '../src/tracking';

// SelfReflect sends hand positions in centimetres, a hips position below the floor, and zero positions for the other bones.
const sample=():TrackingSample=>({sourceId:'source',generation:1,receivedAtMs:0,expressions:{jawOpen:.5},root:{position:[1,2,3],rotation:[0,0,0,1]},bones:{
 hips:{space:'raw',rotation:[0,0,0,1],position:[0,-.8,-.4]},
 spine:{space:'raw',rotation:[0,.6,0,.8],position:[0,0,0]},
 leftHand:{space:'raw',rotation:[0,0,0,1],position:[67.7,143.5,-6]},
 head:{space:'raw',rotation:[0,0,0,1]}}});

it('applyPositionRule rotationsOnly removes every position',()=>{
 const input=sample(),out=applyPositionRule(input,'rotationsOnly');
 for(const bone of Object.values(out.bones))expect(bone.position).toBeUndefined();
 expect(out.root).toEqual({position:[0,0,0],rotation:[0,0,0,1]});
 expect(out.bones.spine!.rotation).toEqual([0,.6,0,.8]);
 expect(out.expressions).toEqual({jawOpen:.5});
 expect(input).toEqual(sample());
});

it('hipsOnly keeps only hips',()=>{
 const out=applyPositionRule(sample(),'hipsOnly');
 expect(out.bones.hips!.position).toEqual([0,-.8,-.4]);
 for(const name of ['spine','leftHand','head'])expect(out.bones[name]!.position).toBeUndefined();
 expect(out.root!.position).toEqual([0,0,0]);
});

it('all returns the sample unchanged',()=>{
 expect(applyPositionRule(sample(),'all')).toEqual(sample());
});

function setup(config:TrackingConfig){
 const scene=makeSmokeScene();
 scene.entities.push({id:'source',kind:'tracking',name:'Source',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},config,generation:1} as SceneEntity);
 const avatar=scene.entities.find(e=>e.kind==='avatar');if(avatar?.kind==='avatar')avatar.tracking={bodySourceId:'source',faceSourceId:'source'};
 const session=createSession(scene,'positions');session.ingestTracking({samples:[sample()],statuses:[]});
 return session.advance(100,100).avatarPoses![0]!;
}

it('the composer applies the VMC position rule of the source; a missing rule means all',()=>{
 const vmc={...defaultTrackingConfig('vmc'),enabled:true} as Extract<TrackingConfig,{kind:'vmc'}>;
 const rotations=setup({...vmc,positions:'rotationsOnly'});
 expect(Object.values(rotations.bones).some(bone=>bone.position)).toBe(false);
 expect(rotations.root!.position).toEqual([0,0,0]);
 const hips=setup({...vmc,positions:'hipsOnly'});
 expect(hips.bones.hips!.position).toBeDefined();
 expect(hips.bones.leftHand!.position).toBeUndefined();
 const all=setup(vmc);
 expect(all.bones.leftHand!.position).toBeDefined();
});
