import type {SceneEntity} from '@opensekai/contracts';
import {ARKIT_NAMES,DEFAULT_TRACKING_MAPPING} from '@opensekai/contracts';
import {describe,it,expect} from 'vitest';
import {mappingDraft,parseMappingDraft,sourceOptions,withSource} from '../src/editor/live-fields';

const base={visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},generation:0};
const source=(id:string,kind:'vmc'|'ifacialmocap'|'mediapipe')=>({...base,id,name:id,kind:'tracking',config:{kind}});
const avatar=(id:string,tracking:{bodySourceId:string|null;faceSourceId:string|null;fingersSourceId?:string|null})=>({...base,id,name:id,kind:'avatar',assetId:null,tracking});

describe('finger source select',()=>{
 const entities=[source('vmc-a','vmc'),source('vmc-b','vmc'),source('camera','mediapipe'),source('phone','ifacialmocap'),avatar('a',{bodySourceId:'vmc-a',faceSourceId:null,fingersSourceId:'camera'}),avatar('b',{bodySourceId:'vmc-b',faceSourceId:null})] as SceneEntity[];
 const disabled=(channel:'body'|'face'|'fingers',id:string)=>sourceOptions(entities,channel,id).filter(x=>x.disabled).map(x=>x.value);
 it('lists VMC and MediaPipe sources, not iFacialMocap',()=>{expect(sourceOptions(entities,'fingers','a').map(x=>x.value)).toEqual(['','vmc-a','vmc-b','camera']);});
 it('disables a source in the finger slot of the other character in each select',()=>{
  expect(disabled('body','b')).toEqual(['vmc-a','camera']);
  expect(disabled('face','b')).toEqual(['vmc-a','camera']);
  expect(disabled('fingers','b')).toEqual(['vmc-a','camera']);
  expect(disabled('fingers','a')).toEqual(['vmc-b']);
 });
 it('keeps the finger ID when the body source changes, and leaves an empty finger slot out',()=>{
  expect(withSource({bodySourceId:'vmc-a',faceSourceId:'phone',fingersSourceId:'camera'},'body','vmc-b')).toEqual({bodySourceId:'vmc-b',faceSourceId:'phone',fingersSourceId:'camera'});
  expect(withSource({bodySourceId:'vmc-a',faceSourceId:'phone',fingersSourceId:'camera'},'fingers','')).toEqual({bodySourceId:'vmc-a',faceSourceId:'phone'});
  expect(withSource(undefined,'fingers','camera')).toEqual({bodySourceId:null,faceSourceId:null,fingersSourceId:'camera'});
 });
});

describe('face mapping draft',()=>{
 it('shows a row for each ARKit name with the default range, and an untouched row commits nothing',()=>{
  const draft=mappingDraft(undefined);
  expect(Object.keys(draft.blendShapes)).toEqual([...ARKIT_NAMES]);
  expect(draft.blendShapes.jawOpen).toEqual({inputMin:'0',inputMax:'1',outputMin:'0',outputMax:'1'});
  expect(parseMappingDraft(draft,new Set())).toEqual(DEFAULT_TRACKING_MAPPING);
 });
 it('parses the changed fields and only the named ranges',()=>{
  const draft=mappingDraft({...DEFAULT_TRACKING_MAPPING,blendShapes:{eyeBlinkLeft:{inputMin:.2,inputMax:.8,outputMin:0,outputMax:1}}});
  draft.headIntensity='1.5';draft.headOffset=['0','15','-5'];draft.linkedBlink=true;draft.blendShapes.jawOpen!.outputMax='0';
  expect(parseMappingDraft(draft,new Set(['eyeBlinkLeft','jawOpen']))).toEqual({...DEFAULT_TRACKING_MAPPING,headIntensity:1.5,headOffset:[0,15,-5],linkedBlink:true,blendShapes:{eyeBlinkLeft:{inputMin:.2,inputMax:.8,outputMin:0,outputMax:1},jawOpen:{inputMin:0,inputMax:1,outputMin:0,outputMax:0}}});
  expect(parseMappingDraft(draft,new Set(['jawOpen']))?.blendShapes).toEqual({jawOpen:{inputMin:0,inputMax:1,outputMin:0,outputMax:0}});
 });
 it('rejects an empty or out-of-range field',()=>{
  for(const change of [(d:ReturnType<typeof mappingDraft>)=>{d.headIntensity='';},d=>{d.eyeIntensity='2.5';},d=>{d.headOffset[1]='91';},d=>{d.blendShapeSensitivity='x';},d=>{d.blendShapes.jawOpen!.inputMin='1';}] as ((d:ReturnType<typeof mappingDraft>)=>void)[]){
   const draft=mappingDraft(undefined);change(draft);expect(parseMappingDraft(draft,new Set(['jawOpen']))).toBeNull();
  }
 });
});
