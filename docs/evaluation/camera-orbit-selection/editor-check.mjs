// Headless editor check of Camera Orbit Character and the main camera rule (B32 R1, R9, R11).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, and sends the clock.
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/camera-orbit-selection/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',PORT=4182,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
// One local server gives the built Editor window, the image bytes, and the WebSocket on one origin, as the host does.
// Playwright does not route a WebSocket that a Worker opens, so the stand-in is a real server.
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
const http=createServer(async (req,res)=>{
 const path=new URL(req.url,ORIGIN).pathname;
 try{const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':mime[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http,path:'/ws'});
await new Promise(resolve=>http.listen(PORT,'127.0.0.1',resolve));
// Since the one-window change (#254) the Editor window runs the session worker as the publisher. The stand-in host
// authenticates each role, relays operator calls to the publisher, relays frames to the preview renderer, and sends clocks.
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role,token:`token_${role}_${outputId??'none'}`,capabilities,outputId});
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[],fixtureMode:false,rendererMode:'auto'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(info=>{
 let next=1;const callbacks=new Map();
 window.__imports=[];
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'main'},currentWebview:{windowLabel:'main',label:'main'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command){
   if(command==='bootstrap_session')return info;
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},info);
let publisher=null,preview=null,shot=null,nextCall=1;
const pending=new Map(),calls=[];
// The status has the live revision, so the editor reloads the scene after a patch that the host sends, as the app does.
const status=async()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:(await refresh())?.revision??0,capabilities:['read','edit'],warnings:[],outputs:[]}});
// A call to the publisher, as the host router sends it.
const hostCall=async(method,params)=>{for(let i=0;!publisher&&i<200;i++)await new Promise(r=>setTimeout(r,50));if(!publisher)return {ok:false,error:{code:'UNAVAILABLE',message:'No publisher',ids:[]}};return new Promise(resolve=>{const requestId=`host_${nextCall++}`;pending.set(requestId,resolve);publisher.send(JSON.stringify({kind:'call',requestId,method,params}));});};
const begun=Date.now();
const clock=setInterval(()=>publisher?.send(JSON.stringify({kind:'clock',sessionId:SESSION,elapsedMs:Date.now()-begun})),16);
wss.on('connection',ws=>{
 let role=null;
 ws.on('message',async data=>{const text=String(data);
  const message=JSON.parse(String(text));
  if(message.kind==='auth'){
   role=message.role;if(role==='publisher')publisher=ws;if(role==='renderer'&&message.outputId==='preview_main')preview=ws;
   ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:role==='renderer'?['read']:['read','edit']}));return;
  }
  if(message.kind==='ping'){ws.send(JSON.stringify({kind:'pong',nonce:message.nonce}));return;}
  if(role==='publisher'&&message.kind==='reply'){const resolve=pending.get(message.requestId);pending.delete(message.requestId);resolve?.(message.result);return;}
  if(role==='publisher'&&message.kind==='frame'){preview?.send(text);return;}
  if(role==='renderer'&&message.kind==='screenshotReply'){shot=message.result;return;}
  if(role==='operator'&&message.kind==='call'){
   calls.push({method:message.method,params:message.params});
   const result=message.method==='appStatus'?await status():await hostCall(message.method,message.params);
   ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result}));
  }
 });
});
let inspected=null;
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId:'scene_smoke'});if(reply.ok)inspected=reply.data;return inspected;};
const scene=()=>inspected;
const patch=async operations=>{const current=await refresh();return hostCall('scenePatch',{sceneId:current.sceneId,expectedRevision:current.revision,operations});};
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const edits=()=>calls.filter(call=>call.method==='blueprintEdit');
const camera=id=>scene().entities.find(entity=>entity.id===id);

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await refresh();
const cameras=scene().entities.filter(entity=>entity.kind==='camera').map(entity=>entity.id);
const cameraId=cameras[0];
const placed=await patch([{kind:'setCameraNavigation',entityId:cameraId,navigation:{mode:'orbitCharacter',sensitivity:1,targetId:null,pivotOffset:[0,1.3,0]}}]);
const at=(x,y)=>({x,y});
const graph={schemaVersion:1,id:'orbit',name:'Orbit',enabled:true,variables:[],nodes:[
 {id:'go',version:1,type:'event.manual',settings:{},position:at(-260,40)},
 {id:'orbit',version:1,type:'camera.orbitCharacter',settings:{cameraId,transitionSeconds:3,easing:'InOutSine'},position:at(40,40),inputs:{yaw:45,pitch:10,distance:2.5}},
],connections:[{id:'a',sourceNodeId:'go',sourcePort:'flow',targetNodeId:'orbit',targetPort:'flow'}]};
const loaded=await hostCall('blueprintEdit',{clientId:'check',batchId:'load',ops:[{kind:'replaceAll',graphs:[graph]}]});
await settle(2500);
check('the camera is in Orbit Character mode and the graph loads',placed.ok&&loaded.ok,{placed,loaded:loaded.ok||loaded.error});
await page.getByTitle('Blueprints').click();
await settle(1000);
const node=page.locator('[data-testid=node]').filter({hasText:'Camera Orbit Character'});
await node.waitFor({timeout:10000});
const inputs=(await node.locator('.bp-port.input span').allTextContents()).map(t=>t.trim()).filter(Boolean);
check('R1: the node shows Yaw (°), Pitch (°), and Distance (m)',['Yaw (°)','Pitch (°)','Distance (m)'].every(text=>inputs.includes(text)),inputs);
const outputs=(await node.locator('.bp-port.output span').allTextContents()).map(t=>t.trim()).filter(Boolean);
check('R1: the node shows the On Transition End output',outputs.includes('On Transition End'),outputs);
const fields=node.locator('.bp-inline input[type=number]');
const values=async()=>Promise.all([0,1,2].map(async i=>Number(await fields.nth(i).inputValue())));
const previous=await values();
await refresh();
const committed=camera(cameraId).transform.position;
let before=edits().length;
await node.getByRole('button',{name:'Use current value'}).click();
await settle(800);
const batches=edits().slice(before);
const sent=batches.flatMap(call=>call.params.ops);
check('R9: Use current value sends one edit with three setNodeInput operations',batches.length===1&&sent.length===3&&sent.every(op=>op.kind==='setNodeInput'),sent);
const now=await values();
// The expected orbit of the committed camera around the pivot (0, 1.3, 0), recomputed here.
const offset=[committed[0],committed[1]-1.3,committed[2]];
const length=Math.hypot(...offset);
const expected=[Math.round(Math.atan2(offset[0],offset[2])*1800/Math.PI)/10,Math.round(Math.asin(offset[1]/length)*1800/Math.PI)/10,Math.round(length*100)/100];
check('R9: the inline values show the current Yaw, Pitch, and Distance',now.every((value,i)=>Math.abs(value-expected[i])<1e-9),{previous,now,expected,committed});
await page.screenshot({path:out+'/orbit-use-current-value.png'});
await node.click({position:{x:20,y:10}});
await page.keyboard.press('Control+z');
await settle(800);
const restored=await values();
check('R9: one undo step restores the three previous values',JSON.stringify(restored)===JSON.stringify(previous),{previous,restored});
// A Camera Orbit Character node on a camera that is not in Orbit Character mode: the button is disabled.
await patch([{kind:'setCameraNavigation',entityId:cameraId,navigation:{mode:'freeLook',sensitivity:1}}]);
await settle(800);
check('R9: the button is disabled when the camera is not in Orbit Character mode',await node.getByRole('button',{name:'Use current value'}).isDisabled());

