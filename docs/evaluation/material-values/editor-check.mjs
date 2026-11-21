// Headless editor check of the Inspector Materials section and the Set Material Property node fields (B38 R23, R29).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, and sends the clock (the method of the
// camera-orbit-selection check). The asset record of fixture_vrm_1 has the material list that the host importer reads from
// the fixture file. All its materials are opaque, so the stand-in record marks Body_00_SKIN as a blend material: then the
// Opacity row shows. The check reads the Inspector only; the viewport model is not part of it.
// Run from the repository root after `pnpm build` and `pnpm fixtures`:
//   pnpm exec tsx docs/evaluation/material-values/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const {materialEntries,meshEntries}=await import(root+'packages/contracts/src/index.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const manifestPath='fixtures/local/manifest.json';
if(!existsSync(manifestPath)){log('SKIP: no',manifestPath);process.exit(0);}
const fixture=JSON.parse(readFileSync(manifestPath,'utf8')).assets.find(asset=>asset.record.id==='fixture_vrm_1');
const bytes=readFileSync(fixture.path);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
const BODY='Body_00_SKIN';
const materials=materialEntries(json).map(material=>material.name===BODY?{...material,blend:true,model:{...material.model,opacity:1}}:material);
const record={expressions:[],...fixture.record,meshes:meshEntries(json),materials};
log('fixture_vrm_1 materials',materials.map(material=>material.name).join(', '));

