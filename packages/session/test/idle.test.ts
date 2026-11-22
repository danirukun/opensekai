import {describe,it,expect} from 'vitest';
import {AvatarPoseSchema,defaultTrackingConfig,makeSmokeScene,type AssetAnimation,type AssetRecord,type SceneEntity,type TrackingSample} from '@opensekai/contracts';
import {evaluateAvatarClipIdle,evaluateAvatarIdle} from '../src/idle';
import {createTrackingComposer} from '../src/tracking';
import {createSession} from '../src/session';
function sceneWithIdle(enabled:boolean|undefined,tracking=false){const scene=makeSmokeScene(),avatar=scene.entities.find(e=>e.kind==='avatar')!;if(avatar.kind!=='avatar')throw new Error('Missing fixture avatar');if(enabled!==undefined)avatar.idleAnimation={kind:'builtin',enabled};if(tracking){const config=defaultTrackingConfig('vmc');config.enabled=true;scene.entities.push({id:'idle-body',name:'Body',kind:'tracking',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},generation:1,config} as SceneEntity);avatar.tracking={bodySourceId:'idle-body',faceSourceId:null};}return scene;}
const clipAnimation:AssetAnimation={durationMs:1000,bones:{chest:{times:[0,1],rotations:[0,0,0,1,0,0,Math.SQRT1_2,Math.SQRT1_2]}}};
const clipId='animation_'+'b'.repeat(64);
const clipRecord:AssetRecord={id:clipId,format:'vrma',sha256:'b'.repeat(64),bytes:64,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Clip',expressions:[],animation:clipAnimation};
function sceneWithClip(enabled=true){const scene=makeSmokeScene(),avatar=scene.entities.find(e=>e.kind==='avatar')!;if(avatar.kind!=='avatar')throw new Error('Missing fixture avatar');avatar.idleAnimation={kind:'clip',enabled,assetId:clipId};return scene;}
const sample:TrackingSample={sourceId:'idle-body',generation:1,receivedAtMs:10000,bones:{leftUpperArm:{space:'normalized',rotation:[0,0,0,1]}},expressions:{}};
describe('deterministic built-in idle',()=>{
 it('stands with arms dropped near the sides and soft elbows without forbidden channels',()=>{const bones=evaluateAvatarIdle(0);expect(Object.keys(bones).sort()).toEqual(['chest','leftLowerArm','leftUpperArm','rightLowerArm','rightUpperArm']);expect(bones.leftUpperArm.rotation[2]).toBeLessThan(0);expect(bones.rightUpperArm.rotation[2]).toBeGreaterThan(0);expect(bones.leftUpperArm.rotation[0]).toBeGreaterThan(0);expect(bones.rightUpperArm.rotation[0]).toBeGreaterThan(0);expect(bones.leftLowerArm.rotation[0]).toBeGreaterThan(0);expect(bones.rightLowerArm.rotation[0]).toBeGreaterThan(0);for(const bone of Object.values(bones)){expect(bone.space).toBe('normalized');expect(Math.hypot(...bone.rotation)).toBeCloseTo(1,12);expect(bone).not.toHaveProperty('weight');expect(bone).not.toHaveProperty('position');}});
 it('is deterministic, bounded, normalized and schema-valid through long elapsed time',()=>{for(const time of [0,500,1500,3000,6000,8000,10000000,Number.MAX_SAFE_INTEGER,Number.MAX_VALUE]){const bones=evaluateAvatarIdle(time);expect(evaluateAvatarIdle(time)).toEqual(bones);for(const bone of Object.values(bones)){expect(Math.hypot(...bone.rotation)).toBeCloseTo(1,12);expect(bone.rotation.every(Number.isFinite)).toBe(true);}const q=bones.chest.rotation;expect(2*Math.acos(Math.min(1,Math.abs(q[3])))).toBeLessThanOrEqual(Math.PI/180);expect(AvatarPoseSchema.safeParse({avatarId:'a',baseBones:bones,bones:{},expressions:{}}).success).toBe(true);}expect(evaluateAvatarIdle(1500).chest.rotation).not.toEqual(evaluateAvatarIdle(0).chest.rotation);});
 it.each([NaN,Infinity,-Infinity,-1])('rejects invalid animation time %s',time=>expect(()=>evaluateAvatarIdle(time)).toThrow(RangeError));
 it('returns isolated values so consumers cannot change future evaluations',()=>{const a=evaluateAvatarIdle(1000);a.leftUpperArm.rotation[2]=123;expect(evaluateAvatarIdle(1000).leftUpperArm.rotation[2]).not.toBe(123);});
});
describe('idle and tracking composition',()=>{
 it('emits a baseline without any source or avatar tracking assignment',()=>{const scene=sceneWithIdle(true),frame=createSession(scene,'idle-test').advance(1000);const pose=frame.avatarPoses?.find(p=>p.avatarId==='performer');expect(pose).toEqual({avatarId:'performer',baseBones:evaluateAvatarIdle(1000),bones:{},expressions:{}});expect(pose).not.toHaveProperty('root');expect(frame.trackingStatus).toBeUndefined();});
 it.each([false,undefined])('preserves missing/disabled idle behavior (%s)',enabled=>{const frame=createSession(sceneWithIdle(enabled),'idle-test').advance(1000);expect(frame.avatarPoses).toBeUndefined();});
 it.each(['normalized','raw'] as const)('retains sparse %s tracking separately from the whole idle baseline',space=>{const scene=sceneWithIdle(true,true),composer=createTrackingComposer();expect(composer.ingest({samples:[{...sample,bones:{leftUpperArm:{...sample.bones.leftUpperArm,space}}}],statuses:[]},scene).ok).toBe(true);const pose=composer.evaluate(scene,10000,1200).avatarPoses[0];expect(pose.baseBones).toEqual(evaluateAvatarIdle(1200));expect(Object.keys(pose.bones)).toEqual(['leftUpperArm']);expect(pose.bones.leftUpperArm).toEqual({...sample.bones.leftUpperArm,space,weight:1});expect(pose.baseBones?.rightUpperArm).toBeDefined();expect(pose.bones.rightUpperArm).toBeUndefined();});
 it('holds and fades tracking without fading or deleting the idle baseline',()=>{const scene=sceneWithIdle(true,true),composer=createTrackingComposer();composer.ingest({samples:[sample],statuses:[]},scene);for(const [time,weight] of [[10500,1],[10625,.5],[10750,0]]){const pose=composer.evaluate(scene,time,2000).avatarPoses[0];expect(pose.baseBones).toEqual(evaluateAvatarIdle(2000));if(weight)expect(pose.bones.leftUpperArm.weight).toBe(weight);else expect(pose.bones).toEqual({});}});
 it('uses session animation time independently of native tracking receipt time',()=>{const a=createSession(sceneWithIdle(true,true),'idle-a'),b=createSession(sceneWithIdle(true,true),'idle-b');a.ingestTracking({samples:[sample],statuses:[]});b.ingestTracking({samples:[sample],statuses:[]});const fresh=a.advance(1500,10000).avatarPoses![0],faded=b.advance(1500,10625).avatarPoses![0];expect(fresh.baseBones).toEqual(evaluateAvatarIdle(1500));expect(faded.baseBones).toEqual(fresh.baseBones);expect(fresh.bones.leftUpperArm.weight).toBe(1);expect(faded.bones.leftUpperArm.weight).toBe(.5);const advanced=a.advance(3000,10000).avatarPoses![0];expect(advanced.baseBones).not.toEqual(fresh.baseBones);expect(advanced.bones).toEqual(fresh.bones);});
 it('keeps persistent scene/revision unchanged while idle continues at session cadence',()=>{const session=createSession(sceneWithIdle(true),'idle-test'),before=session.inspect();const first=session.advance(0),last=session.advance(1000);expect(first.avatarPoses?.[0]?.baseBones).not.toEqual(last.avatarPoses?.[0]?.baseBones);expect(session.inspect()).toEqual(before);expect(last.scene.revision).toBe(before.revision);expect(last.sequence).toBe(first.sequence+1);});
 it.each([NaN,Infinity,-1])('rejects invalid animation clock in the composer (%s)',time=>expect(()=>createTrackingComposer().evaluate(sceneWithIdle(true),1000,time)).toThrow(RangeError));
});
describe('clip idle',()=>{
 it('samples looped clip rotations into baseBones',()=>{
  expect(evaluateAvatarClipIdle(clipAnimation,0).chest.rotation).toEqual([0,0,0,1]);
  expect(evaluateAvatarClipIdle(clipAnimation,1000).chest.rotation).toEqual([0,0,0,1]);
  const mid=evaluateAvatarClipIdle(clipAnimation,500).chest.rotation;
  expect(Math.hypot(...mid)).toBeCloseTo(1,12);
  expect(mid[2]).toBeGreaterThan(0);
  expect(AvatarPoseSchema.safeParse({avatarId:'a',baseBones:evaluateAvatarClipIdle(clipAnimation,250),bones:{},expressions:{}}).success).toBe(true);
 });
 it('emits clip baseline through the session when the record is present',()=>{
  const session=createSession(sceneWithClip(),'clip-test',[clipRecord]);
  const pose=session.advance(250).avatarPoses?.find(p=>p.avatarId==='performer');
  expect(pose?.baseBones).toEqual(evaluateAvatarClipIdle(clipAnimation,250));
 });
 it('gives no baseline when the clip asset is missing',()=>{
  const frame=createSession(sceneWithClip(),'clip-missing').advance(250);
  expect(frame.avatarPoses).toBeUndefined();
 });
 it('rejects setAvatarIdle clip when the asset is not an animation record',()=>{
  const session=createSession(sceneWithIdle(true),'clip-patch');
  const bad=session.applyPatch({sceneId:session.inspect().sceneId,expectedRevision:session.inspect().revision,operations:[{kind:'setAvatarIdle',entityId:'performer',idleAnimation:{kind:'clip',enabled:true,assetId:clipId}}]});
  expect(bad.ok).toBe(false);
  session.setAssetRecords([clipRecord]);
  const ok=session.applyPatch({sceneId:session.inspect().sceneId,expectedRevision:session.inspect().revision,operations:[{kind:'setAvatarIdle',entityId:'performer',idleAnimation:{kind:'clip',enabled:true,assetId:clipId}}]});
  expect(ok.ok).toBe(true);
 });
});
