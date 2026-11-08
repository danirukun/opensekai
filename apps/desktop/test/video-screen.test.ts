import {expect,it,vi} from 'vitest';
import {LIMITS,makeSmokeScene,type AppApi,type AssetRecord,type Reply,type SceneEntity,type ScenePatch,type SceneView} from '@opensekai/contracts';
import {makeAuthoringEntity,modelLabel} from '../src/editor/authoring';
import {sceneSourceOptions} from '../src/editor/environment';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {sectionsFor} from '../src/editor/inspector-sections';
import {createEditorModel} from '../src/editor/model';
import {VIDEO_DEFAULTS,assetFormatLabel,duplicateLimitReached,imageSourceOptions,playLabel,playbackState,samePlayback,screenVideo,videoContentDisabled,videoScreenLimitReached,videoSourceOptions} from '../src/editor/screen';
const sha='a'.repeat(64);
const base={sha256:sha,bytes:1,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,expressions:[]};
const image:AssetRecord={...base,id:'image_logo',format:'png',name:'Logo',image:{width:4,height:3,frames:1}};
const clip:AssetRecord={...base,id:'video_clip',format:'mp4',name:'Clip',video:{width:1920,height:1080,durationMs:12000,videoCodec:'h264',audioCodec:'aac',alpha:false}};
const silent:AssetRecord={...base,id:'video_silent',format:'webm',name:'Silent',video:{width:64,height:64,durationMs:1000,videoCodec:'vp9',audioCodec:null,alpha:true}};
const room:AssetRecord={...base,id:'scene_room',format:'glb',name:'Room'};
const avatar:AssetRecord={...base,id:'avatar_a',format:'vrm',name:'Avatar'};
const assets=[image,clip,silent,room,avatar];
const videoScreen=(id:string,content:Partial<typeof VIDEO_DEFAULTS>={}):SceneEntity=>({...makeAuthoringEntity('screen',id,[]),id,content:{kind:'video',...VIDEO_DEFAULTS,...content}} as SceneEntity);

