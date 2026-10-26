// Headless check of the environment flows in the Editor window (B23, environment import gaps).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18 check). No renderer runs.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/environment-import/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {createSession,sessionApi,SESSION_METHODS}=await import(root+'packages/session/src/index.ts');
const {makeEmptyScene}=await import(root+'apps/desktop/src/editor/authoring.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',ORIGIN='http://127.0.0.1:4173';
const room={id:'scene_'+'a'.repeat(64),format:'glb',sha256:'a'.repeat(64),bytes:616,sourceUrl:'https://sketchfab.com/3d-models/room',licenseLabel:'CC-BY-4.0',importerVersion:1,name:'Test room',expressions:[],
 credits:{title:'Test room',author:'CG Lads',license:'CC-BY-4.0',sourceUrl:'https://sketchfab.com/3d-models/room'}};
const session=createSession(makeEmptyScene(),SESSION);
const api=sessionApi(session);
let rejectNextFlag=false;
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[]}});
async function answer(method,params){
 if(method==='appStatus')return status();
 // R24: the stand-in rejects one Render Environment change, as a stale revision would.
 if(method==='scenePatch'&&rejectNextFlag&&params.operations?.some(op=>op.kind==='setCameraRenderEnvironment')){rejectNextFlag=false;return {ok:false,error:{code:'CONFLICT',message:'Scene changed',ids:[]}};}
 if(SESSION_METHODS.includes(method))return api[method](params);
 return {ok:false,error:{code:'UNAVAILABLE',message:'Not in the headless host',ids:[]}};
}
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:ORIGIN});
await context.addInitScript(({operator,output,assets})=>{
 let next=1;const callbacks=new Map(),listeners=new Map();
 window.__importScene=null;
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'editor'},currentWebview:{windowLabel:'editor',label:'editor'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   if(command==='editor_connection')return {operator,output,assets,rendererMode:'auto'};
   if(command==='import_scene'){const result=window.__importScene;if(result&&result.reject)throw result.reject;return result;}
   if(command==='plugin:event|listen'){listeners.set(args.event,[...(listeners.get(args.event)??[]),args.handler]);return next++;}
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},{operator:descriptor('operator',['read','edit'],null),output:descriptor('renderer',['read'],'output_main'),assets:[room]});
await context.routeWebSocket('ws://127.0.0.1:4173/ws',ws=>{
 ws.onMessage(async text=>{
  const message=JSON.parse(String(text));
  if(message.kind==='auth'){ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:['read','edit']}));return;}
  if(message.kind!=='call')return;
  ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result:await answer(message.method,message.params)}));
 });
});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const settle=()=>page.waitForTimeout(500);
const environment=()=>session.inspect().entities.find(entity=>entity.kind==='environment');
const camera=()=>session.inspect().entities.find(entity=>entity.id==='camera_main');
const addMenu=async()=>{await page.getByTitle('Add asset').click();await page.getByRole('menuitem',{name:'Environment'}).waitFor({timeout:3000});};
const source=()=>page.getByLabel('Source');
const options=()=>source().evaluate(select=>[...select.options].map(option=>option.textContent.trim()));
const selectRow=async name=>{await page.locator('.asset-row').filter({hasText:name}).first().getByRole('button').first().click();await settle();};

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await addMenu();
check('Add › Environment is in the menu and enabled (R20)',await page.getByRole('menuitem',{name:'Environment'}).isEnabled());
await page.getByRole('menuitem',{name:'Environment'}).click();await settle();
check('the new entity is an environment without a model (R20)',JSON.stringify(environment()&&{name:environment().name,visible:environment().visible,assetId:environment().assetId})===JSON.stringify({name:'Environment',visible:true,assetId:null}),environment());
await addMenu();
const item=page.getByRole('menuitem',{name:'Environment'});
check('Add › Environment is disabled while the scene has one (R20)',await item.isDisabled()&&(await item.getAttribute('title'))==='Scene asset limit reached',{disabled:await item.isDisabled(),title:await item.getAttribute('title')});
await page.keyboard.press('Escape');await settle();
const hierarchy=await page.locator('.hierarchy').innerText();
check('the Environment group is before Cameras (R21)',hierarchy.indexOf('Environment')>=0&&hierarchy.indexOf('Environment')<hierarchy.indexOf('Cameras'),hierarchy);
await selectRow('Environment');
check('Source lists Choose model…, the scene asset, and Import file… (R22)',JSON.stringify(await options())===JSON.stringify(['Choose model…','Test room','Import file…']),await options());
await source().selectOption(room.id);await settle();
check('a record option sends setEnvironmentModel (R22)',environment().assetId===room.id,environment().assetId);
const credits=await page.locator('.credits').innerText().catch(()=>'');
check('the credits show title, author, and license (R23)',/Test room/.test(credits)&&/CG Lads/.test(credits)&&/CC-BY-4.0/.test(credits),credits);
await page.getByRole('button',{name:'Copy credit'}).click();await settle();
const copied=await page.evaluate(()=>navigator.clipboard.readText());
check('Copy credit writes the credit line (R23)',copied==='This work is based on "Test room" (https://sketchfab.com/3d-models/room) by CG Lads licensed under CC-BY-4.0',copied);
await page.screenshot({path:out+'/editor-environment.png'});
await source().selectOption('__import__');await settle();
check('a cancelled import keeps the current value (R22)',environment().assetId===room.id&&await source().inputValue()===room.id,{scene:environment().assetId,select:await source().inputValue()});
await page.evaluate(()=>{window.__importScene={reject:{code:'INVALID_INPUT',message:'Required extension is not supported: KHR_draco_mesh_compression',ids:[]}};});
await source().selectOption('__import__');await settle();
const alert=await page.getByRole('alert').innerText().catch(()=>'');
check('an import failure shows the AppError message under the select (R22)',alert==='Required extension is not supported: KHR_draco_mesh_compression',alert);
await page.evaluate(()=>{window.__importScene=null;});
await source().selectOption('');await settle();
check('Choose model… sends setEnvironmentModel with null (R22)',environment().assetId===null,environment().assetId);
const patched=await api.scenePatch({sceneId:session.inspect().sceneId,expectedRevision:session.inspect().revision,operations:[{kind:'setEnvironmentModel',entityId:environment().id,assetId:'scene_gone'}]});
check('the stand-in sets an unknown asset ID',patched.ok,patched);
// Reload the window, so the Editor reads the scene again. The session in this process stays the same; no show file is read.
await page.reload();
await page.getByText('Session connected').waitFor({timeout:15000});
await selectRow('Environment');
check('an unknown asset ID shows Missing model (R22, R26)',JSON.stringify(await options())===JSON.stringify(['Choose model…','Test room','Missing model','Import file…'])&&await source().inputValue()==='scene_gone',{options:await options(),value:await source().inputValue()});
await page.screenshot({path:out+'/editor-missing-model.png'});
await selectRow('Camera');
const flag=page.getByRole('checkbox',{name:'Render Environment'});
check('the camera Inspector has Render Environment, on by default (R24)',await flag.isChecked());
await flag.click();await settle();
check('Render Environment off sends setCameraRenderEnvironment (R24)',camera().renderEnvironment===false&&!(await flag.isChecked()),camera().renderEnvironment);
rejectNextFlag=true;
await flag.click();await settle();
check('a failed change shows the scene value again (R24)',camera().renderEnvironment===false&&!(await flag.isChecked()),{scene:camera().renderEnvironment,box:await flag.isChecked()});
await flag.click();await settle();
check('Render Environment on sends setCameraRenderEnvironment (R24)',camera().renderEnvironment===true&&await flag.isChecked(),camera().renderEnvironment);
await page.screenshot({path:out+'/editor-camera-flag.png'});
check('no page error',errors.length===0,errors);
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
await browser.close();
process.exit(failed?1:0);
