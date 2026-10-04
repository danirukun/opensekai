import {describe,it,expect} from 'vitest';
import {makeSmokeScene,defaultTrackingConfig,type SceneEntity} from '@opensekai/contracts';
import {createSession} from '../src/session';
const base={name:'Source',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}};
function setup(faceKind:'ifacialmocap'|'mediapipe'='ifacialmocap'){const s=createSession(makeSmokeScene(),'test');for(const [id,kind] of [['body','vmc'],['face',faceKind]] as const){const config=defaultTrackingConfig(kind);config.enabled=true;expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:s.inspect().revision,operations:[{kind:'createEntity',entity:{...base,id,kind:'tracking',generation:0,config} as SceneEntity}]}).ok).toBe(true);}expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:2,operations:[{kind:'setAvatarTracking',entityId:'performer',tracking:{bodySourceId:'body',faceSourceId:'face'}}]}).ok).toBe(true);return s;}
describe('live scene authoring',()=>{
 it('creates stable ECS entities and stamps generations with one atomic revision',()=>{const s=createSession(makeSmokeScene(),'test');const entity={...base,id:'newcam',kind:'camera',lens:{fovDegrees:40,near:.01,far:100}} as SceneEntity;
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity},{kind:'setCameraLens',entityId:'newcam',lens:{fovDegrees:55,near:.1,far:50}}]})).toEqual({ok:true,data:{revision:1}});
 expect(s.advance(0).scene.entities.find(e=>e.id==='newcam')).toMatchObject({lens:{fovDegrees:55}});const before=s.inspect();
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:1,operations:[{kind:'setVisibility',entityId:'marker',visible:false},{kind:'createEntity',entity}]}).ok).toBe(false);expect(s.inspect()).toEqual(before);});
 it('rejects incompatible references/wrong entity kinds without a partial commit',()=>{const s=setup();const before=s.inspect();expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:3,operations:[{kind:'setAvatarTracking',entityId:'performer',tracking:{bodySourceId:'face',faceSourceId:null}}]}).ok).toBe(false);expect(s.inspect()).toEqual(before);
 expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:3,operations:[{kind:'setCameraLens',entityId:'performer',lens:{fovDegrees:40,near:.1,far:10}}]}).ok).toBe(false);expect(s.inspect()).toEqual(before);});
});
describe('source composition at simulation cadence',()=>{
 it('uses assigned body+face independently of arrival order and keeps pose transient',()=>{const s=setup();const before=s.inspect();const q=[0,Math.SQRT1_2,0,Math.SQRT1_2] as [number,number,number,number];
 s.ingestTracking({samples:[{sourceId:'face',generation:2,receivedAtMs:1000,bones:{head:{space:'normalized',rotation:[0,0,0,1]}},expressions:{jawOpen:.7}},{sourceId:'body',generation:1,receivedAtMs:1000,bones:{head:{space:'raw',rotation:q},leftUpperArm:{space:'raw',rotation:q}},expressions:{A:1},root:{position:[1,0,0],rotation:[0,0,0,1]}}],statuses:[]});
 const frame=s.advance(0,1000);const pose=frame.avatarPoses?.find(p=>p.avatarId==='performer');expect(pose?.bones.head?.space).toBe('normalized');expect(pose?.bones.leftUpperArm?.rotation).toEqual(q);expect(pose?.expressions).toEqual({jawOpen:.7});expect(pose?.root?.position).toEqual([1,0,0]);expect(s.inspect()).toEqual(before);
 });
 it('holds then fades stale data using native receipt time, not local worker origin',()=>{const s=setup();s.ingestTracking({samples:[{sourceId:'face',generation:2,receivedAtMs:10000,bones:{head:{space:'normalized',rotation:[0,0,0,1]}},expressions:{jawOpen:1}}],statuses:[]});expect(s.advance(0,10500).avatarPoses?.[0]?.expressions.jawOpen).toBe(1);expect(s.advance(100,10625).avatarPoses?.[0]?.expressions.jawOpen).toBeCloseTo(.5);expect(s.advance(200,10750).avatarPoses?.[0]?.expressions.jawOpen??0).toBe(0);});
 it('clears disabled or replaced generations and rejects a late old sample',()=>{const s=setup();const config=defaultTrackingConfig('ifacialmocap');config.enabled=true;expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:3,operations:[{kind:'setTrackingConfig',entityId:'face',config}]}).ok).toBe(true);expect(s.inspect().entities.find(e=>e.id==='face')).toMatchObject({generation:4});
 s.ingestTracking({samples:[{sourceId:'face',generation:2,receivedAtMs:100,bones:{},expressions:{jawOpen:1}}],statuses:[]});expect(s.advance(0,100).avatarPoses?.[0]?.expressions.jawOpen??0).toBe(0);
 config.enabled=false;expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:4,operations:[{kind:'setTrackingConfig',entityId:'face',config}]}).ok).toBe(true);s.ingestTracking({samples:[{sourceId:'face',generation:5,receivedAtMs:101,bones:{},expressions:{jawOpen:1}}],statuses:[]});expect(s.advance(1,101).avatarPoses?.[0]?.expressions.jawOpen??0).toBe(0);
 });
});

