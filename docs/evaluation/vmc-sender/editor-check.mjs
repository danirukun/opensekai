// Headless check of the VMC Sender in the Editor window (B21 Operation 11).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18 and B19 checks). The stand-in
// host has no UDP sender: its appStatus reports each enabled sender as `waiting`, or `sending` while a test flag is set.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/vmc-sender/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {createSession,sessionApi,SESSION_METHODS}=await import(root+'packages/session/src/index.ts');
const {makeEmptyScene,makeAuthoringEntity}=await import(root+'apps/desktop/src/editor/authoring.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',ORIGIN='http://127.0.0.1:4173';
const start=makeEmptyScene();
start.entities.push(makeAuthoringEntity('character','performer',start.entities));
const session=createSession(start,SESSION);
const api=sessionApi(session);
let sending=false;
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const senderStatus=()=>session.inspect().entities.filter(e=>e.kind==='vmcSender').map(e=>({entityId:e.id,state:e.vmcSender.enabled?(sending?'sending':'waiting'):'stopped',datagrams:sending?42:0,errors:0,error:null}));
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[],...(senderStatus().length?{vmcSenders:senderStatus()}:{})}});
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
const senders=()=>session.inspect().entities.filter(entity=>entity.kind==='vmcSender');
const sender=(name='VMC Sender')=>senders().find(entity=>entity.name===name);
const addMenu=async()=>{await page.getByTitle('Add asset').click();await page.getByRole('menuitem',{name:'VMC Sender'}).waitFor({timeout:3000});};
const row=name=>page.locator('button[data-asset-id]').filter({hasText:new RegExp(`^\\s*${name}\\s*$`)}).first();
const selectRow=async name=>{await row(name).click();await settle();};
const runtime=()=>page.locator('.inspector .runtime').innerText();

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await addMenu();
check('Add › VMC Sender is in the menu and enabled (R4)',await page.getByRole('menuitem',{name:'VMC Sender'}).isEnabled());
await page.getByRole('menuitem',{name:'VMC Sender'}).click();await settle();
check('the new sender has the add defaults: stopped, 127.0.0.1, 39539, the first character (R4)',JSON.stringify(sender()&&{name:sender().name,visible:sender().visible,vmcSender:sender().vmcSender})===JSON.stringify({name:'VMC Sender',visible:true,vmcSender:{enabled:false,address:'127.0.0.1',port:39539,avatarId:'performer'}}),sender());
const groups=await page.evaluate(()=>[...document.querySelectorAll('.hierarchy')].map(node=>node.innerText));
check('the Hierarchy shows a VMC Senders group with the sender (R5)',groups.some(text=>/VMC Senders[\s\S]*VMC Sender/.test(text)),groups);
await selectRow('VMC Sender');
const sections=await page.evaluate(()=>[...document.querySelectorAll('.inspector .section-heading')].map(node=>node.textContent.trim()));
check('the Inspector has the Sender section and no Transform section (R5)',sections.includes('Sender')&&!sections.includes('Transform'),sections);
const labels=await page.evaluate(()=>[...document.querySelectorAll('.inspector label')].map(node=>node.textContent.trim()).filter(Boolean));
check('the Inspector shows IP Address, Port, and Character, and no Visible box (R5)',['IP Address','Port','Character'].every(label=>labels.some(text=>text.startsWith(label)))&&!labels.includes('Visible'),labels);
check('the runtime row shows Start and stopped (R5)',/Start[\s\S]*stopped/.test(await runtime()),await runtime());
await page.screenshot({path:out+'/editor-added.png'});
await page.getByRole('textbox',{name:'IP Address'}).fill('192.168.1.40');
await page.getByRole('textbox',{name:'Port'}).fill('40000');
await page.getByRole('button',{name:'Apply'}).click();await settle();
check('IP Address and Port apply through setVmcSender (R5)',sender().vmcSender.address==='192.168.1.40'&&sender().vmcSender.port===40000,sender().vmcSender);
await page.getByRole('textbox',{name:'IP Address'}).fill('239.0.0.1');
await page.getByRole('button',{name:'Apply'}).click();await settle();
check('a multicast address shows the alert and changes nothing (R1)',sender().vmcSender.address==='192.168.1.40'&&await page.getByText('Use a valid address and port.').isVisible(),sender().vmcSender);
await page.locator('.inspector select').first().selectOption('');await settle();
check('Character › None sends avatarId null (R5)',sender().vmcSender.avatarId===null,sender().vmcSender);
await page.locator('.inspector select').first().selectOption('performer');await settle();
await page.locator('.inspector .runtime').getByRole('button',{name:'Start'}).click();await settle();
check('Start enables the sender and shows waiting (R5, R14)',sender().vmcSender.enabled===true&&/Stop[\s\S]*waiting/.test(await runtime()),{settings:sender().vmcSender,row:await runtime()});
sending=true;await page.waitForTimeout(1500);
check('the runtime row shows the host state sending (R14)',/sending/.test(await runtime()),await runtime());
await page.screenshot({path:out+'/editor-sending.png'});
sending=false;
await page.locator('.inspector .runtime').getByRole('button',{name:'Stop'}).click();await settle();
check('Stop disables the sender (R5)',sender().vmcSender.enabled===false,sender().vmcSender);
await page.getByTitle('Reset Port').click();await settle();
check('Reset Port sets 39539 and keeps the address (R5)',sender().vmcSender.port===39539&&sender().vmcSender.address==='192.168.1.40',sender().vmcSender);
// Start, then Duplicate: the copy is stopped.
await page.locator('.inspector .runtime').getByRole('button',{name:'Start'}).click();await settle();
await row('VMC Sender').click({button:'right'});
await page.getByRole('menuitem',{name:'Duplicate'}).click();await settle();
check('Duplicate makes a stopped copy of a running sender (R2)',sender('VMC Sender Copy')?.vmcSender.enabled===false&&sender().vmcSender.enabled===true,senders().map(e=>[e.name,e.vmcSender.enabled]));
for(let i=0;i<2;i++){await addMenu();await page.getByRole('menuitem',{name:'VMC Sender'}).click();await settle();}
check('the scene holds four senders',senders().length===4,senders().length);
await row('VMC Sender').click({button:'right'});
const duplicate=page.getByRole('menuitem',{name:'Duplicate'});await duplicate.waitFor({timeout:3000});
check('Duplicate is disabled with "Scene asset limit reached" at four senders (R4)',await duplicate.isDisabled()&&(await duplicate.getAttribute('title'))==='Scene asset limit reached',{disabled:await duplicate.isDisabled(),title:await duplicate.getAttribute('title')});
await page.keyboard.press('Escape');await settle();
await addMenu();
const item=page.getByRole('menuitem',{name:'VMC Sender'});
check('Add › VMC Sender is disabled at the limit (R4)',await item.isDisabled()&&(await item.getAttribute('title'))==='Scene asset limit reached',{disabled:await item.isDisabled(),title:await item.getAttribute('title')});
await page.keyboard.press('Escape');await settle();
// Open of a saved show with a running sender: the same sceneReplace call as the editor Open.
const show=structuredClone(session.inspect());
const opened=session.replaceScene({...show,entities:show.entities.map(e=>e.kind==='vmcSender'?{...e,vmcSender:{...e.vmcSender,enabled:true}}:e)},show.revision);
await page.waitForTimeout(1500);
await selectRow('VMC Sender');
check('Open of a show with a running sender shows it stopped (R2)',opened.ok&&senders().every(e=>!e.vmcSender.enabled)&&/Start[\s\S]*stopped/.test(await runtime()),{ok:opened.ok,row:await runtime()});
check('no page error',errors.length===0,errors);
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
await browser.close();
process.exit(failed?1:0);
