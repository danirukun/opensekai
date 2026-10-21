// Headless check of the FPS Counter in the Editor window (B19).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18 check).
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/fps-counter/editor-check.mjs <output dir>
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
const session=createSession(makeEmptyScene(),SESSION);
const api=sessionApi(session);
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[]}});
async function answer(method,params){
 if(method==='appStatus')return status();
 if(SESSION_METHODS.includes(method))return api[method](params);
 return {ok:false,error:{code:'UNAVAILABLE',message:'Not in the headless host',ids:[]}};
}
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
await context.addInitScript(({operator,output})=>{
 let next=1;const callbacks=new Map(),listeners=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'editor'},currentWebview:{windowLabel:'editor',label:'editor'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   if(command==='editor_connection')return {operator,output,assets:[],rendererMode:'auto'};
   if(command==='plugin:event|listen'){listeners.set(args.event,[...(listeners.get(args.event)??[]),args.handler]);return next++;}
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},{operator:descriptor('operator',['read','edit'],null),output:descriptor('renderer',['read'],'output_main')});
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
const counter=()=>session.inspect().entities.find(entity=>entity.kind==='fpsCounter');
const addMenu=async()=>{await page.getByTitle('Add asset').click();await page.getByRole('menuitem',{name:'FPS Counter'}).waitFor({timeout:3000});};

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await addMenu();
check('Add › FPS Counter is in the menu and enabled (R4)',await page.getByRole('menuitem',{name:'FPS Counter'}).isEnabled());
await page.getByRole('menuitem',{name:'FPS Counter'}).click();await settle();
check('the new entity has the add defaults (R4)',JSON.stringify(counter()&&{name:counter().name,visible:counter().visible,fpsCounter:counter().fpsCounter})===JSON.stringify({name:'FPS Counter',visible:true,fpsCounter:{corner:'topRight',size:32,color:'#ffffff'}}),counter());
const groups=await page.evaluate(()=>[...document.querySelectorAll('.hierarchy')].map(node=>node.innerText));
check('the Hierarchy shows an Overlays group with the counter (R6)',groups.some(text=>/Overlays[\s\S]*FPS Counter/.test(text)),groups);
await page.locator('.asset-row').filter({hasText:'FPS Counter'}).first().getByRole('button').first().click();await settle();
const sections=await page.evaluate(()=>[...document.querySelectorAll('.inspector .section-heading')].map(node=>node.textContent.trim()));
check('the Inspector has the FPS Counter section and no Transform section (R5)',sections.includes('FPS Counter')&&!sections.includes('Transform'),sections);
await page.screenshot({path:out+'/editor-added.png'});
await page.locator('.inspector select').first().selectOption('bottomLeft');await settle();
check('Corner › Bottom Left sends setFpsCounter (R5)',counter().fpsCounter.corner==='bottomLeft',counter().fpsCounter);
const size=page.getByRole('spinbutton',{name:'Size'});
await size.fill('48');await size.press('Enter');await settle();
check('Size 48 sends setFpsCounter (R5)',counter().fpsCounter.size===48,counter().fpsCounter);
const color=page.locator('.inspector .color-text input');
await color.fill('#ff8800');await color.press('Enter');await settle();
check('Color #ff8800 sends setFpsCounter (R5)',counter().fpsCounter.color==='#ff8800',counter().fpsCounter);
await page.screenshot({path:out+'/editor-changed.png'});
await page.getByTitle('Reset Size').click();await settle();
check('Reset Size sets 32 and keeps the other values (R5)',JSON.stringify(counter().fpsCounter)===JSON.stringify({corner:'bottomLeft',size:32,color:'#ff8800'}),counter().fpsCounter);
await page.locator('.asset-row').filter({hasText:'FPS Counter'}).first().click({button:'right'});
const duplicate=page.getByRole('menuitem',{name:'Duplicate'});await duplicate.waitFor({timeout:3000});
check('Duplicate is disabled with "Scene asset limit reached" (R4)',await duplicate.isDisabled()&&(await duplicate.getAttribute('title'))==='Scene asset limit reached',{disabled:await duplicate.isDisabled(),title:await duplicate.getAttribute('title')});
await page.keyboard.press('Escape');await settle();
await addMenu();
const item=page.getByRole('menuitem',{name:'FPS Counter'});
check('Add › FPS Counter is disabled at the limit (R4)',await item.isDisabled()&&(await item.getAttribute('title'))==='Scene asset limit reached',{disabled:await item.isDisabled(),title:await item.getAttribute('title')});
await page.keyboard.press('Escape');
check('no page error',errors.length===0,errors);
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
await browser.close();
process.exit(failed?1:0);
