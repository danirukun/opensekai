import {describe,it,expect} from 'vitest';
import {SceneEntitySchema,ScenePatchSchema,SceneViewSchema,TrackingSampleSchema,RuntimeFrameSchema,makeSmokeScene,ClockEnvelopeSchema} from '../src/index';
const base={id:'source',name:'VMC Receiver',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}};
const receiver={...base,kind:'tracking',generation:1,config:{kind:'vmc',enabled:false,bindAddress:'127.0.0.1',port:39539,senderAddress:null}};
describe('live authoring and tracking boundary',()=>{
 it('accepts an add/config/lens transaction and rejects invalid ports/lenses',()=>{
  expect(SceneEntitySchema.safeParse(receiver).success).toBe(true);
  expect(SceneEntitySchema.safeParse({...receiver,config:{...receiver.config,port:65536}}).success).toBe(false);
  expect(ScenePatchSchema.safeParse({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'createEntity',entity:receiver},{kind:'setCameraLens',entityId:'camera_wide',lens:{fovDegrees:40,near:.01,far:100}}]}).success).toBe(true);
  expect(ScenePatchSchema.safeParse({sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setCameraLens',entityId:'camera_wide',lens:{fovDegrees:40,near:10,far:1}}]}).success).toBe(false);
 });
 it('rejects broken or incompatible avatar source references',()=>{
  const scene=makeSmokeScene();scene.entities.push(receiver as any);
  const avatar=scene.entities.find(e=>e.kind==='avatar')!;
  (avatar as any).tracking={bodySourceId:'missing',faceSourceId:null};expect(SceneViewSchema.safeParse(scene).success).toBe(false);
  (avatar as any).tracking={bodySourceId:'source',faceSourceId:'source'};expect(SceneViewSchema.safeParse(scene).success).toBe(true);
  (scene.entities.at(-1) as any).config={kind:'ifacialmocap',enabled:false,bindAddress:'0.0.0.0',port:49983,phoneAddress:null};expect(SceneViewSchema.safeParse(scene).success).toBe(false);
 });
 it('bounds finite tagged poses and keeps legacy no-pose frame/clock valid',()=>{
  const sample={sourceId:'source',generation:1,receivedAtMs:100,bones:{head:{rotation:[0,0,0,1],space:'raw'}},expressions:{A:.5}};
  expect(TrackingSampleSchema.safeParse(sample).success).toBe(true);
  expect(TrackingSampleSchema.safeParse({...sample,bones:{garbage:{rotation:[0,0,0,1],space:'raw'}}}).success).toBe(false);
  expect(TrackingSampleSchema.safeParse({...sample,expressions:{A:Infinity}}).success).toBe(false);
  expect(TrackingSampleSchema.safeParse({...sample,bones:{head:{rotation:[0,0,0,0],space:'raw'}}}).success).toBe(false);
  expect(RuntimeFrameSchema.safeParse({schemaVersion:1,sessionId:'session',sequence:0,tick:0,elapsedMs:0,scene:makeSmokeScene()}).success).toBe(true);
  expect(ClockEnvelopeSchema.safeParse({kind:'clock',sessionId:'session',elapsedMs:100,tracking:{samples:[sample],statuses:[]}}).success).toBe(true);
 });
});
