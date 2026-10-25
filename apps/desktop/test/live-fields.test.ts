import type {SceneEntity,TrackingStatus,TrackingConfig} from '@opensekai/contracts';
import {describe,it,expect} from 'vitest';
import {parseLens,reconcileDraft,sourceOptions,parseTrackingConfig,matchingStatus,initialTrackingDraft,cameraOptions} from '../src/editor/live-fields';
describe('live property drafts',()=>{
 it('validates the complete lens',()=>{expect(parseLens({fovDegrees:'60',near:'0.1',far:'100'})).toEqual({fovDegrees:60,near:.1,far:100});for(const values of [{fovDegrees:'',near:'1',far:'2'},{fovDegrees:'180',near:'1',far:'2'},{fovDegrees:'60',near:'2',far:'2'}])expect(parseLens(values)).toBeNull();});
 it('retains ordinary drafts through equal polls and resets on revision or selection change',()=>{const draft={value:'unfinished'};expect(reconcileDraft('a:2',{entityId:'a',revision:2},draft,{value:'base'}).values).toBe(draft);expect(reconcileDraft('a:2',{entityId:'a',revision:3},draft,{value:'base'}).values).toEqual({value:'base'});expect(reconcileDraft('a:2',{entityId:'b',revision:2},draft,{value:'base'}).values).toEqual({value:'base'});});
 it('excludes face-only sources from body choices',()=>{const base={visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},generation:0};const sources=[{...base,id:'face',name:'Phone',kind:'tracking',config:{kind:'ifacialmocap'}},{...base,id:'body',name:'VMC',kind:'tracking',config:{kind:'vmc'}},{...base,id:'osf',name:'OpenSeeFace',kind:'tracking',config:{kind:'openseeface'}}] as SceneEntity[];expect(sourceOptions(sources,'body','avatar').map(x=>x.value)).toEqual(['','body']);expect(sourceOptions(sources,'fingers','avatar').map(x=>x.value)).toEqual(['','body']);expect(sourceOptions(sources,'face','avatar').map(x=>x.value)).toEqual(['','face','body','osf']);});
 it('disables a source that another avatar uses and keeps the current value enabled',()=>{
  const base={visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},generation:0};
  const source=(id:string,kind:'vmc'|'ifacialmocap')=>({...base,id,name:id,kind:'tracking',config:{kind}});
  const avatar=(id:string,bodySourceId:string|null,faceSourceId:string|null)=>({...base,id,name:id,kind:'avatar',assetId:null,tracking:{bodySourceId,faceSourceId}});
  const entities=[source('vmc-a','vmc'),source('vmc-b','vmc'),source('phone-a','ifacialmocap'),source('phone-b','ifacialmocap'),avatar('a','vmc-a','phone-a'),avatar('b',null,'phone-b')] as SceneEntity[];
  const disabled=(channel:'body'|'face',id:string)=>sourceOptions(entities,channel,id).filter(x=>x.disabled).map(x=>x.value);
  expect(disabled('body','b')).toEqual(['vmc-a']);
  expect(disabled('face','b')).toEqual(['vmc-a','phone-a']);
  expect(disabled('body','a')).toEqual([]);
  expect(disabled('face','a')).toEqual(['phone-b']);
  // An old show that shares a source: the current value stays enabled, and the avatar's own body source is free for its face.
  const shared=[...entities.slice(0,4),avatar('a','vmc-a','vmc-a'),avatar('b','vmc-a',null)] as SceneEntity[];
  expect(sourceOptions(shared,'body','b').filter(x=>x.disabled).map(x=>x.value)).toEqual([]);
  expect(sourceOptions(shared,'face','b').filter(x=>x.disabled).map(x=>x.value)).toEqual(['vmc-a']);
  expect(sourceOptions(shared,'face','a').filter(x=>x.disabled).map(x=>x.value)).toEqual([]);
 });
 it('rejects invalid endpoint drafts without changing source kind',()=>{const c={kind:'vmc',enabled:false,bindAddress:'127.0.0.1',port:39539,senderAddress:null} as const;expect(parseTrackingConfig(c,{bindAddress:'bad',port:'1',address:''})).toBeNull();expect(parseTrackingConfig(c,{bindAddress:'127.0.0.1',port:'49983',address:''})).toEqual({...c,port:49983});const o={kind:'openseeface',enabled:false,bindAddress:'127.0.0.1',port:11573,senderAddress:null} as const;expect(parseTrackingConfig(o,{bindAddress:'0.0.0.0',port:'11574',address:'192.168.1.20'})).toEqual({...o,bindAddress:'0.0.0.0',port:11574,senderAddress:'192.168.1.20'});expect(initialTrackingDraft({...o,senderAddress:'10.0.0.2'}).address).toBe('10.0.0.2');});
 it('ignores superseded runtime status',()=>{const status:TrackingStatus={sourceId:'source',generation:4,state:'error',packets:0,invalidPackets:0,lastReceivedAtMs:null,error:'Bind failed'};expect(matchingStatus([status],'source',5)).toBeUndefined();expect(matchingStatus([status],'source',4)).toBe(status);});
 it('requires a channel before enabling webcam tracking',()=>{expect(parseTrackingConfig({kind:'mediapipe',enabled:true,deviceId:'',face:false,upperBody:false,hands:false,mirror:false},{bindAddress:'',port:'',address:''})).toBeNull();});
});

describe('proxy tracking input',()=>{it('initializes isolated drafts from each reactive config kind',()=>{const configs:TrackingConfig[]=[{kind:'vmc',enabled:false,bindAddress:'127.0.0.1',port:39539,senderAddress:null},{kind:'ifacialmocap',enabled:false,bindAddress:'0.0.0.0',port:49983,phoneAddress:'192.168.1.2'},{kind:'mediapipe',enabled:false,deviceId:'camera',face:true,upperBody:true,hands:false,mirror:false}];for(const config of configs){const reactive=new Proxy(config,{});const draft=initialTrackingDraft(reactive);expect(draft.config).toEqual(config);expect(draft.config).not.toBe(reactive);expect(draft.port).toBe(config.kind==='mediapipe'?'':String(config.port));expect(draft.address).toBe(config.kind==='ifacialmocap'?'192.168.1.2':'');draft.config.enabled=true;expect(config.enabled).toBe(false);expect(()=>reconcileDraft(null,{entityId:'source',revision:1},draft,initialTrackingDraft(reactive))).not.toThrow();}});});

it('lists newly authored cameras and current names without smoke fixtures or other asset kinds',()=>{
 const entities=[{id:'camera_main',kind:'camera',name:'Camera'},{id:'source',kind:'tracking',name:'VMC'},{id:'custom-camera',kind:'camera',name:'Stage left'}] as SceneEntity[];
 expect(cameraOptions(entities)).toEqual([{value:'camera_main',label:'Camera'},{value:'custom-camera',label:'Stage left'}]);
 entities[2].name='Stage right';expect(cameraOptions(entities).at(-1)?.label).toBe('Stage right');expect(cameraOptions([])).toEqual([]);
});