const SESSION='session_check',PORT=4193,ORIGIN=`http://127.0.0.1:${PORT}`;
const VIEWPORT={width:1440,height:900};
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
const http=createServer(async (req,res)=>{
 const path=new URL(req.url,ORIGIN).pathname;
 if(path==='/assets/fixture_vrm_1'){res.writeHead(200,{'content-type':'model/gltf-binary'});res.end(bytes);return;}
 try{const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':mime[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http,path:'/ws'});
await new Promise(resolve=>http.listen(PORT,'127.0.0.1',resolve));
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role,token:`token_${role}_${outputId??'none'}`,capabilities,outputId});
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[record],fixtureMode:false,rendererMode:'auto'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:1,colorScheme:'light'});
await context.addInitScript(info=>{
 let next=1;const callbacks=new Map();
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
let publisher=null,preview=null,nextCall=1;
const pending=new Map(),calls=[];
const status=async()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:(await refresh())?.revision??0,capabilities:['read','edit'],warnings:[],outputs:[]}});
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
   const result=message.method==='appStatus'?await status():await hostCall(message.method,message.params);
   ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result}));
  }
 });
});
let inspected=null;
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId:'scene_smoke'});if(reply.ok)inspected=reply.data;return inspected;};
const page=await context.newPage();
// Headless Chromium WebGPU sometimes drops the GPU instance during an error scope. It is logged, not counted.
const errors=[];page.on('pageerror',error=>{log('pageerror',error.message);if(error.message!=='Instance dropped in popErrorScope')errors.push(error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const materialPatches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations).filter(op=>op.kind==='setMaterialValues');
// The sticky section index can cover a mark at the top edge of the column; center it first.
const clickReset=async label=>{const mark=page.locator('#inspector-section-body-materials').getByTitle(`Reset ${label}`);await mark.evaluate(node=>node.scrollIntoView({block:'center'}));await mark.click();};
const saved=async()=>(await refresh()).entities.find(entity=>entity.id==='performer').materials;
// Both themes: the default follows the system scheme.
const shoot=async name=>{
 for(const scheme of ['light','dark']){
  await page.emulateMedia({colorScheme:scheme});await settle(400);
  const theme=await page.evaluate(()=>document.documentElement.dataset.theme??null);
  log('theme',scheme,theme);
  await page.mouse.move(1430,890);
  await page.screenshot({path:`${out}/${name}-${scheme}.png`});
 }
 await page.emulateMedia({colorScheme:'light'});await settle(300);
};

await page.goto(ORIGIN+'/?view=editor');
await page.locator('.session-mark.connected').waitFor({timeout:15000});
const startScreen=page.locator('section.start-screen');
if(await startScreen.count())await startScreen.getByRole('button',{name:'Close'}).click();
const current=await refresh();
const added=await hostCall('scenePatch',{sceneId:current.sceneId,expectedRevision:current.revision,operations:[{kind:'createEntity',entity:{id:'performer',name:'Performer',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'avatar',assetId:'fixture_vrm_1'}}]});
check('a character with the fixture model is added',added.ok,added.ok||added.error);
await settle(1000);
await page.locator('button[data-asset-id="performer"]').first().click();
await settle(600);
const inspector=page.locator('.inspector');
const sections=await page.evaluate(()=>[...document.querySelectorAll('.inspector .section-heading')].map(node=>node.textContent.trim()));
check('R29: Materials comes after Meshes and before Lighting',sections.indexOf('Materials')===sections.indexOf('Meshes')+1&&sections.indexOf('Materials')<sections.indexOf('Lighting'),sections);
const body=page.locator('#inspector-section-body-materials');
const heading=page.locator('#inspector-section-materials');
if(await heading.getAttribute('aria-expanded')==='false'){await heading.click();await settle(300);}
const select=body.getByLabel('Material',{exact:true});
const options=await select.locator('option').allTextContents();
check('R29: the Material select lists the record materials in file order',JSON.stringify(options.map(text=>text.trim()))===JSON.stringify(materials.map(material=>material.name)),options);
const labels=async()=>(await body.locator('label').allTextContents()).map(text=>text.trim()).filter(Boolean);
check('R29: a blend MToon material with an outline shows its parameters in R14 order',JSON.stringify((await labels()).slice(1,4))==='["Base Color","Opacity","Emission Color"]',await labels());
await select.selectOption('Hair_00_HAIR');
await settle(300);
check('R29: choosing another material shows its rows, without Opacity',!(await labels()).includes('Opacity')&&(await labels()).includes('Base Color'),await labels());
await select.selectOption(BODY);
await settle(300);

// Base Color by text: one setMaterialValues.
let mark=materialPatches().length;
const baseColor=body.locator('.color-field').first();
const hex=baseColor.locator('input:not([type=range])');
await hex.fill('#ff8000');await hex.press('Enter');
await settle(1000);
const typed=materialPatches().slice(mark);
check('R29: a typed Base Color sends one setMaterialValues with the whole group',typed.length===1&&JSON.stringify(typed[0].materials)===`{"${BODY}":{"baseColor":"#ff8000"}}`,typed);
check('R29: the scene holds the saved value',JSON.stringify(await saved())===`{"${BODY}":{"baseColor":"#ff8000"}}`,await saved());
check('R29: the saved Base Color shows a reset mark',await body.getByTitle('Reset Base Color').count()===1);
const reachable=await page.evaluate(()=>{const mark=document.querySelector('#inspector-section-body-materials .reset-mark');mark.scrollIntoView({block:'center'});const r=mark.getBoundingClientRect();return mark.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
check('R29: the reset mark is visible and on top in the Inspector column',reachable);

// Opacity by drag: live patches, then no extra patch after the end.
mark=materialPatches().length;
const track=body.getByRole('slider',{name:'Opacity'});
await track.scrollIntoViewIfNeeded();
const box=await track.boundingBox();
await page.mouse.move(box.x+box.width-2,box.y+box.height/2);await page.mouse.down();
for(const x of [0.8,0.6,0.5]){await page.mouse.move(box.x+box.width*x,box.y+box.height/2,{steps:4});await settle(120);}
await page.mouse.up();
await settle(400);
const live=materialPatches().slice(mark);
await settle(1500);
const afterEnd=materialPatches().slice(mark);
const opacity=(await saved())?.[BODY]?.opacity;
check('R29: an Opacity drag sends two or more live setMaterialValues',live.length>=2,live.map(op=>op.materials[BODY]?.opacity));
check('R29: the end of the drag sends no extra patch, and the scene holds the last live value',afterEnd.length===live.length&&opacity===live.at(-1)?.materials[BODY]?.opacity&&opacity<1,{live:live.length,afterEnd:afterEnd.length,opacity});
await select.evaluate(node=>node.scrollIntoView({block:'center'}));
await shoot('materials-section');

// The reset mark removes the parameter.
mark=materialPatches().length;
await clickReset('Opacity');
await settle(800);
check('R29: the Opacity reset mark removes the parameter',JSON.stringify(await saved())===`{"${BODY}":{"baseColor":"#ff8000"}}`,materialPatches().slice(mark));

// A saved material that the record does not have.
const before=await refresh();
const gone=await hostCall('scenePatch',{sceneId:before.sceneId,expectedRevision:before.revision,operations:[{kind:'setMaterialValues',entityId:'performer',materials:{[BODY]:{baseColor:'#ff8000'},Cape:{baseColor:'#112233',outlineWidth:0.02}}}]});
check('a saved value for a material named Cape is added',gone.ok,gone.ok||gone.error);
await settle(800);
const missing=await select.locator('option').last().textContent();
check('R29: the select lists Cape (Missing) after the record materials',missing?.trim()==='Cape (Missing)',missing);
await select.selectOption('Cape');
await settle(300);
const disabled=await body.locator('.resettable').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('input,button:not(.reset-mark)')].every(control=>control.disabled)));
check('R29: a missing material shows its saved parameters as read-only rows',(await labels()).includes('Base Color')&&(await labels()).includes('Outline Width')&&disabled.length===2&&disabled.every(Boolean),{labels:await labels(),disabled});
check('R29: each row of a missing material has a reset mark',await body.locator('.reset-mark').count()===2);
await select.evaluate(node=>node.scrollIntoView({block:'center'}));
await shoot('materials-missing');
await clickReset('Outline Width');
await settle(800);
check('R29: a reset on a missing material removes that parameter',JSON.stringify((await saved()).Cape)==='{"baseColor":"#112233"}',(await saved()).Cape);

// R23: the node fields of Set Character Material Property.
const graph={schemaVersion:1,id:'looks',name:'Looks',enabled:true,variables:[],connections:[],nodes:[
 {id:'set',version:1,type:'character.setMaterialProperty',settings:{entityId:'performer',material:BODY,parameter:'baseColor',transitionSeconds:1,easing:'OutCubic'},position:{x:0,y:0}},
 {id:'lost',version:1,type:'character.setMaterialProperty',settings:{entityId:'performer',material:'Cape',parameter:'baseColor'},position:{x:0,y:260}},
]};
const loaded=await hostCall('blueprintEdit',{clientId:'check',batchId:'load',ops:[{kind:'replaceAll',graphs:[graph]}]});
check('a graph with two Set Character Material Property nodes loads',loaded.ok,loaded.ok||loaded.error);
await page.getByTitle('Blueprints').click();
await settle(1200);
const nodes=page.locator('[data-testid=node]').filter({hasText:'Set Character Material Property'});
await nodes.first().waitFor({timeout:10000});
await nodes.first().locator('.title, [data-testid=title]').first().click().catch(()=>nodes.first().click());
await settle(600);
const fields=page.locator('aside.blueprint-inspector');
await fields.waitFor({timeout:5000});
const chosen=async label=>(await fields.getByLabel(label,{exact:true}).locator('option:checked').textContent())?.trim();
check('R23: the node shows the Material select with the record material',await chosen('Material')===BODY,await chosen('Material'));
check('R23: the node shows the Property select with the parameters of that material',await chosen('Property')==='Base Color'&&(await fields.getByLabel('Property',{exact:true}).locator('option').allTextContents()).includes('Opacity'));
await shoot('material-node');
await nodes.nth(1).locator('.title, [data-testid=title]').first().click().catch(()=>nodes.nth(1).click());
await settle(600);
check('R23: a saved material that the record does not have shows as Missing',await chosen('Material')==='Missing',await chosen('Material'));
await shoot('material-node-missing');
check('no page error',errors.length===0,errors);

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
