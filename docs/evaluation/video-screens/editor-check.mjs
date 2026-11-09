// Headless check of video screens in the Editor window (B29 Operation 6: R19, R20, R22 editor part).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to the real @opensekai/session that the Editor window runs (the method of the B28 editor check).
// `import_video` returns a record for fixtures/video/vp9-opus.webm (Chromium plays VP9 without proprietary codecs);
// the stand-in serves its bytes. The check covers the Inspector and the playback label path, not the picture.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/video-screens/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
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
// The missing video of R22 gives one expected 404 in the console.
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const bytes=readFileSync('fixtures/video/vp9-opus.webm');
const expected=JSON.parse(readFileSync('fixtures/video/expected.json','utf8'))['vp9-opus.webm'];
const sha256=createHash('sha256').update(bytes).digest('hex');
const common={sourceUrl:null,licenseLabel:'User supplied',importerVersion:1,expressions:[]};
const record={...common,id:`video_${sha256}`,format:'webm',sha256,bytes:bytes.length,name:'Clip',video:{width:expected.width,height:expected.height,durationMs:expected.durationMs,videoCodec:expected.videoCodec,audioCodec:expected.audioCodec,alpha:expected.alpha}};
// An image record in the library: the Video select must not list it, and the Image select must not list the video (R20).
const imageRecord={...common,id:'image_'+'c'.repeat(64),format:'png',sha256:'c'.repeat(64),bytes:1,name:'Logo',image:{width:4,height:3,frames:1}};

