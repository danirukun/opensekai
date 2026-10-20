import {expect,it} from 'vitest';
import {Worker} from 'node:worker_threads';
import {createHiddenCameras,type WorkerPort} from '../src/tracking/hidden-cameras';

// Boundary: a real worker thread runs the match code, and the store terminates it at the deadline.
// Node strips the TypeScript types of `hidden-cameras.ts`, which has no runtime imports.
const source=new URL('../src/tracking/hidden-cameras.ts',import.meta.url).href;
const spawn=():WorkerPort=>{
 const thread=new Worker(`const {parentPort}=require('node:worker_threads');import(${JSON.stringify(source)}).then(m=>{parentPort.on('message',d=>parentPort.postMessage(m.matchRequest(d)));parentPort.postMessage({ready:true});});`,{eval:true});
 const port:WorkerPort={onmessage:null,postMessage:message=>thread.postMessage(message),terminate:()=>{void thread.terminate();}};
 thread.on('message',data=>port.onmessage?.({data}));
 return port;
};
const devices=[{deviceId:'slow',label:`${'a'.repeat(127)}!`},{deviceId:'real',label:'FaceTime HD Camera'}];
const until=async(check:()=>boolean,limit=5000)=>{const end=Date.now()+limit;while(!check()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));};

it('shows every device and the alert when a pattern backtracks past the deadline, and matches again after a change',async()=>{
 const data=new Map<string,string>([['opensekai.tracking.hiddenCameras',JSON.stringify(['FaceTime'])]]);
 const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
 const store=createHiddenCameras({spawn,storage,deadline:200});
 try{
  store.setDevices(devices);
  await until(()=>store.state().hidden.length>0);
  expect(store.state()).toMatchObject({hidden:['real'],alert:null});
  const started=Date.now();
  store.setText('(a+)+$');
  await until(()=>store.state().alert!==null);
  expect(store.state()).toMatchObject({hidden:[],alert:'Patterns take too long.'});
  expect(Date.now()-started).toBeLessThan(3000);
  expect(data.get('opensekai.tracking.hiddenCameras')).toBe(JSON.stringify(['FaceTime']));
  store.setText('facetime');
  await until(()=>store.state().alert===null&&store.state().hidden.length>0);
  expect(store.state()).toMatchObject({hidden:['real'],alert:null});
 }finally{store.dispose();}
},15000);