it('lists only video records in the Screen Video select and shows Missing video for an unknown ID (R19, R20, R22)',()=>{
 expect(videoSourceOptions(null,assets)).toEqual([{value:'',label:'Choose video…'},{value:'video_clip',label:'Clip'},{value:'video_silent',label:'Silent'},{value:'__import__',label:'Import file…'}]);
 expect(videoSourceOptions('video_gone',assets).find(o=>o.value==='video_gone')!.label).toBe('Missing video');
 // A record of another kind is not a video.
 expect(videoSourceOptions('image_logo',assets).find(o=>o.value==='image_logo')!.label).toBe('Missing video');
});
it('keeps video records out of the Prop, Environment, character, and Screen Image fields (R20)',()=>{
 expect(sceneSourceOptions(null,assets).map(o=>o.value)).toEqual(['','scene_room','__import__']);
 expect(imageSourceOptions(null,assets).map(o=>o.value)).toEqual(['','image_logo','__import__']);
 expect(imageSourceOptions('video_clip',assets).find(o=>o.value==='video_clip')!.label).toBe('Missing image');
 expect(modelLabel('video_clip',assets)).toBe('Missing model');
 expect(modelLabel('avatar_a',assets)).toBe('Avatar');
});
it('still makes image content from the Add menu Screen item (R20)',()=>{
 expect(makeAuthoringEntity('screen','s',makeSmokeScene().entities)).toMatchObject({kind:'screen',content:{kind:'image',assetId:null}});
});
it('disables Content Video and Duplicate at the video screen limit, except Content on a video screen (R19)',()=>{
 const scene=makeSmokeScene().entities;
 const videos=Array.from({length:LIMITS.videoScreens-1},(_,index)=>videoScreen(`v${index}`));
 const still=makeAuthoringEntity('screen','still',[]);
 const below=[...scene,...videos,still];
 expect([videoScreenLimitReached(below),videoContentDisabled(still,below),duplicateLimitReached(videos[0]!,below)]).toEqual([false,false,false]);
 const last=videoScreen('last'),full=[...below,last];
 expect(videoScreenLimitReached(full)).toBe(true);
 expect(videoContentDisabled(still,full)).toBe(true);
 expect(videoContentDisabled(last,full)).toBe(false);
 expect(duplicateLimitReached(last,full)).toBe(true);
 // An image screen still duplicates at the video limit.
 expect(duplicateLimitReached(still,full)).toBe(false);
});
it('resets Content to Image, Video to none, Auto Play to false, Loop to true, and Volume to 1 (R19, B17)',()=>{
 const still=makeAuthoringEntity('screen','s',[]);
 expect(resetFieldIds(still)).toEqual(['visible','position','rotation','scale','content','image']);
 expect(changedFields(still).size).toBe(0);
 const plain=videoScreen('v');
 expect(resetFieldIds(plain)).toEqual(['visible','position','rotation','scale','content','video','autoPlay','loop','volume']);
 expect(defaultsFor(plain)).toMatchObject({content:'image',image:null,video:null,autoPlay:false,loop:true,volume:1});
 expect([...changedFields(plain)]).toEqual(['content']);
 expect([...changedFields(videoScreen('v',{assetId:'video_clip',autoPlay:true,loop:false,volume:0.5}))]).toEqual(['content','video','autoPlay','loop','volume']);
 // The section index has the one Screen section for each content kind.
 expect(sectionsFor(plain,{expressions:false}).map(section=>section.label)).toEqual(['Transform','Screen']);
});
it('reads the video values of a screen, and the start values for image content (R19)',()=>{
 expect(screenVideo(videoScreen('v',{assetId:'video_clip',volume:0.25}))).toEqual({assetId:'video_clip',autoPlay:false,loop:true,volume:0.25});
 expect(screenVideo(makeAuthoringEntity('screen','s',[]))).toEqual({assetId:null,autoPlay:false,loop:true,volume:1});
});
it('takes the Play or Pause label from the latest frame entry and shows Play without one (R19)',()=>{
 const state=playbackState({screenPlayback:[{entityId:'a',playing:true,positionMs:10},{entityId:'b',playing:false,positionMs:0}]});
 expect([playLabel(state,'a'),playLabel(state,'b'),playLabel(state,'c')]).toEqual(['Pause','Play','Play']);
 expect(playbackState({}).size).toBe(0);
 // A new position alone is the same state, so the Editor does not update on each frame.
 expect(samePlayback(state,playbackState({screenPlayback:[{entityId:'b',playing:false,positionMs:99},{entityId:'a',playing:true,positionMs:500}]}))).toBe(true);
 expect(samePlayback(state,playbackState({screenPlayback:[{entityId:'a',playing:false,positionMs:10},{entityId:'b',playing:false,positionMs:0}]}))).toBe(false);
 expect(samePlayback(state,playbackState({screenPlayback:[{entityId:'a',playing:true,positionMs:10}]}))).toBe(false);
});
it('shows the format, the video codec, and the audio codec of a video record in the Assets list (R19)',()=>{
 expect([assetFormatLabel(clip),assetFormatLabel(silent),assetFormatLabel(image)]).toEqual(['MP4 · H.264 · AAC','WEBM · VP9','PNG']);
});
// The editor model against a recording API: the session is the other agent's boundary, so this checks the patch that the model sends.
function recording(scene:SceneView){
 const patches:ScenePatch[]=[];
 const unsupported=async():Promise<Reply<never>>=>({ok:false,error:{code:'UNSUPPORTED',message:'Unsupported',ids:[]}});
 const api:AppApi={appStatus:unsupported,sceneInspect:vi.fn(async()=>({ok:true as const,data:structuredClone(scene)})),
  scenePatch:vi.fn(async(params:ScenePatch)=>{patches.push(params);return {ok:true as const,data:{revision:scene.revision}};}),cameraSelect:unsupported,sceneReplace:unsupported,
  blueprintRun:unsupported,captureFrame:unsupported,benchmarkStart:unsupported,benchmarkStatus:unsupported,benchmarkCancel:unsupported,evidenceRead:unsupported};
 return {patches,model:createEditorModel(api)};
}
it('sends setScreenVideo and controlScreenVideo for a screen, and rejects other entities and invalid values (R19)',async()=>{
 const scene=makeSmokeScene();scene.revision=3;scene.entities.push(videoScreen('screen_v'));
 const {patches,model}=recording(scene);
 await model.load();
 expect(await model.setScreenVideo('screen_v',{assetId:'video_clip',autoPlay:true,loop:true,volume:0.5},3)).toMatchObject({ok:true});
 expect(await model.controlScreenVideo('screen_v','pause')).toMatchObject({ok:true});
 expect(patches.map(patch=>[patch.expectedRevision,patch.operations])).toEqual([
  [3,[{kind:'setScreenVideo',entityId:'screen_v',video:{assetId:'video_clip',autoPlay:true,loop:true,volume:0.5}}]],
  [3,[{kind:'controlScreenVideo',entityId:'screen_v',action:'pause'}]],
 ]);
 expect(await model.setScreenVideo('screen_v',{assetId:null,autoPlay:false,loop:true,volume:2})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(await model.controlScreenVideo('camera_main','play')).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
 expect(patches).toHaveLength(2);
});
