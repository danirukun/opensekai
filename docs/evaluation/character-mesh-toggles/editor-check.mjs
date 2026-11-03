// Headless check of the character mesh toggles in the Editor window (B26 Operation 7).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18, B19, and B21 checks). The asset
// record of fixture_vrm_1 has the mesh list that the host importer reads from the fixture file; the stand-in serves the
// fixture VRM bytes, so the Editor viewport loads the model on the software adapter.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/character-mesh-toggles/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {createSession,sessionApi,SESSION_METHODS}=await import(root+'packages/session/src/index.ts');
const {meshEntries}=await import(root+'packages/contracts/src/index.ts');
const {makeEmptyScene,makeAuthoringEntity}=await import(root+'apps/desktop/src/editor/authoring.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

// The fixture VRM from fixtures/local (pnpm fixtures). Without it, the check has no model to read.
const manifestPath='fixtures/local/manifest.json';
if(!existsSync(manifestPath)){log('SKIP: no',manifestPath);process.exit(0);}
const fixture=JSON.parse(readFileSync(manifestPath,'utf8')).assets.find(asset=>asset.record.id==='fixture_vrm_1');
const bytes=readFileSync(fixture.path);
const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
// The host backfills the expression list of a fixture manifest record at load; the stand-in does the same with an empty list.
const record={expressions:[],...fixture.record,meshes:meshEntries(json)};
log('fixture_vrm_1 meshes',JSON.stringify(record.meshes));

const SESSION='session_check',ORIGIN='http://127.0.0.1:4173';
const start=makeEmptyScene();
const performer=makeAuthoringEntity('character','performer',start.entities);
performer.assetId='fixture_vrm_1';
start.entities.push(performer);
const session=createSession(start,SESSION,[record]);
const api=sessionApi(session);
const begun=performance.now();
session.advance(0);
const clock=setInterval(()=>session.advance(performance.now()-begun),20);
const calls=[];
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[]}});
async function answer(method,params){
 if(method==='appStatus')return status();
 if(SESSION_METHODS.includes(method))return api[method](params);
 return {ok:false,error:{code:'UNAVAILABLE',message:'Not in the headless host',ids:[]}};
}
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(({operator,output,assets})=>{
 let next=1;const callbacks=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'editor'},currentWebview:{windowLabel:'editor',label:'editor'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command){
   if(command==='editor_connection')return {operator,output,assets,rendererMode:'auto'};
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},{operator:descriptor('operator',['read','edit'],null),output:descriptor('renderer',['read'],'output_main'),assets:[record]});
await context.route(ORIGIN+'/assets/fixture_vrm_1',route=>route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes}));
await context.routeWebSocket('ws://127.0.0.1:4173/ws',ws=>{
 ws.onMessage(async text=>{
  const message=JSON.parse(String(text));
  if(message.kind==='auth'){ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:['read','edit']}));return;}
  if(message.kind!=='call')return;
  calls.push({method:message.method,params:message.params});
  ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result:await answer(message.method,message.params)}));
 });
});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message,error.stack?.slice(0,600));});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const hidden=()=>session.inspect().entities.find(entity=>entity.id==='performer').hiddenMeshes;
const patches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations);

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await page.locator('button[data-asset-id="performer"]').first().click();
await settle();
const sections=await page.evaluate(()=>[...document.querySelectorAll('.inspector .section-heading')].map(node=>node.textContent.trim()));
check('the Inspector of the character has a Meshes section after Model and before Tracking (R12)',sections.indexOf('Meshes')===sections.indexOf('Model')+1&&sections.indexOf('Meshes')<sections.indexOf('Tracking'),sections);
const index=await page.evaluate(()=>[...document.querySelectorAll('.inspector nav button, .inspector-index button')].map(node=>node.textContent.trim()));
check('the section index lists Meshes (R12)',index.includes('Meshes'),index);
const boxes=page.locator('.mesh-list input[type=checkbox]');
const labels=await page.locator('.mesh-list label').allTextContents();
check('one checked checkbox for each mesh, labeled with the mesh name, in record order (R12)',JSON.stringify(labels.map(text=>text.trim()))==='["Body","Face","Hair"]'&&(await boxes.evaluateAll(items=>items.every(item=>item.checked))),labels);
await page.waitForTimeout(4000);
await page.screenshot({path:out+'/inspector-meshes.png'});
const before=patches().length;
await page.locator('.mesh-list label').filter({hasText:'Hair'}).locator('input').uncheck();
await settle();
check('clearing Hair sends one setHiddenMeshes patch with ["Hair"] (R5, R12)',JSON.stringify(patches().slice(before))==='[{"kind":"setHiddenMeshes","entityId":"performer","hiddenMeshes":["Hair"]}]'&&JSON.stringify(hidden())==='["Hair"]',patches().slice(before));
check('the Hair checkbox shows the hidden state',!(await page.locator('.mesh-list label').filter({hasText:'Hair'}).locator('input').isChecked()));
await page.waitForTimeout(1500);
await page.screenshot({path:out+'/inspector-hair-hidden.png'});
await page.locator('.mesh-list label').filter({hasText:'Hair'}).locator('input').check();
await settle();
check('checking Hair again removes the field (R4, R5)',hidden()===undefined,hidden());

