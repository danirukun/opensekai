import {expect,it} from 'vitest';
import {makeSmokeScene,type AppError,type CaptureSource,type SceneEntity,type ScreenCapture} from '@opensekai/contracts';
import {makeAuthoringEntity} from '../src/editor/authoring';
import {changedFields,defaultsFor,resetFieldIds} from '../src/editor/property-defaults';
import {sectionsFor} from '../src/editor/inspector-sections';
import {captureLimitReached,contentKind,contentOptions,duplicateLimitReached} from '../src/editor/screen';
import {captureMessage,captureState,chooseSource,parseSourceList,sourceDescription,sourceForValue,sourceOptions,startCapture} from '../src/editor/capture';
// B31 R17: the Display and Window content of a screen in the Inspector.
const display:CaptureSource={kind:'display',name:'Built-in Retina Display',ordinal:0};
const second:CaptureSource={kind:'display',name:'DELL U2720Q',ordinal:1};
const chat:CaptureSource={kind:'window',app:'com.example.chat',title:'Chat — Stream'};
const capture=(value:Partial<ScreenCapture>={}):ScreenCapture=>({target:'display',source:display,cursor:true,...value});
const captureScreen=(id:string,value=capture()):SceneEntity=>({...makeAuthoringEntity('screen',id,[]),id,content:{kind:'capture',...value}} as SceneEntity);
const list=[{source:display,label:'Built-in Retina Display',width:3024,height:1964},{source:second,label:'DELL U2720Q (2)',width:3840,height:2160},{source:chat,label:'Chat — Chat — Stream',width:800,height:600}];
it('shows capture content as Display or Window and disables both at the capture limit, unless the screen has capture content',()=>{
 const scene:SceneEntity[]=[...makeSmokeScene().entities,captureScreen('c0')];
 expect(contentKind({kind:'capture',...capture({target:'window',source:null})})).toBe('window');
 expect(contentOptions('image',scene).filter(o=>o.disabled)).toEqual([]);
 scene.push(captureScreen('c1',capture({target:'window',source:null})));
 expect(captureLimitReached(scene)).toBe(true);
 expect(contentOptions('image',scene).filter(o=>o.disabled).map(o=>o.label)).toEqual(['Display','Window']);
 expect(contentOptions('display',scene).filter(o=>o.disabled)).toEqual([]);
 expect(contentOptions('window',scene).filter(o=>o.disabled)).toEqual([]);
 expect(duplicateLimitReached(scene.at(-1)!,scene)).toBe(true);
 expect(duplicateLimitReached(scene.at(-1)!,scene.slice(0,-1))).toBe(false);
});
it('starts a Content change with no source and the cursor on',()=>{
 expect(startCapture('display')).toEqual({target:'display',source:null,cursor:true});
 expect(startCapture('window')).toEqual({target:'window',source:null,cursor:true});
});
it('lists only the sources of the target kind, after the empty option',()=>{
 const displays=sourceOptions('display',null,list);
 expect(displays.options.map(o=>o.label)).toEqual(['Choose display…','Built-in Retina Display','DELL U2720Q (2)']);
 expect(displays).toMatchObject({value:'',missing:false});
 const windows=sourceOptions('window',chat,list);
 expect(windows.options.map(o=>o.label)).toEqual(['Choose window…','Chat — Chat — Stream']);
 expect(sourceForValue(windows.value,list)).toEqual(chat);
 expect(windows.missing).toBe(false);
});
it('shows a saved source that is not in the list with its description',()=>{
 const gone:CaptureSource={kind:'window',app:'com.example.notes',title:'Set list'};
 const select=sourceOptions('window',gone,list);
 expect(select.missing).toBe(true);
 expect(select.options.at(-1)).toEqual({value:select.value,label:'com.example.notes — Set list'});
 expect(sourceForValue(select.value,list)).toBeNull();
 expect([sourceDescription(display),sourceDescription(second),sourceDescription({kind:'window',app:'com.example.chat',title:''})]).toEqual(['Built-in Retina Display','DELL U2720Q (2)','com.example.chat']);
});
it('allows a chosen source before it sends the patch, and sends no patch when the allow fails',async()=>{
 const calls:string[]=[];
 const ports={allow:async(source:CaptureSource)=>{calls.push(`allow ${source.kind}`);},commit:async(next:ScreenCapture)=>{calls.push(`commit ${JSON.stringify(next)}`);return {ok:true as const,data:{}};}};
 await chooseSource(ports,capture({target:'window',source:null,cursor:false}),chat);
 expect(calls).toEqual(['allow window',`commit ${JSON.stringify({target:'window',source:chat,cursor:false})}`]);
 calls.length=0;
 await chooseSource(ports,capture(),null);
 expect(calls).toEqual([`commit ${JSON.stringify({target:'display',source:null,cursor:true})}`]);
 calls.length=0;
 await expect(chooseSource({...ports,allow:async()=>{throw new Error('denied');}},capture(),second)).rejects.toThrow('denied');
 expect(calls).toEqual([]);
});
it('reads the source list reply and drops entries that fail the source rule',()=>{
 expect(parseSourceList({sources:list,error:null}).sources).toHaveLength(3);
 expect(parseSourceList({sources:[...list,{source:{kind:'display',name:' bad',ordinal:0},label:'Bad',width:1,height:1}],error:null}).sources).toHaveLength(3);
 expect(parseSourceList({sources:[],error:'Screen Recording permission needed'})).toEqual({sources:[],error:'Screen Recording permission needed'});
 expect(parseSourceList(null)).toEqual({sources:[],error:null});
});
it('reads the preview_main message and the host state of one screen',()=>{
 const warnings:AppError[]=[{code:'UNAVAILABLE',message:'Capture: Source hidden',ids:['c0']},{code:'UNAVAILABLE',message:'Video: Could not play',ids:['c1']}];
 expect(captureMessage('c0',warnings)).toBe('Source hidden');
 expect(captureMessage('c1',warnings)).toBeNull();
 expect(captureState('c0',{captures:[{entityId:'c0',state:'notAllowed'}]})).toBe('notAllowed');
 expect(captureState('c1',null)).toBeNull();
});
it('resets Content to Image and Show Cursor to on (B17), in the Screen section',()=>{
 const screen=captureScreen('c',capture({cursor:false}));
 expect(resetFieldIds(screen)).toEqual(['visible','position','rotation','scale','content','cursor']);
 expect(defaultsFor(screen)).toMatchObject({content:'image',cursor:true});
 expect([...changedFields(screen)]).toEqual(['content','cursor']);
 expect([...changedFields(captureScreen('c'))]).toEqual(['content']);
 expect(sectionsFor(screen,{expressions:false}).map(section=>section.id)).toEqual(['transform','screen']);
});
