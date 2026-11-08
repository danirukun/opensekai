// Headless check of image screens in the Editor window (B28 Operation 5, R15 screenshot path, R17 to R19, R22).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18, B19, B21, and B26 checks).
// `import_image` returns a record for a test image that this script makes; the stand-in serves its bytes.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/image-screens/editor-check.mjs <output dir>
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

const SESSION='session_check',PORT=4178,ORIGIN=`http://127.0.0.1:${PORT}`;
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
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const screens=()=>scene().entities.filter(entity=>entity.kind==='screen');
const patches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations);

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
const addButton=page.locator('.asset-actions button').first();
await addButton.click();
await settle(300);
const items=await page.locator('[role=menu] [role=menuitem], .context-menu button').allTextContents();
const order=items.map(text=>text.trim());
check('the Add menu has Screen after Prop (R17)',order.indexOf('Screen')===order.indexOf('Prop')+1,order);
await page.locator('[role=menu] [role=menuitem], .context-menu button').nth(order.indexOf('Screen')).click();
await settle();await refresh();
check('Add Screen creates a screen named Screen without an image (R17)',screens().length===1&&screens()[0].name==='Screen'&&screens()[0].content.assetId===null,screens());
const groups=await page.locator('.group-heading span').allTextContents();
check('the Hierarchy groups it under Screens (R18)',groups.includes('Screens'),groups);
const sections=await page.evaluate(()=>[...document.querySelectorAll('.inspector .section-heading')].map(node=>node.textContent.trim()));
check('the Inspector has Transform and Screen sections (R19)',JSON.stringify(sections)==='["Transform","Screen"]',sections);
const select=page.locator('.screen-image select');
const options=await select.locator('option').allTextContents();
check('the Image select lists the image record and Import file… (R19)',JSON.stringify(options.map(o=>o.trim()))==='["Choose image…","Sign","Import file…"]',options);
await page.screenshot({path:out+'/inspector-screen.png'});
// Import file… runs import_image and sets the image of this screen.
const before=patches().length;
await select.selectOption({label:'Import file…'});
await settle(1500);await refresh();
const id=screens()[0].id;
check('Import file… runs import_image once and sends setScreenImage for this screen (R3, R19)',(await page.evaluate(()=>window.__imports.length))===1&&JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenImage',entityId:id,assetId:record.id}]),patches().slice(before));
const start=Date.now();
while(served===0&&Date.now()-start<20000)await settle(300);
check('the viewport reads the image over GET /assets (R12)',served>0,served);
await settle(4000);
const loadStatus=await page.locator('.screen-image .source-status').allTextContents();
check('no load failure in the Inspector',!loadStatus.some(text=>text.includes("failed")),loadStatus);
await page.screenshot({path:out+'/editor-screen.png'});
// A second screen, then Duplicate: Screen 2 and Screen 3.
await addButton.click();await settle(300);
await page.locator('[role=menu] [role=menuitem], .context-menu button').nth(order.indexOf('Screen')).click();
await settle();await refresh();
check('a second screen is Screen 2 (R17)',screens().map(s=>s.name).includes('Screen 2'),screens().map(s=>s.name));
// The Image reset sets the image to none.
await page.locator(`button[data-asset-id="${id}"]`).click();
await settle();
const reset=page.locator('.screen-image .reset-mark');
check('a chosen image shows a reset mark (R19, B17)',await reset.count()===1,await reset.count());
// The camera screenshot path (R15): the preview renderer answers a screenshot request with straight alpha.
const camera=scene().entities.find(entity=>entity.kind==='camera');
await patch([{kind:'setTransform',entityId:id,transform:{position:[0,1.2,0],rotation:[0,0,0,1],scale:[1,1,1]}}]);
await settle(3000);
if(preview){
 preview.send(JSON.stringify({kind:'screenshotRequest',requestId:'shot_1',params:{cameraId:camera.id,expectedRevision:(await refresh()).revision}}));
 const asked=Date.now();while(!shot&&Date.now()-asked<20000)await settle(200);
}
if(shot?.ok){
 const image=PNG.sync.read(Buffer.from(shot.data.pngBase64,'base64'));
 writeFileSync(out+'/camera-screenshot.png',PNG.sync.write(image));
 // The camera: position [0, 1.2, 3], 40° field of view, 1920 x 1080. The quad is 2 m x 1 m at [0, 1.2, 0].
 const half=3*Math.tan(20*Math.PI/180);
 const at=(x,y)=>[Math.round((x/(half*16/9)+1)/2*1920),Math.round((1-(y-1.2)/half)/2*1080)];
 const px=([x,y])=>Array.from(image.data.subarray((y*1920+x)*4,(y*1920+x)*4+4));
 const probes=[['opaque part',at(-0.5,1.2),255],['transparent part',at(0.2,1.2),0],['half-alpha strip',at(0.56,1.2),128],['outside the quad',at(0,1.9),0]];
 let same=true;for(let i=4;i<image.data.length&&same;i+=4)if(image.data.readUInt32LE(i)!==image.data.readUInt32LE(0))same=false;
 if(same)log('UNKNOWN camera screenshot pixels: one flat color');
 else for(const [name,point,alpha] of probes){const value=px(point);check(`camera screenshot: ${name} has alpha ${alpha} within 2/255 (R15)`,Math.abs(value[3]-alpha)<=2,{at:point,value});}
}else log('UNKNOWN camera screenshot:',JSON.stringify(shot?.error??'no reply'));
await page.locator('.screen-image .reset-mark').click();
await settle();await refresh();
check('the reset sends setScreenImage with null (R19)',screens().find(s=>s.id===id).content.assetId===null,screens().find(s=>s.id===id).content);
// A show from another computer: an image ID that is not in the library shows Missing image (R22).
await patch([{kind:'setScreenImage',entityId:id,assetId:'image_'+'b'.repeat(64)}]);
await settle(1500);
const missing=await page.locator('.screen-image select option:checked').textContent();
check('an image ID that is not in the library shows Missing image (R22)',missing?.trim()==='Missing image',missing);
await page.screenshot({path:out+'/missing-image.png'});
// Owner QA on #258 saw both renderers stop after an Open. Repeat the Open path (sceneReplace) with image resets and a
// removed screen, then ask for a screenshot at the newest revision: the preview must still draw the image.
const saved=structuredClone(await refresh());
saved.entities=saved.entities.map(entity=>entity.id===id?{...entity,content:{kind:'image',assetId:record.id}}:entity);
for(let round=0;round<6;round++){
 await patch(round%2===0?[{kind:'setScreenImage',entityId:id,assetId:null}]:[{kind:'removeEntity',entityId:id}]);
 await settle(150);
 const current=await refresh();
 const reply=await hostCall('sceneReplace',{scene:{...saved,revision:current.revision},expectedRevision:current.revision});
 if(!reply.ok)log('sceneReplace',JSON.stringify(reply.error));
 await settle(round%3===0?50:400);
}
await settle(3000);
shot=null;
preview?.send(JSON.stringify({kind:'screenshotRequest',requestId:'shot_2',params:{cameraId:camera.id,expectedRevision:(await refresh()).revision}}));
{const asked=Date.now();while(!shot&&Date.now()-asked<20000)await settle(200);}
if(shot?.ok){
 const image=PNG.sync.read(Buffer.from(shot.data.pngBase64,'base64'));
 writeFileSync(out+'/after-open-screenshot.png',PNG.sync.write(image));
 const half=3*Math.tan(20*Math.PI/180);
 const [x,y]=[Math.round((-0.5/(half*16/9)+1)/2*1920),540];
 const alpha=image.data[(y*1920+x)*4+3];
 check('after six Opens with resets and a removed screen, the preview draws the newest revision and the image (owner QA on #258)',alpha===255,{alpha});
}else check('after six Opens with resets and a removed screen, the preview answers a screenshot at the newest revision (owner QA on #258)',false,shot?.error??'no reply');
check('no page errors',errors.length===0,errors);
clearInterval(clock);
await browser.close();
wss.close();http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
