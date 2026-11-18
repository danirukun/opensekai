// Headless check of the M1 alert place in the Inspector (B34b light limits R10, owner QA of 2026-11-18).
// The harness is the one of the B30 web screens check: the built Editor window in Chromium, with a stand-in host.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/light-limits/editor-check.mjs <output dir>
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

const SESSION='session_check',PORT=4181,ORIGIN=`http://127.0.0.1:${PORT}`;
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
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.exposeBinding('__importImage',()=>({record,name:record.name}));
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
   if(command==='import_image'){window.__imports.push(command);return window.__importImage();}
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},info);
let publisher=null,preview=null,shot=null,nextCall=1;
const pending=new Map(),calls=[];
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:0,capabilities:['read','edit'],warnings:[],outputs:[]}});
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
   const result=message.method==='appStatus'?status():await hostCall(message.method,message.params);
   ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result}));
  }
 });
});
let inspected=null;
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId:'scene_smoke'});if(reply.ok)inspected=reply.data;return inspected;};
const scene=()=>inspected;
const patch=async operations=>{const current=await refresh();return hostCall('scenePatch',{sceneId:current.sceneId,expectedRevision:current.revision,operations});};
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});
const settle=(ms=600)=>page.waitForTimeout(ms);
const {makeAuthoringEntity}=await import(root+'apps/desktop/src/editor/authoring.ts');
const M1='Scene has the maximum of 8 lit lights';
// In this harness a later scene inspection clears the alert within about 150 ms, on the base commit too. A MutationObserver
// records each alert when it renders: its text, its Inspector section ('bottom' when none), and whether it is inside the window.
const watch=()=>page.evaluate(()=>{window.__seen=[];window.__observer?.disconnect();window.__observer=new MutationObserver(()=>{for(const node of document.querySelectorAll('.inspector [role=alert]')){const r=node.getBoundingClientRect();window.__seen.push(JSON.stringify({text:node.textContent.trim(),section:node.closest('[data-section]')?.getAttribute('data-section')??'bottom',inView:r.height>0&&r.top>=0&&r.bottom<=innerHeight}));}});window.__observer.observe(document.body,{subtree:true,childList:true,characterData:true});});
const seen=async()=>(await page.evaluate(()=>[...new Set(window.__seen)])).map(text=>JSON.parse(text));
await page.goto(ORIGIN+'/?view=editor');
await page.locator('.session-mark.connected').waitFor({state:'attached',timeout:15000});
const {isLitLight}=await import(root+'packages/contracts/src/index.ts');
const addButton=page.locator('.asset-actions button').first();
const add=async label=>{await addButton.click();await settle(300);await page.getByRole('menuitem',{name:label,exact:true}).click();await settle();};
// Add makes lit lights up to 8; the next Add makes an unlit light (R8).
for(let lit=(await refresh()).entities.filter(e=>e.kind==='light'&&isLitLight(e.light)).length;lit<8;lit++)await add('Point Light');
await add('Spot Light');
const lights=(await refresh()).entities.filter(e=>e.kind==='light');
const unlitLight=lights.at(-1);
check('setup through Add: 8 lit lights, then an unlit Spot Light',lights.filter(e=>isLitLight(e.light)).length===8&&!isLitLight(unlitLight.light),lights.map(e=>[e.name,isLitLight(e.light)]));
await page.locator(`button[data-asset-id="${unlitLight.id}"]`).click();await settle();
const affect=page.locator('.inspector [data-section=affect]');
const box=affect.getByRole('checkbox',{name:'Affect Props'});
await box.scrollIntoViewIfNeeded();
await settle(2000);await watch();
await box.click();await settle(1500);
let shown=await seen();
check('a refused Affect tick at 8 lit lights shows M1 in the Affect section, and not at the bottom (R10)',shown.length===1&&shown[0].text===M1&&shown[0].section==='affect',shown);
check('the M1 alert is inside the window',shown.length===1&&shown[0].inView,shown);
check('the checkbox shows the scene value again (off) (R10)',!(await box.isChecked()));
// The closed-section case (M1 in the bottom alert) has no Inspector control that makes M1, so the unit test covers it.
check('no page error',errors.length===0,errors);
clearInterval(clock);
await browser.close();http.close();wss.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} of ${results.length} pass`);
process.exit(failed?1:0);
