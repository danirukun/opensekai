// Headless check of the capture screen fields in the Editor window (B31 R17, Operation 5).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands, with a stubbed
// capture_source_list, capture_source_allow, and open_capture_settings, and routes the operator WebSocket to a real
// @opensekai/session in this process (the method of the B28 and B30 checks). No capture runs: the host state
// (app_status captures) and the preview_main warning are stand-ins, so this check covers the editor flow only.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/capture-screens/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const {PNG}=createRequire(process.cwd()+'/package.json')('pngjs');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

// 64 x 32: the left half opaque red, the right half transparent, with a green strip of alpha 128.
const png=new PNG({width:64,height:32});
for(let y=0;y<32;y++)for(let x=0;x<64;x++)png.data.set(x<32?[255,0,0,255]:x>=44&&x<56?[0,255,0,128]:[0,0,0,0],(y*64+x)*4);
const bytes=PNG.sync.write(png);
const sha256=createHash('sha256').update(bytes).digest('hex');
const record={id:`image_${sha256}`,format:'png',sha256,bytes:bytes.length,sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,name:'Sign',expressions:[],image:{width:64,height:32,frames:1}};

const SESSION='session_check',PORT=4191,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
// One local server gives the built Editor window, the image bytes, and the WebSocket on one origin, as the host does.
// Playwright does not route a WebSocket that a Worker opens, so the stand-in is a real server.
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
let served=0;
const http=createServer(async (req,res)=>{
 const path=new URL(req.url,ORIGIN).pathname;
 if(/^\/assets\/image_[0-9a-f]{64}$/.test(path)){
  if(path.endsWith(record.id)){served++;res.writeHead(200,{'content-type':'image/png','x-content-type-options':'nosniff','content-length':bytes.length});res.end(bytes);}
  else{res.writeHead(404);res.end();}
  return;
 }
 try{const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':mime[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http,path:'/ws'});
await new Promise(resolve=>http.listen(PORT,'127.0.0.1',resolve));
// Since the one-window change (#254) the Editor window runs the session worker as the publisher. The stand-in host
// authenticates each role, relays operator calls to the publisher, relays frames to the preview renderer, and sends clocks.
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role,token:`token_${role}_${outputId??'none'}`,capabilities,outputId});
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[record],fixtureMode:false,rendererMode:'auto'};