// A graph with a Manual Trigger, made in the Blueprint panel: the node palette adds Toggle Character Meshes with the default mesh.
await page.getByTitle('Blueprints').click();
await settle();
await api.blueprintEdit({clientId:'check',batchId:'graph-1',ops:[{kind:'replaceAll',graphs:[{schemaVersion:1,id:'outfit',name:'Outfit',enabled:true,variables:[],connections:[],nodes:[{id:'run',version:1,type:'event.manual',settings:{},position:{x:0,y:0}}]}]}]});
await settle(1200);
if(!(await page.getByPlaceholder('Search nodes').isVisible()))await page.getByRole('button',{name:'Nodes'}).click();
await page.getByPlaceholder('Search nodes').fill('Toggle Character Meshes');
await settle();
await page.getByPlaceholder('Search nodes').press('Enter');
await settle(1200);
const graph=()=>session.inspectBlueprints().blueprints.find(item=>item.id==='outfit');
const toggle=()=>graph().nodes.find(node=>node.type==='character.toggleMeshes');
check('the palette adds Toggle Character Meshes with the first mesh of the character (R11)',JSON.stringify(toggle()?.settings)==='{"entityId":"performer","meshes":["Body"]}',toggle()?.settings);
const fields=page.locator('aside.blueprint-inspector');
await fields.waitFor({timeout:5000});
const group=fields.getByRole('group',{name:'Meshes'});
check('the node properties show a Meshes list with one entry (R11)',await group.locator('select').count()===1,await group.locator('select').count());
await group.locator('select').first().selectOption('Hair');
await settle();
check('a choice replaces the entry: meshes ["Hair"]',JSON.stringify(toggle().settings.meshes)==='["Hair"]',toggle().settings);
await group.getByTitle('Add meshes').click();
await settle();
check('+ adds the next mesh that the list does not use: ["Hair","Body"] (R11)',JSON.stringify(toggle().settings.meshes)==='["Hair","Body"]',toggle().settings);
const offered=await group.locator('select').nth(1).locator('option').allTextContents();
check('the second entry does not offer the name of the first entry',!offered.includes('Hair')&&offered.includes('Body')&&offered.includes('Face'),offered);
await page.screenshot({path:out+'/node-meshes-field.png'});
await group.getByTitle('Remove Body').click();
await settle();
check('the remove control removes the entry: ["Hair"] (R11)',JSON.stringify(toggle().settings.meshes)==='["Hair"]',toggle().settings);
check('the remove control of the last entry is disabled',await group.getByTitle('Remove Hair').isDisabled());
await api.blueprintEdit({clientId:'check',batchId:'wire-1',ops:[{kind:'connect',graphId:'outfit',connection:{id:'w1',sourceNodeId:'run',sourcePort:'flow',targetNodeId:toggle().id,targetPort:'flow'}}]});
await settle(1200);
const revision=session.inspect().revision;
await page.getByRole('button',{name:'Run'}).click();
await settle();
check('Run once hides Hair with one revision (R10)',JSON.stringify(hidden())==='["Hair"]'&&session.inspect().revision===revision+1,{hidden:hidden(),revision:session.inspect().revision});
await page.screenshot({path:out+'/graph-run.png'});
await page.getByRole('button',{name:'Run'}).click();
await settle(1000);
check('Run twice shows Hair again (R10)',hidden()===undefined,hidden());
// A saved name that the record does not have shows as missing.
await api.blueprintEdit({clientId:'check',batchId:'tail-1',ops:[{kind:'setNodeSettings',graphId:'outfit',nodeId:toggle().id,settings:{entityId:'performer',meshes:['Tail']}}]});
await settle(1200);
const missing=await group.locator('select').first().locator('option:checked').textContent().catch(()=>null);
check('a saved name that the record does not have shows as Missing (R11)',missing?.trim()==='Missing',missing);
check('no page errors',errors.length===0,errors);
clearInterval(clock);
await browser.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