it('fades raw bones with a rest-relative weight and clears a stopped source immediately',()=>{
 const s=setup();const sample={sourceId:'body',generation:1,receivedAtMs:10000,bones:{leftUpperArm:{space:'raw' as const,rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2] as [number,number,number,number],position:[1,2,3] as [number,number,number]}},expressions:{}};
 expect(s.ingestTracking({samples:[sample],statuses:[]}).ok).toBe(true);
 expect(s.advance(0,10625).avatarPoses?.[0]?.bones.leftUpperArm).toMatchObject({...sample.bones.leftUpperArm,weight:.5});
 s.ingestTracking({samples:[],statuses:[{sourceId:'body',generation:1,state:'stopped',packets:1,invalidPackets:0,lastReceivedAtMs:null,error:null}]});
 expect(s.advance(1,10626).avatarPoses?.[0]?.bones.leftUpperArm).toBeUndefined();
});

const chestTurn=[0,.5,0,Math.sqrt(.75)] as [number,number,number,number];
const compensatedHead=[0,-.5,0,Math.sqrt(.75)] as [number,number,number,number];
const mpSample={sourceId:'face',generation:2,receivedAtMs:1000,bones:{chest:{space:'normalized' as const,rotation:chestTurn},head:{space:'normalized' as const,rotation:compensatedHead}},expressions:{}};
it.each([null,'body'])('recovers MediaPipe face local rotation when its torso is discarded, body=%s',bodySourceId=>{
 const s=setup('mediapipe');expect(s.applyPatch({sceneId:'scene_smoke',expectedRevision:3,operations:[{kind:'setAvatarTracking',entityId:'performer',tracking:{bodySourceId,faceSourceId:'face'}}]}).ok).toBe(true);
 s.ingestTracking({samples:[mpSample,{sourceId:'body',generation:1,receivedAtMs:1000,bones:{chest:{space:'raw',rotation:chestTurn}},expressions:{}}],statuses:[]});
 const pose=s.advance(0,1000).avatarPoses?.[0];expect(pose?.bones.head?.rotation).toEqual([0,0,0,1]);
 if(bodySourceId)expect(pose?.bones.chest).toMatchObject({rotation:chestTurn,space:'raw'});else expect(pose?.bones.chest).toBeUndefined();
});
it('keeps MediaPipe head parent compensation for the same body source and preserves missing-chest fallback',()=>{
 const s=setup('mediapipe');s.applyPatch({sceneId:'scene_smoke',expectedRevision:3,operations:[{kind:'setAvatarTracking',entityId:'performer',tracking:{bodySourceId:'face',faceSourceId:'face'}}]});s.ingestTracking({samples:[mpSample],statuses:[]});
 expect(s.advance(0,1000).avatarPoses?.[0]?.bones.head?.rotation).toEqual(compensatedHead);
 s.applyPatch({sceneId:'scene_smoke',expectedRevision:4,operations:[{kind:'setAvatarTracking',entityId:'performer',tracking:{bodySourceId:null,faceSourceId:'face'}}]});s.ingestTracking({samples:[{...mpSample,receivedAtMs:1001,bones:{head:mpSample.bones.head}}],statuses:[]});
 expect(s.advance(1,1001).avatarPoses?.[0]?.bones.head?.rotation).toEqual(compensatedHead);
});