// The main camera rule: a second camera and a Switch Camera node on output_main.
await patch([{kind:'createEntity',entity:{...structuredClone(camera(cameraId)),id:'camera_second',name:'Second',navigation:undefined}}]);
const cut={schemaVersion:1,id:'cut',name:'Cut',enabled:true,variables:[],nodes:[
 {id:'go',version:1,type:'event.manual',settings:{},position:at(-260,40)},
 {id:'switch',version:1,type:'camera.switch',settings:{outputId:'output_main',cameraId:'camera_second'},position:at(40,40)},
],connections:[{id:'a',sourceNodeId:'go',sourcePort:'flow',targetNodeId:'switch',targetPort:'flow'}]};
const added=await hostCall('blueprintEdit',{clientId:'check',batchId:'cut',ops:[{kind:'createGraph',graph:cut}]});
const revision=(await refresh()).revision;
const ran=await hostCall('blueprintRun',{graphId:'cut',triggerNodeId:'go'});
await settle(800);
const after=await refresh();
check('R11: Switch Camera on output_main sets output_main and preview_main in one revision',added.ok&&ran.ok&&after.revision===revision+1&&after.outputs.every(output=>output.cameraId==='camera_second'),{added:added.ok||added.error,ran,revision,after:after.revision,outputs:after.outputs.map(output=>[output.id,output.cameraId])});
check('no page error',errors.length===0,errors);

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