const SESSION='session_check',PORT=4179,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
let served=0;
const http=createServer(async (req,res)=>{
 const path=new URL(req.url,ORIGIN).pathname;
 if(/^\/assets\/(video|image)_[0-9a-f]{64}$/.test(path)){
  if(path.endsWith(record.id)){served++;res.writeHead(200,{'content-type':'video/webm','x-content-type-options':'nosniff','content-length':bytes.length});res.end(bytes);}
  else{res.writeHead(404);res.end();}
  return;
 }
 try{const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':mime[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http,path:'/ws'});
await new Promise(resolve=>http.listen(PORT,'127.0.0.1',resolve));
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role,token:`token_${role}_${outputId??'none'}`,capabilities,outputId});
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[imageRecord],fixtureMode:false,rendererMode:'auto'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
// The import answer of the stand-in host: a record, a cancelled dialog, a host error, or an error without a message.
let importMode='record';
await context.exposeBinding('__importVideo',()=>importMode==='record'?{ok:true,value:{record,name:record.name}}:importMode==='cancel'?{ok:true,value:null}:importMode==='host'?{ok:false,error:{code:'INVALID_INPUT',message:'Video is too large',ids:[]}}:{ok:false,error:'dialog crashed'});
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
   if(command==='import_video'){window.__imports.push(command);const answer=await window.__importVideo();if(answer.ok)return answer.value;throw answer.error;}
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},info);
let publisher=null,preview=null,nextCall=1;
const pending=new Map(),calls=[];
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:0,capabilities:['read','edit'],warnings:[],outputs:[]}});
const hostCall=async(method,params)=>{for(let i=0;!publisher&&i<200;i++)await new Promise(r=>setTimeout(r,50));if(!publisher)return {ok:false,error:{code:'UNAVAILABLE',message:'No publisher',ids:[]}};return new Promise(resolve=>{const requestId=`host_${nextCall++}`;pending.set(requestId,resolve);publisher.send(JSON.stringify({kind:'call',requestId,method,params}));});};
const begun=Date.now();
const clock=setInterval(()=>publisher?.send(JSON.stringify({kind:'clock',sessionId:SESSION,elapsedMs:Date.now()-begun})),16);
let lastPlayback=null;
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
  if(role==='publisher'&&message.kind==='frame'){lastPlayback=message.frame?.screenPlayback??lastPlayback;preview?.send(text);return;}
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
const sorted=value=>JSON.stringify(value,Object.keys(value??{}).sort());
const sent=since=>JSON.stringify(patches().slice(since));
const until=async(predicate,ms=10000)=>{const start=Date.now();while(Date.now()-start<ms){if(await predicate())return true;await settle(150);}return false;};
const menuItems=page.locator('[role=menu] [role=menuitem], .context-menu button');
const contentSelect=page.locator('.inspector select').first();
const videoSelect=page.locator('.screen-video select');
const playButton=page.locator('.screen-video .playback button').first();
const restartButton=page.locator('.screen-video .playback button').nth(1);
const label=async()=>(await playButton.textContent())?.trim();

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
// The Add menu Screen item still makes image content (R20).
const addButton=page.locator('.asset-actions button').first();
await addButton.click();await settle(300);
const order=(await menuItems.allTextContents()).map(text=>text.trim());
await menuItems.nth(order.indexOf('Screen')).click();
await settle();await refresh();
const id=screens()[0]?.id;
check('Add Screen still makes image content (R20)',screens().length===1&&JSON.stringify(screens()[0].content)==='{"kind":"image","assetId":null}',screens()[0]?.content);
const contentLabels=await page.locator('.inspector label').allTextContents();
check('the Screen section shows Content before Image (R19)',contentLabels.map(t=>t.trim()).indexOf('Content')>=0&&contentLabels.map(t=>t.trim()).indexOf('Content')<contentLabels.map(t=>t.trim()).indexOf('Image'),contentLabels);
check('Content has Image and Video (R19)',JSON.stringify((await contentSelect.locator('option').allTextContents()).map(t=>t.trim()))==='["Image","Video"]');
const imageOptions=(await page.locator('.screen-image select option').allTextContents()).map(t=>t.trim());
check('the Image select does not list the video record (R20)',!imageOptions.includes('Clip')&&imageOptions.includes('Logo'),imageOptions);
// Content Video sends setScreenVideo with the start values.
let before=patches().length;
await contentSelect.selectOption('video');
await settle();await refresh();
check('Content Video sends setScreenVideo with assetId null, autoPlay false, loop true, volume 1 (R19)',sent(before)===JSON.stringify([{kind:'setScreenVideo',entityId:id,video:{assetId:null,autoPlay:false,loop:true,volume:1}}]),patches().slice(before));
const videoOptions=(await videoSelect.locator('option').allTextContents()).map(t=>t.trim());
check('the Video select lists Choose video…, no record yet, and Import file… (R19, R20)',JSON.stringify(videoOptions)==='["Choose video…","Import file…"]',videoOptions);
check('without a video, Play shows and is disabled (R19)',(await label())==='Play'&&await playButton.isDisabled(),await label());
// Import: a cancelled dialog keeps the value; an error shows the host message or the fallback.
importMode='cancel';before=patches().length;
await videoSelect.selectOption({label:'Import file…'});await settle(800);
check('a cancelled import sends nothing and keeps the value (R19)',patches().length===before&&(await videoSelect.inputValue())==='',patches().slice(before));
importMode='host';
await videoSelect.selectOption({label:'Import file…'});await settle(800);
const hostAlert=await page.locator('.screen-video [role=alert]').textContent().catch(()=>null);
check('an import error shows the host message (R19)',hostAlert?.trim()==='Video is too large',hostAlert);
importMode='plain';
await videoSelect.selectOption({label:'Import file…'});await settle(800);
const plainAlert=await page.locator('.screen-video [role=alert]').textContent().catch(()=>null);
check('an import error without a host message shows Could not import video (R19)',plainAlert?.trim()==='Could not import video',plainAlert);
importMode='record';before=patches().length;
await videoSelect.selectOption({label:'Import file…'});
await settle(1500);await refresh();
check('Import file… runs import_video and sends setScreenVideo for this screen with the other values unchanged (R19)',(await page.evaluate(()=>window.__imports.length))===4&&sent(before)===JSON.stringify([{kind:'setScreenVideo',entityId:id,video:{assetId:record.id,autoPlay:false,loop:true,volume:1}}]),patches().slice(before));
check('the Video select shows the imported record and no Image record (R19, R20)',JSON.stringify((await videoSelect.locator('option').allTextContents()).map(t=>t.trim()))==='["Choose video…","Clip","Import file…"]'&&(await videoSelect.inputValue())===record.id);
check('the import error clears after a good import',await page.locator('.screen-video [role=alert]').count()===0);
await until(()=>served>0,10000);
log('INFO preview read the video bytes',served,'time(s)');
// Auto Play, Loop, and Volume each send setScreenVideo with the other values unchanged.
before=patches().length;
await page.locator('.screen-video label:has-text("Auto Play") input').check();await settle();
await page.locator('.screen-video label:has-text("Loop") input').uncheck();await settle();
const volume=page.locator('.screen-video input[type=number]');
await volume.fill('0.5');await volume.press('Enter');await settle();await refresh();
check('Auto Play, Loop, and Volume send setScreenVideo with the other values unchanged (R19)',sent(before)===JSON.stringify([
 {kind:'setScreenVideo',entityId:id,video:{assetId:record.id,autoPlay:true,loop:true,volume:1}},
 {kind:'setScreenVideo',entityId:id,video:{assetId:record.id,autoPlay:true,loop:false,volume:1}},
 {kind:'setScreenVideo',entityId:id,video:{assetId:record.id,autoPlay:true,loop:false,volume:0.5}}]),patches().slice(before));
