// Headless check of the OpenSeeFace Receiver in the Editor window (B20 Operation 6).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands, routes the
// operator WebSocket to a real @opensekai/session in this process, and reports tracking status in appStatus as the
// host does (the method of the B18 and B19 checks). The stand-in does not decode UDP: after "send", it reports the
// source as receiving and gives the session the sample that the Rust integration test reads from the checked-in
// record (fixtures/protocol/openseeface-one-face.bin): an identity normalized head and jawOpen 0.5.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/openseeface-receive/editor-check.mjs <output dir>
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
const started=Date.now(),now=()=>Date.now()-started;
let receiving=false;
const source=()=>session.inspect().entities.find(entity=>entity.kind==='tracking'&&entity.config.kind==='openseeface');
// The host status of an enabled source: waiting after bind, receiving after a valid record.
const trackingStatus=()=>{const s=source();if(!s?.config.enabled)return [];return [{sourceId:s.id,generation:s.generation,state:receiving?'receiving':'waiting',packets:receiving?1:0,invalidPackets:0,lastReceivedAtMs:receiving?now():null,error:null}];};
const tick=setInterval(()=>{const s=source(),t=now();
 if(s?.config.enabled&&receiving)session.ingestTracking({samples:[{sourceId:s.id,generation:s.generation,receivedAtMs:t,bones:{head:{rotation:[0,0,0,1],space:'normalized'}},expressions:{jawOpen:.5,eyeBlinkLeft:0,eyeBlinkRight:0}}],statuses:trackingStatus()});
 session.advance(t,t);},33);
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[],trackingStatus:trackingStatus()}});
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
const add=async name=>{await page.getByTitle('Add asset').click();const item=page.getByRole('menuitem',{name});await item.waitFor({timeout:3000});return item;};
const inspector=page.locator('.inspector');
const runtime=inspector.locator('.runtime');

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await (await add('Character')).click();await settle();
const item=await add('OpenSeeFace Receiver');
check('Add › OpenSeeFace Receiver is in the menu and enabled (R8)',await item.isEnabled());
await item.click();await settle();
check('the new source has the tracker defaults, stopped (R1)',JSON.stringify(source()&&{name:source().name,config:source().config})===JSON.stringify({name:'OpenSeeFace Receiver',config:{kind:'openseeface',enabled:false,bindAddress:'127.0.0.1',port:11573,senderAddress:null}}),source());
const groups=await page.evaluate(()=>[...document.querySelectorAll('.hierarchy')].map(node=>node.innerText));
check('the asset list has the group "OpenSeeFace Receivers" (R8)',groups.some(text=>/OpenSeeFace Receivers\s*\nOpenSeeFace Receiver/.test(text)),groups);
await page.locator('.asset-row').filter({hasText:'OpenSeeFace Receiver'}).first().getByRole('button').first().click();await settle();
const fields={bind:await inspector.getByLabel('Bind address').inputValue(),port:await inspector.getByLabel('Port').inputValue(),sender:await inspector.getByLabel('Sender address').inputValue()};
check('the Inspector shows Bind address, Port, and Sender address with the defaults (R8)',JSON.stringify(fields)===JSON.stringify({bind:'127.0.0.1',port:'11573',sender:''}),fields);
const text=await inspector.innerText();
check('no phone address, no computer address list, no new helper text (R8)',!/Phone address|Computer address/.test(text),text.slice(0,400));
await inspector.getByLabel('Sender address').fill('192.168.1.20');await inspector.getByRole('button',{name:'Apply'}).click();await settle();
check('Apply commits the sender address (R8)',source().config.senderAddress==='192.168.1.20',source().config);
await runtime.getByRole('button',{name:'Start'}).click();await settle();await page.waitForTimeout(1500);
check('Start enables the source and the state reads waiting (R3, R8)',source().config.enabled===true&&/waiting/.test(await runtime.innerText()),await runtime.innerText());
check('Calibrate is disabled while the source waits (R7)',await runtime.getByRole('button',{name:'Calibrate'}).isDisabled());
await page.screenshot({path:out+'/waiting.png'});
receiving=true;await page.waitForTimeout(2000);
check('after a valid record the state reads receiving (R3, R8)',/receiving/.test(await runtime.innerText()),await runtime.innerText());
const calibrate=runtime.getByRole('button',{name:'Calibrate'});
check('Calibrate is enabled while the source receives (R7)',await calibrate.isEnabled());
const before=session.inspect().revision;
await calibrate.click();await settle();
check('Calibrate saves a head neutral in one revision (R7)',session.inspect().revision===before+1&&!!source().calibration?.bones?.head,{revision:session.inspect().revision,calibration:source().calibration});
await page.screenshot({path:out+'/receiving.png'});
await page.locator('.asset-row').filter({hasText:'Character'}).first().getByRole('button').first().click();await settle();
const options=async label=>inspector.getByLabel(label).locator('option').allTextContents();
const face=await options('Face source'),body=await options('Body source');
check('the Face source select lists the OpenSeeFace source; the Body source select does not (R2)',face.includes('OpenSeeFace Receiver')&&!body.includes('OpenSeeFace Receiver'),{face,body});
await inspector.getByLabel('Face source').selectOption({label:'OpenSeeFace Receiver'});await settle();
const avatar=session.inspect().entities.find(entity=>entity.kind==='avatar');
check('choosing it as the face source commits (R2)',avatar.tracking?.faceSourceId===source().id,avatar.tracking);
await page.screenshot({path:out+'/face-source.png'});
check('no page error',errors.length===0,errors);
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
clearInterval(tick);
await browser.close();
process.exit(failed?1:0);