// The stubbed host: one ordered log of the capture commands and the scene patches, so the allow-then-patch order shows.
const display={kind:'display',name:'Built-in Retina Display',ordinal:0},second={kind:'display',name:'DELL U2720Q',ordinal:0};
const chat={kind:'window',app:'com.example.chat',title:'Chat — Stream'};
const host={sources:[{source:display,label:'Built-in Retina Display',width:3024,height:1964},{source:second,label:'DELL U2720Q',width:3840,height:2160},{source:chat,label:'Chat — Chat — Stream',width:800,height:600}],error:null};
const events=[],allowed=[];let listCalls=0;
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.exposeBinding('__capture',(_,command,args)=>{
 events.push(command);
 if(command==='capture_source_list'){listCalls++;return JSON.parse(JSON.stringify(host));}
 if(command==='capture_source_allow'){allowed.push(JSON.stringify(args.source));return null;}
 return null;
});
await context.addInitScript(info=>{
 let next=1;const callbacks=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'main'},currentWebview:{windowLabel:'main',label:'main'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   if(command==='bootstrap_session')return info;
   if(command.startsWith('capture_')||command==='open_capture_settings')return window.__capture(command,args??{});
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},info);
let publisher=null,preview=null,nextCall=1;
const pending=new Map(),calls=[];
// The host state of each capture screen: a source that the stand-in did not allow is notAllowed (R5, R9).
const hostState=()=>(inspected?.entities??[]).filter(e=>e.kind==='screen'&&e.content.kind==='capture').map(e=>({entityId:e.id,state:e.content.source===null?'idle':allowed.includes(JSON.stringify(e.content.source))?'live':'notAllowed'}));
let previewWarnings=[];
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:inspected?.revision??0,capabilities:['read','edit'],warnings:[],captures:hostState(),outputs:[{outputId:'preview_main',connected:true,lastFrame:previewWarnings.length?{sessionId:SESSION,outputId:'preview_main',sequence:1,tick:1,revision:inspected?.revision??0,cameraId:'camera_main',backend:'webgl2',cpuMs:1,gpuMs:null,warnings:previewWarnings}:null}]}});
const hostCall=async(method,params)=>{for(let i=0;!publisher&&i<200;i++)await new Promise(r=>setTimeout(r,50));if(!publisher)return {ok:false,error:{code:'UNAVAILABLE',message:'No publisher',ids:[]}};return new Promise(resolve=>{const requestId=`host_${nextCall++}`;pending.set(requestId,resolve);publisher.send(JSON.stringify({kind:'call',requestId,method,params}));});};
const begun=Date.now();
const clock=setInterval(()=>publisher?.send(JSON.stringify({kind:'clock',sessionId:SESSION,elapsedMs:Date.now()-begun})),16);
wss.on('connection',ws=>{
 let role=null;
 ws.on('message',async data=>{const text=String(data);
  const message=JSON.parse(text);
  if(message.kind==='auth'){
   role=message.role;if(role==='publisher')publisher=ws;if(role==='renderer'&&message.outputId==='preview_main')preview=ws;
   ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:role==='renderer'?['read']:['read','edit']}));return;
  }
  if(message.kind==='ping'){ws.send(JSON.stringify({kind:'pong',nonce:message.nonce}));return;}
  if(role==='publisher'&&message.kind==='reply'){const resolve=pending.get(message.requestId);pending.delete(message.requestId);resolve?.(message.result);return;}
  if(role==='publisher'&&message.kind==='frame'){preview?.send(text);return;}
  if(role==='operator'&&message.kind==='call'){
   calls.push({method:message.method,params:message.params});
   if(message.method==='scenePatch')events.push('scenePatch '+message.params.operations.map(o=>o.kind).join(','));
   const result=message.method==='appStatus'?status():await hostCall(message.method,message.params);
   ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result}));
  }
 });
});
let inspected=null;
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId:'scene_smoke'});if(reply.ok)inspected=reply.data;return inspected;};
const scene=()=>inspected;
const patch=async operations=>{const current=await refresh();const reply=await hostCall('scenePatch',{sceneId:current.sceneId,expectedRevision:current.revision,operations});await refresh();return reply;};
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const screens=()=>scene().entities.filter(entity=>entity.kind==='screen');
const patches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations);
const content=()=>page.locator('.inspector select').first();
const source=()=>page.locator('.screen-capture select').first();
// The select opens with a pointer press; the field loads the list again then.
const openSource=async()=>{await source().dispatchEvent('pointerdown');await settle(800);};
const fieldText=async()=>(await page.locator('.screen-capture').textContent())??'';

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
const addButton=page.locator('.asset-actions button').first();
const addScreen=async()=>{await addButton.click();await settle(300);const items=(await page.locator('[role=menu] [role=menuitem], .context-menu button').allTextContents()).map(t=>t.trim());await page.locator('[role=menu] [role=menuitem], .context-menu button').nth(items.indexOf('Screen')).click();await settle();await refresh();};
await addScreen();
const id=screens()[0].id;
const kinds=(await content().locator('option').allTextContents()).map(t=>t.trim());
check('R17: Content has Display and Window after Video and Web page',JSON.stringify(kinds)==='["Image","Video","Web page","Display","Window"]',kinds);
let before=patches().length;
await content().selectOption('display');
await settle(1000);await refresh();
check('R17: Display sends setScreenCapture with target display, no source, and the cursor on',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenCapture',entityId:id,capture:{target:'display',source:null,cursor:true}}]),patches().slice(before));
check('R17: the source list loads when Content changes',listCalls>=1,listCalls);
let options=(await source().locator('option').allTextContents()).map(t=>t.trim());
check('R17: Source lists the displays only, after Choose display…',JSON.stringify(options)==='["Choose display…","Built-in Retina Display","DELL U2720Q"]',options);
const labels=(await page.locator('.screen-capture label').allTextContents()).map(t=>t.trim()).filter(Boolean);
check('R17: the fields are Source and Show Cursor',labels.some(l=>l.startsWith('Source'))&&labels.some(l=>l.startsWith('Show Cursor')),labels);
// The list loads again when the select opens.
const opened=listCalls;await openSource();
check('R17: the source list loads when the select opens',listCalls>opened,{before:opened,after:listCalls});
// A source choice allows the source first, then sends setScreenCapture.
events.length=0;before=patches().length;
const value=await source().locator('option',{hasText:'DELL U2720Q'}).getAttribute('value');
await source().selectOption(value);await settle(1000);await refresh();
const order=events.filter(e=>e!=='capture_source_list');
check('R5, R17: capture_source_allow comes before the patch',order[0]==='capture_source_allow'&&order[1]==='scenePatch setScreenCapture'&&allowed.at(-1)===JSON.stringify(second),order);
check('R17: the patch has the chosen source',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenCapture',entityId:id,capture:{target:'display',source:second,cursor:true}}]),patches().slice(before));
// Show Cursor.
before=patches().length;
await page.locator('.screen-capture input[type=checkbox]').uncheck();await settle(800);await refresh();
check('R17: Show Cursor sends cursor false with the source unchanged',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenCapture',entityId:id,capture:{target:'display',source:second,cursor:false}}]),patches().slice(before));
// Display to Window clears the source.
before=patches().length;
await content().selectOption('window');await settle(1000);await refresh();
check('R17: Window sends target window with no source',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenCapture',entityId:id,capture:{target:'window',source:null,cursor:true}}]),patches().slice(before));
options=(await source().locator('option').allTextContents()).map(t=>t.trim());
check('R17: Source lists the windows only, after Choose window…',JSON.stringify(options)==='["Choose window…","Chat — Chat — Stream"]',options);
// A saved source that the operator did not allow in this run (an opened show): description and Allow (R5, R20).
const gone={kind:'window',app:'com.example.notes',title:'Set list'};
await patch([{kind:'setScreenCapture',entityId:id,capture:{target:'window',source:chat,cursor:true}}]);
allowed.length=0;
await page.locator(`button[data-asset-id="${id}"]`).click();await settle(2500);
let text=await fieldText();
check('R17, R20: a saved source in the state notAllowed shows its description and Allow',text.includes('com.example.chat — Chat — Stream')&&(await page.locator('.screen-capture button',{hasText:'Allow'}).count())===1,text);
events.length=0;
await page.locator('.screen-capture button',{hasText:'Allow'}).click();await settle(2500);
check('R17: Allow calls capture_source_allow with the saved source and sends no patch',JSON.stringify(events.filter(e=>e!=='capture_source_list'))==='["capture_source_allow"]'&&allowed[0]===JSON.stringify(chat),events);
check('R17: after the allow, the host state is live and Allow goes',(await page.locator('.screen-capture button',{hasText:'Allow'}).count())===0);
// The preview_main message (R15).
previewWarnings=[{code:'UNAVAILABLE',message:'Capture: Source hidden',ids:[id]}];
await settle(2500);
check('R15: the Inspector shows the preview_main message',(await fieldText()).includes('Source hidden'),await fieldText());
previewWarnings=[];
// A saved source that is not in the list.
await patch([{kind:'setScreenCapture',entityId:id,capture:{target:'window',source:gone,cursor:true}}]);allowed.push(JSON.stringify(gone));
await settle(2000);await openSource();
text=await fieldText();
options=(await source().locator('option').allTextContents()).map(t=>t.trim());
check('R17: a saved source that is not in the list shows its description with Source not found',options.at(-1)==='com.example.notes — Set list'&&text.includes('Source not found'),{options,text});
// The permission error and Open Settings.
host.error='Screen Recording permission needed';host.sources=[];
await openSource();
text=await fieldText();
check('R17: a list error shows under the select with Open Settings',text.includes('Screen Recording permission needed')&&(await page.locator('.screen-capture button',{hasText:'Open Settings'}).count())===1,text);
events.length=0;
await page.locator('.screen-capture button',{hasText:'Open Settings'}).click();await settle(400);
check('R17: Open Settings calls open_capture_settings',events.includes('open_capture_settings'),events);
host.error='Capture not supported on this platform';
await openSource();
check('R17: the unsupported error shows without Open Settings',(await fieldText()).includes('Capture not supported on this platform')&&(await page.locator('.screen-capture button',{hasText:'Open Settings'}).count())===0);
host.error=null;host.sources=[{source:display,label:'Built-in Retina Display',width:3024,height:1964},{source:chat,label:'Chat — Chat — Stream',width:800,height:600}];
await openSource();
await page.screenshot({path:out+'/editor-inspector-capture.png'});
// The reset marks: Content and Show Cursor.
await patch([{kind:'setScreenCapture',entityId:id,capture:{target:'window',source:chat,cursor:false}}]);await settle(1500);
const marks=await page.locator('.inspector .reset-mark').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')??b.getAttribute('title')));
check('R17: reset marks show for Content and Show Cursor',['Content','Show Cursor'].every(l=>marks.some(m=>m?.includes(l))),marks);
before=patches().length;
await page.locator('.inspector .reset-mark[title*="Show Cursor"]').first().click();await settle(800);
check('R17: the Show Cursor reset sends cursor true',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenCapture',entityId:id,capture:{target:'window',source:chat,cursor:true}}]),patches().slice(before));
before=patches().length;
await page.locator('.inspector .reset-mark[title*="Content"]').first().click();await settle(800);await refresh();
check('R17: the Content reset sends setScreenImage with null',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenImage',entityId:id,assetId:null}]),patches().slice(before));
// The capture screen limit: 2 capture screens; Display and Window are disabled on another screen, and Duplicate on a capture screen.
const cap=n=>({id:`capture_${n}`,name:`Capture ${n}`,visible:true,transform:{position:[n,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'screen',content:{kind:'capture',target:'display',source:null,cursor:true}});
await patch([0,1].map(n=>({kind:'createEntity',entity:cap(n)})));
await settle(1000);
await page.locator(`button[data-asset-id="${id}"]`).click();await settle();
const off=await content().locator('option[value=display], option[value=window]').evaluateAll(list=>list.map(o=>o.disabled));
check('R17: Display and Window are disabled on an image screen at the capture limit',JSON.stringify(off)==='[true,true]',off);
await page.locator('button[data-asset-id="capture_0"]').click();await settle();
const own=await content().locator('option[value=display], option[value=window]').evaluateAll(list=>list.map(o=>o.disabled));
check('R17: Display and Window stay enabled on a capture screen at the limit',JSON.stringify(own)==='[false,false]',own);
await page.locator('button[data-asset-id="capture_0"]').click({button:'right'});await settle(300);
const dup=page.locator('[role=menu] [role=menuitem], .context-menu button').filter({hasText:'Duplicate'});
check('R17: Duplicate is disabled for a capture screen at the limit',await dup.isDisabled(),await dup.count());
await page.keyboard.press('Escape');
await page.locator(`button[data-asset-id="${id}"]`).click({button:'right'});await settle(300);
const dupImage=page.locator('[role=menu] [role=menuitem], .context-menu button').filter({hasText:'Duplicate'});
check('R17: Duplicate stays enabled for an image screen at the capture limit',!(await dupImage.isDisabled()),await dupImage.count());
await page.keyboard.press('Escape');
check('no page error',errors.length===0,errors);
clearInterval(clock);
await browser.close();http.close();wss.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} of ${results.length} pass`);
process.exit(failed?1:0);