const marks=await page.locator('.inspector .reset-mark').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('title')));
check('Content, Video, Auto Play, Loop, and Volume show reset marks (R19, B17)',['Reset Content','Reset Video','Reset Auto Play','Reset Loop','Reset Volume'].every(title=>marks.includes(title)),marks);
// Play, Pause, and Restart send controlScreenVideo; the label follows the frame entry.
await until(async()=>(await label())==='Play'&&!(await playButton.isDisabled()),5000);
before=patches().length;
await playButton.click();
const paused=await until(async()=>(await label())==='Pause');
check('Play sends controlScreenVideo play and the label turns to Pause from the frame (R19)',paused&&sent(before)===JSON.stringify([{kind:'controlScreenVideo',entityId:id,action:'play'}]),{label:await label(),sent:patches().slice(before),frame:lastPlayback});
await page.screenshot({path:out+'/editor-video-fields.png'});
before=patches().length;
await restartButton.click();await settle();
check('Restart sends controlScreenVideo restart and keeps playing (R19)',sent(before)===JSON.stringify([{kind:'controlScreenVideo',entityId:id,action:'restart'}])&&(await label())==='Pause',patches().slice(before));
before=patches().length;
await playButton.click();
check('Pause sends controlScreenVideo pause and the label turns to Play (R19)',await until(async()=>(await label())==='Play')&&sent(before)===JSON.stringify([{kind:'controlScreenVideo',entityId:id,action:'pause'}]),patches().slice(before));
// With the preview off, the pump stops, and the label still follows the frames.
await page.locator('button[title="Turn off preview"]').click();await settle();
await playButton.click();
check('with the preview off, the label still follows the frames (R19)',await until(async()=>(await label())==='Pause'),await label());
await playButton.click();await until(async()=>(await label())==='Play');
await page.locator('button[title="Turn on preview"]').click();await settle();
// A video ID that is not in the library shows Missing video (R22).
await patch([{kind:'setScreenVideo',entityId:id,video:{assetId:'video_'+'b'.repeat(64),autoPlay:false,loop:true,volume:1}}]);
await settle(1000);
const missing=await page.locator('.screen-video select option:checked').textContent();
check('a video ID that is not in the library shows Missing video (R22)',missing?.trim()==='Missing video',missing);
await page.screenshot({path:out+'/editor-missing-video.png'});
// Open (sceneReplace) with a video screen: playback starts from autoPlay (R22 with R11).
const saved=structuredClone(await refresh());
saved.entities=saved.entities.map(entity=>entity.id===id?{...entity,content:{kind:'video',assetId:record.id,autoPlay:true,loop:true,volume:0.75}}:entity);
const replaced=await hostCall('sceneReplace',{scene:{...saved,revision:saved.revision},expectedRevision:saved.revision});
await settle(1000);await refresh();
check('Open keeps the video screen and its saved content (R22)',replaced.ok&&sorted(screens().find(s=>s.id===id)?.content)===sorted({kind:'video',assetId:record.id,autoPlay:true,loop:true,volume:0.75}),replaced.ok?screens().find(s=>s.id===id)?.content:replaced.error);
check('after Open, the label follows autoPlay (Pause) (R22)',await until(async()=>(await label())==='Pause'),await label());
// The video screen limit: Content Video disabled on an image screen, Duplicate disabled on a video screen.
const others=[1,2,3].map(n=>({id:`screen_v${n}`,name:`Video ${n}`,visible:true,transform:{position:[n,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'screen',content:{kind:'video',assetId:null,autoPlay:false,loop:true,volume:1}}));
const still={id:'screen_still',name:'Still',visible:true,transform:{position:[0,2,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'screen',content:{kind:'image',assetId:null}};
const created=await patch([...others,still].map(entity=>({kind:'createEntity',entity})));
check('the stand-in adds three video screens and one image screen',created.ok,created.ok||created.error);
await settle(1000);
await page.locator('button[data-asset-id="screen_still"]').click();await settle();
check('at the video screen limit, Content Video is disabled on an image screen (R19)',await contentSelect.locator('option[value="video"]').evaluate(option=>option.disabled));
await page.locator(`button[data-asset-id="${id}"]`).click();await settle();
check('a video screen can still choose its Content at the limit (R19)',!(await contentSelect.locator('option[value="video"]').evaluate(option=>option.disabled)));
await page.locator(`button[data-asset-id="${id}"]`).click({button:'right'});await settle(300);
const duplicate=menuItems.filter({hasText:'Duplicate'});
check('Duplicate is disabled for a video screen at the limit (R19)',await duplicate.isDisabled());
await page.keyboard.press('Escape');await settle(300);
await page.locator('button[data-asset-id="screen_still"]').click({button:'right'});await settle(300);
check('Duplicate stays enabled for an image screen at the video limit',!(await menuItems.filter({hasText:'Duplicate'}).isDisabled()));
await page.keyboard.press('Escape');await settle(300);
// The Content reset sends setScreenImage with null.
await page.locator(`button[data-asset-id="${id}"]`).click();await settle();
before=patches().length;
await page.locator('.inspector .reset-mark[title="Reset Content"]').click();await settle();await refresh();
check('the Content reset sends setScreenImage with null (R19, B17)',sent(before)===JSON.stringify([{kind:'setScreenImage',entityId:id,assetId:null}])&&screens().find(s=>s.id===id)?.content.kind==='image',patches().slice(before));
// The Assets list shows the video record with its format and codecs.
await page.locator('button[title="Resources"]').click();await settle();
const rows=(await page.locator('.asset-row').allTextContents()).map(t=>t.replace(/\s+/g,' ').trim());
check('the Assets list shows the video format, video codec, and audio codec (R19)',rows.some(row=>row.includes('Clip')&&row.includes('WEBM · VP9 · Opus')),rows);
await page.screenshot({path:out+'/editor-assets-list.png'});
check('no page errors',errors.length===0,errors);
clearInterval(clock);
await browser.close();
wss.close();http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
