import {describe,expect,it} from 'vitest';
import {checkPatterns,matchLabels,visibleCameras,loadHiddenCameras,saveHiddenCameras,fitDevices,createHiddenCameras,DEFAULT_HIDDEN_CAMERAS,HIDDEN_CAMERAS_KEY,matchRequest,type WorkerPort} from '../src/tracking/hidden-cameras';
import {parseUIMessage} from '../src/editor/ui-message';

const memory=(value:string|null=null)=>{const data=new Map<string,string>();if(value!==null)data.set(HIDDEN_CAMERAS_KEY,value);return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,next:string)=>{data.set(key,next);}};};
const broken={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}};

describe('hidden camera patterns',()=>{
 it('matches a plain name or a regex, case-insensitive and unanchored, and never an empty label',()=>{
  expect(matchLabels(['vseeface','^OBS .*Camera$'],['VSeeFace Camera','OBS Virtual Camera','FaceTime HD Camera',''])).toEqual([true,true,false,false]);
  expect(matchLabels(['.'],[''])).toEqual([false]);
 });
 it('ignores empty lines and spaces and reports the first invalid line',()=>{
  expect(checkPatterns('  VMC  \n\n[bad\n.*\na|\nOK')).toEqual({patterns:['VMC','OK'],invalidLine:3});
  expect(checkPatterns('')).toEqual({patterns:[],invalidLine:null});
 });
 it('does not use a pattern over 128 characters or after the 32nd',()=>{
  expect(checkPatterns(`a\n${'b'.repeat(129)}`)).toEqual({patterns:['a'],invalidLine:2});
  const lines=Array.from({length:33},(_,index)=>`cam${index}`);
  expect(checkPatterns(['',...lines].join('\n'))).toEqual({patterns:lines.slice(0,32),invalidLine:34});
 });
 it('keeps the selected device visible and the order',()=>{
  const devices=[{deviceId:'a',label:'VSeeFace'},{deviceId:'b',label:'Real'},{deviceId:'c',label:'VMC'}];
  expect(visibleCameras(devices,['a','c'],'')).toEqual([devices[1]]);
  expect(visibleCameras(devices,['a','c'],'c')).toEqual([devices[1],devices[2]]);
 });
});

describe('hidden camera storage',()=>{
 it('gives the defaults for a missing, unparsable, wrong-shape, or failing store',()=>{
  for(const value of [null,'{',JSON.stringify({a:1}),'"VMC"'])expect(loadHiddenCameras(memory(value))).toEqual(DEFAULT_HIDDEN_CAMERAS);
  expect(loadHiddenCameras(memory(JSON.stringify([1,' ','x'.repeat(129),'VMC'])))).toEqual(['VMC']);
  expect(loadHiddenCameras(memory(JSON.stringify(Array.from({length:33},(_,index)=>`cam${index}`))))).toHaveLength(32);
  expect(loadHiddenCameras(broken)).toEqual(DEFAULT_HIDDEN_CAMERAS);
  expect(loadHiddenCameras(null)).toEqual(DEFAULT_HIDDEN_CAMERAS);
  expect(()=>saveHiddenCameras(broken,['x'])).not.toThrow();
 });
 it('round-trips a saved list',()=>{const storage=memory();saveHiddenCameras(storage,['obs']);expect(loadHiddenCameras(storage)).toEqual(['obs']);});
});

describe('fitDevices',()=>{
 it('keeps at most 16 devices and stops before the message passes 4096 bytes',()=>{
  expect(fitDevices(Array.from({length:20},(_,index)=>({deviceId:`${index}`,label:'Camera'})))).toHaveLength(16);
  const long=Array.from({length:16},(_,index)=>({deviceId:`${index}`.padEnd(512,'x'),label:'Camera'}));
  const fitted=fitDevices(long);
  expect(fitted).toEqual(long.slice(0,fitted.length));
  expect(fitted.length).toBeLessThan(16);
  expect(parseUIMessage({kind:'trackingDevices',devices:fitted})).not.toBeNull();
  expect(parseUIMessage({kind:'trackingDevices',devices:long.slice(0,fitted.length+1)})).toBeNull();
 });
});

// An in-process port: replies on the next task, or never when `stall` is set.
// It posts ready after `load` ms, like a module Worker.
const fakeWorker=(stall=false,load=0)=>{const made:{terminated:boolean}[]=[];return {made,spawn:():WorkerPort=>{const record={terminated:false};made.push(record);const port:WorkerPort={onmessage:null,postMessage:message=>{if(!stall)setTimeout(()=>{if(!record.terminated)port.onmessage?.({data:matchRequest(message as never)});});},terminate:()=>{record.terminated=true;}};setTimeout(()=>{if(!record.terminated)port.onmessage?.({data:{ready:true}});},load);return port;}};};
const settle=()=>new Promise(resolve=>setTimeout(resolve,5));

describe('createHiddenCameras',()=>{
 const devices=[{deviceId:'a',label:'VSeeFace Camera'},{deviceId:'b',label:'OBS Virtual Camera'},{deviceId:'c',label:''}];
 it('hides matches, saves only valid patterns, and restores the defaults',async()=>{
  const storage=memory(),worker=fakeWorker(),store=createHiddenCameras({spawn:worker.spawn,storage});
  store.setDevices(devices);await settle();
  expect(store.state().hidden).toEqual(['a']);
  store.setText(`${store.state().text}\nobs\n[`);await settle();
  expect(store.state()).toMatchObject({hidden:['a','b'],alert:'Line 7 is not used.'});
  expect(JSON.parse(storage.data.get(HIDDEN_CAMERAS_KEY)!)).toEqual([...DEFAULT_HIDDEN_CAMERAS,'obs']);
  expect(store.state().text.endsWith('obs\n[')).toBe(true);
  store.restoreDefaults();await settle();
  expect(store.state()).toMatchObject({hidden:['a'],alert:null,text:DEFAULT_HIDDEN_CAMERAS.join('\n')});
  expect(worker.made).toHaveLength(1);
 });
 it('does not count a slow Worker start against the deadline, and a failed start shows every device',async()=>{
  const worker=fakeWorker(false,40),store=createHiddenCameras({spawn:worker.spawn,storage:memory(),deadline:10});
  store.setDevices(devices);store.setText('VSeeFace\nobs');await new Promise(resolve=>setTimeout(resolve,60));
  expect(store.state()).toMatchObject({hidden:['a','b'],alert:null});
  expect(worker.made).toHaveLength(1);
  const failing=createHiddenCameras({spawn:()=>{throw new Error('no worker');},storage:memory(),deadline:10});
  expect(()=>failing.setDevices(devices)).not.toThrow();
  expect(failing.state()).toMatchObject({hidden:[],alert:null});
 });
 it('shows every device and the alert after the deadline, keeps the saved list, and starts a new Worker on the next change',async()=>{
  const storage=memory(JSON.stringify(['VSeeFace'])),worker=fakeWorker(true),store=createHiddenCameras({spawn:worker.spawn,storage,deadline:10});
  store.setDevices(devices);await new Promise(resolve=>setTimeout(resolve,30));
  expect(store.state()).toMatchObject({hidden:[],alert:'Patterns take too long.'});
  expect(worker.made[0]!.terminated).toBe(true);
  store.setText('slow');await new Promise(resolve=>setTimeout(resolve,30));
  expect(worker.made).toHaveLength(2);
  expect(storage.data.get(HIDDEN_CAMERAS_KEY)).toBe(JSON.stringify(['VSeeFace']));
 });
});
