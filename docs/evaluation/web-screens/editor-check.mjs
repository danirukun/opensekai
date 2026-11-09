// Headless check of web page screens in the Editor window (B30 Operation 4, R5 scene pane, R11 screenshot, R13).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B28 check). Each test page comes
// from Playwright `route` on https://screen.test.invalid/; no test loads a page from the network.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/web-screens/editor-check.mjs <output dir>
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
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const screens=()=>scene().entities.filter(entity=>entity.kind==='screen');
const patches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations);
await context.route('https://screen.test.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body style="margin:0;height:100vh;background:#ff0000"></body></html>'}));
const TEST='https://screen.test.invalid/red';
const field=label=>page.locator('.screen-web').getByLabel(label,{exact:true});

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
const addButton=page.locator('.asset-actions button').first();
const addScreen=async()=>{await addButton.click();await settle(300);const items=(await page.locator('[role=menu] [role=menuitem], .context-menu button').allTextContents()).map(t=>t.trim());await page.locator('[role=menu] [role=menuitem], .context-menu button').nth(items.indexOf('Screen')).click();await settle();await refresh();};
await addScreen();
const id=screens()[0].id;
check('R14: Add Screen still makes image content',screens()[0].content.kind==='image',screens()[0].content);
const content=page.locator('.inspector select').first();
const kinds=(await content.locator('option').allTextContents()).map(t=>t.trim());
check('R13: the Content select has Image and Web page',JSON.stringify(kinds)==='["Image","Web page"]',kinds);
let before=patches().length;
await content.selectOption('web');
await settle(800);await refresh();
check('R13: Web page sends setScreenWeb with no URL, 1280 x 720, onTop false',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenWeb',entityId:id,web:{url:null,width:1280,height:720,onTop:false}}]),patches().slice(before));
const labels=(await page.locator('.screen-web label').allTextContents()).map(t=>t.trim()).filter(Boolean);
check('R13: the Web page fields are URL, Width, Height, and On top',['URL','Width','Height','On top'].every(l=>labels.some(x=>x.startsWith(l))),labels);
check('R9: a web screen without a URL has no iframe',(await page.locator('.preview-surface iframe').count())===0);
// An invalid URL does not commit and shows the one message.
before=patches().length;
await field('URL').fill('http://example.com/');await field('URL').press('Enter');await settle(600);
const message=await page.locator('.screen-web').textContent();
check('R13: a URL that fails the rule does not commit and shows Enter an https URL',patches().length===before&&message.includes('Enter an https URL')&&(await field('URL').inputValue())==='http://example.com/',{sent:patches().slice(before),value:await field('URL').inputValue()});
await field('URL').fill(TEST);await field('URL').press('Enter');await settle(1500);await refresh();
check('R13: a valid URL commits setScreenWeb with the other values unchanged',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenWeb',entityId:id,web:{url:TEST,width:1280,height:720,onTop:false}}]),patches().slice(before));
check('R13: the message goes after a valid commit',!(await page.locator('.screen-web').textContent()).includes('Enter an https URL'));
// The scene pane layer (R5, R6 interactive false).
await page.waitForFunction(()=>document.querySelector('.preview-surface iframe'),null,{timeout:10000}).catch(()=>{});
const frame=await page.evaluate(()=>{const f=document.querySelector('.preview-surface iframe');if(!f)return null;const layers=[...document.querySelectorAll('.preview-surface .web-layer')];return {sandbox:f.getAttribute('sandbox'),allow:f.getAttribute('allow'),tabindex:f.getAttribute('tabindex'),pointer:f.style.pointerEvents,referrer:f.getAttribute('referrerpolicy'),layer:layers.findIndex(l=>l.contains(f)),order:[...document.querySelector('.preview-surface').children].map(c=>c.id||c.className.split(' ')[0])};});
check('R5, R6: the scene pane iframe is in the back layer with no allow, tabindex -1, and no pointer events',frame?.sandbox==='allow-scripts allow-same-origin allow-forms'&&frame.allow===null&&frame.tabindex==='-1'&&frame.pointer==='none'&&frame.referrer==='no-referrer'&&frame.layer===0,frame);
check('R5: the layers are behind and in front of canvas#preview',JSON.stringify(frame?.order.slice(0,3))==='["web-layer","preview","web-layer"]',frame?.order);
// Width clamps to its range.
before=patches().length;
await field('Width').fill('5000');await field('Width').press('Enter');await settle(800);await refresh();
check('R13: a width above 3840 clamps and commits 3840',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenWeb',entityId:id,web:{url:TEST,width:3840,height:720,onTop:false}}])&&(await field('Width').inputValue())==='3840',patches().slice(before));
// On top moves the page to the front layer; the selected screen page is at 40 % opacity in the Editor preview.
await page.locator('.screen-web input[type=checkbox]').check();await settle(1500);await refresh();
const top=await page.evaluate(()=>{const f=document.querySelector('.preview-surface iframe');const layers=[...document.querySelectorAll('.preview-surface .web-layer')];return {layer:layers.findIndex(l=>l.contains(f)),opacity:f?.style.opacity};});
check('R7, R13: On top sends onTop true; the selected page is in the front layer at opacity 0.4',screens()[0].content.onTop===true&&top.layer===1&&top.opacity==='0.4',{content:screens()[0].content,top});
await page.screenshot({path:out+'/inspector-web.png'});
// Reset marks: the web fields and Content.
const marks=await page.locator('.inspector .reset-mark').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')??b.getAttribute('title')));
check('R13: reset marks show for Content, URL, Width, and On top',['Content','URL','Width','On top'].every(l=>marks.some(m=>m?.includes(l))),marks);
// R11: a camera screenshot draws the canvas only; with onTop false the screen area has alpha 0.
const camera=scene().entities.find(entity=>entity.kind==='camera');
await patch([{kind:'setScreenWeb',entityId:id,web:{url:TEST,width:1280,height:720,onTop:false}},{kind:'setTransform',entityId:id,transform:{position:[camera.transform.position[0],camera.transform.position[1],camera.transform.position[2]-3],rotation:[0,0,0,1],scale:[1,1,1]}},{kind:'createEntity',entity:{id:'wall',name:'Wall',visible:true,transform:{position:[camera.transform.position[0],camera.transform.position[1],camera.transform.position[2]-4],rotation:[0,0,0,1],scale:[6,4,0.1]},kind:'mesh',source:{kind:'box'}}}]);
await settle(3000);
if(preview){
 preview.send(JSON.stringify({kind:'screenshotRequest',requestId:'shot_1',params:{cameraId:camera.id,expectedRevision:(await refresh()).revision}}));
 const asked=Date.now();while(!shot&&Date.now()-asked<20000)await settle(200);
}
if(shot?.ok){
 const image=PNG.sync.read(Buffer.from(shot.data.pngBase64,'base64'));
 writeFileSync(out+'/camera-screenshot.png',PNG.sync.write(image));
 const px=([x,y])=>Array.from(image.data.subarray((y*1920+x)*4,(y*1920+x)*4+4));
 // The screen is 3 m in front of the camera, centered: the image center is in the screen; a point near the top edge is the wall.
 check('R11: the camera screenshot has alpha 0 at the screen center',px([960,540])[3]===0,px([960,540]));
 check('R11: the camera screenshot has the wall (alpha 255) outside the screen',px([960,40])[3]===255,px([960,40]));
}else log('UNKNOWN camera screenshot:',JSON.stringify(shot?.error??'no reply'));
// Content reset goes back to Image.
await page.locator(`button[data-asset-id="${id}"]`).click();await settle();
before=patches().length;
await page.locator('.inspector .reset-mark[aria-label*="Content"], .inspector .reset-mark[title*="Content"]').first().click();await settle(800);await refresh();
check('R13: the Content reset sends setScreenImage with null',JSON.stringify(patches().slice(before))===JSON.stringify([{kind:'setScreenImage',entityId:id,assetId:null}])&&(await page.locator('.preview-surface iframe').count())===0,patches().slice(before));
// The web screen limit: 4 web screens; Web page is disabled on an image screen, and Duplicate on a web screen.
const web=n=>({id:`web_${n}`,name:`Web ${n}`,visible:true,transform:{position:[n,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'screen',content:{kind:'web',url:null,width:1280,height:720,onTop:false}});
await patch([0,1,2,3].map(n=>({kind:'createEntity',entity:web(n)})));
await settle(1000);
await page.locator(`button[data-asset-id="${id}"]`).click();await settle();
const disabled=await page.locator('.inspector select').first().locator('option[value=web]').evaluate(o=>o.disabled);
check('R13: Web page is disabled on an image screen at the web screen limit',disabled===true,disabled);
await page.locator('button[data-asset-id="web_0"]').click();await settle();
const own=await page.locator('.inspector select').first().locator('option[value=web]').evaluate(o=>o.disabled);
check('R13: Web page stays enabled on a web screen at the limit',own===false,own);
await page.locator('button[data-asset-id="web_0"]').click({button:'right'});await settle(300);
const dup=page.locator('[role=menu] [role=menuitem], .context-menu button').filter({hasText:'Duplicate'});
check('R13: Duplicate is disabled for a web screen at the web screen limit',await dup.isDisabled(),await dup.count());
await page.keyboard.press('Escape');
await page.locator(`button[data-asset-id="${id}"]`).click({button:'right'});await settle(300);
const dupImage=page.locator('[role=menu] [role=menuitem], .context-menu button').filter({hasText:'Duplicate'});
check('R13: Duplicate stays enabled for an image screen at the web screen limit',!(await dupImage.isDisabled()),await dupImage.count());
await page.keyboard.press('Escape');
check('no page error',errors.length===0,errors);
clearInterval(clock);
await browser.close();http.close();wss.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} of ${results.length} pass`);
process.exit(failed?1:0);
