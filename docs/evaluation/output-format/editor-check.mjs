// Headless check of the output format controls in the Editor window (B22 R11, R12, R13).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process (the method of the B18 and B19 checks).
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/output-format/editor-check.mjs <output dir>
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
let rejectNext=false;
async function answer(method,params){
 if(method==='appStatus')return status();
 if(method==='scenePatch'&&rejectNext){rejectNext=false;return {ok:false,error:{code:'UNAVAILABLE',message:'Rejected by the headless host',ids:[]}};}
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
const main=()=>session.inspect().outputs.find(output=>output.id==='output_main');
const preview=()=>session.inspect().outputs.find(output=>output.id==='preview_main');
const values=async()=>Object.fromEntries(await Promise.all(['Resolution','Render scale','Frame limit'].map(async label=>[label,await page.getByLabel(label).inputValue()])));
const link=page.getByRole('link',{name:'Drag to OBS'});

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
await page.getByTitle('Output').click();await settle();
check('the Output panel shows Resolution, Render scale, and Frame limit with the scene values (R11)',JSON.stringify(await values())===JSON.stringify({'Resolution':'1920x1080','Render scale':'1','Frame limit':'60'}),await values());
const options=await page.getByLabel('Resolution').evaluate(select=>[...select.options].map(option=>option.textContent.trim()));
check('Resolution lists the four presets (R11)',JSON.stringify(options)===JSON.stringify(['1920 × 1080','1600 × 900','1280 × 720','960 × 540']),options);
const start=session.inspect().revision;
await page.getByLabel('Resolution').selectOption('1280x720');await settle();
check('Resolution › 1280 × 720 sends one setOutputFormat and keeps the other values (R3, R11)',main().width===1280&&main().height===720&&main().fps===60&&main().renderScale===1&&session.inspect().revision===start+1,{output:main(),revision:session.inspect().revision});
await page.getByLabel('Render scale').selectOption('0.75');await settle();
await page.getByLabel('Frame limit').selectOption('30');await settle();
check('Render scale › 75% and Frame limit › 30 FPS change output_main only (R2, R11)',JSON.stringify(main())===JSON.stringify({...main(),width:1280,height:720,fps:30,renderScale:0.75})&&preview().width===1920&&preview().fps===60&&preview().renderScale===undefined,{main:main(),preview:preview()});
const href=await link.getAttribute('href');
const url=new URL(href);
check('the Drag to OBS link has the OBS URL with the layer parameters of the output size (R12, R13)',url.searchParams.get('layer-name')==='OpenSekai'&&url.searchParams.get('layer-width')==='1280'&&url.searchParams.get('layer-height')==='720'&&url.hash.length>1,href.replace(/#.*/,'#<descriptor>'));
const dragged=await link.evaluate(node=>{const data=new DataTransfer();node.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:data}));return {uri:data.getData('text/uri-list'),text:data.getData('text/plain')};});
check('a dragstart on the link sets text/uri-list and text/plain to that URL (R12)',dragged.uri===href&&dragged.text===href,{same:dragged.uri===href});
const before=page.url();
await link.click();await settle();
check('a click on the link does not navigate the Editor window (R12)',page.url()===before,page.url());
await page.screenshot({path:out+'/editor-output-format.png'});
rejectNext=true;
const revision=session.inspect().revision;
await page.getByLabel('Resolution').selectOption('960x540');await settle();
check('a rejected change shows the scene value again (R11)',(await values())['Resolution']==='1280x720'&&session.inspect().revision===revision,await values());
await page.reload();await page.getByText('Session connected').waitFor({timeout:15000});
await page.getByTitle('Output').click();await settle();
check('a reload of the Editor window reads the values from the scene (R11)',JSON.stringify(await values())===JSON.stringify({'Resolution':'1280x720','Render scale':'0.75','Frame limit':'30'}),await values());
check('no page error',errors.length===0,errors);
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
await browser.close();
process.exit(failed?1:0);
