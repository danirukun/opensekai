// Headless editor check of the Blueprint link dialog (B39 R9-R14).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, and sends the clock. The stand-in
// `invoke` answers `take_blueprint_link` from a queue that this script fills, counts `finish_blueprint_link`, and keeps
// the `app-link` listener, so the script can wake the window as the host does.
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/blueprint-import-link/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
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
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const fixture=name=>readFileSync(join(process.cwd(),'fixtures/blueprints',`${name}.json`),'utf8');
const HOST='blueprints.example';
const linked=name=>({reply:{text:fixture(name),host:HOST}});

const SESSION='session_check',PORT=4185,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
// One local server gives the built Editor window and the WebSocket on one origin, as the host does.
// Playwright does not route a WebSocket that a Worker opens, so the stand-in is a real server.
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.png':'image/png'};
const http=createServer(async (req,res)=>{
 const path=new URL(req.url,ORIGIN).pathname;
 try{const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':mime[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}
 catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server:http,path:'/ws'});
await new Promise(resolve=>http.listen(PORT,'127.0.0.1',resolve));
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role,token:`token_${role}_${outputId??'none'}`,capabilities,outputId});
// fixtureMode false: a normal launch, so the start screen shows (untouched launch).
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[],fixtureMode:false,rendererMode:'auto'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(({info,first})=>{
 let next=1;const callbacks=new Map();
 // The host side of the link: a queue of take replies, the take and finish counts, the commands, and the event listeners.
 window.__link={queue:[first],takes:0,finishes:0,handlers:{},commands:[]};
 window.__fire=(id,payload)=>callbacks.get(id)?.(payload);
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'main'},currentWebview:{windowLabel:'main',label:'main'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   window.__link.commands.push(command);
   if(command==='bootstrap_session')return info;
   if(command==='plugin:event|listen'){window.__link.handlers[args?.event]=args?.handler;return next++;}
   if(command.startsWith('plugin:event|'))return next++;
   if(command==='take_blueprint_link'){
    window.__link.takes++;const item=window.__link.queue.shift();if(!item)return null;
    if(item.delay)await new Promise(resolve=>setTimeout(resolve,item.delay));
    if(item.error)throw item.error;
    return item.reply;
   }
   if(command==='finish_blueprint_link'){window.__link.finishes++;return null;}
   return null;
  },
 };
},{info,first:linked('counter')});
let publisher=null,nextCall=1;
const pending=new Map(),calls=[];
// A call to the publisher, as the host router sends it.
const hostCall=async(method,params)=>{for(let i=0;!publisher&&i<200;i++)await new Promise(r=>setTimeout(r,50));if(!publisher)return {ok:false,error:{code:'UNAVAILABLE',message:'No publisher',ids:[]}};return new Promise(resolve=>{const requestId=`host_${nextCall++}`;pending.set(requestId,resolve);publisher.send(JSON.stringify({kind:'call',requestId,method,params}));});};
const blueprints=async()=>{const reply=await hostCall('blueprintInspect',{});return reply.ok?reply.data:null;};
// The status has the live scene and Blueprint revisions, as the host status does; the start screen ends on a change.
const status=async()=>{const scene=await hostCall('sceneInspect',{sceneId:'scene_smoke'});const set=await blueprints();return {ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:scene.ok?scene.data.revision:0,blueprintRevision:set?.revision??0,capabilities:['read','edit'],warnings:[],outputs:[]}};};
const begun=Date.now();
const clock=setInterval(()=>publisher?.send(JSON.stringify({kind:'clock',sessionId:SESSION,elapsedMs:Date.now()-begun})),16);
wss.on('connection',ws=>{
 let role=null,preview=null;
 ws.on('message',async data=>{const text=String(data);
  const message=JSON.parse(text);
  if(message.kind==='auth'){
   role=message.role;if(role==='publisher')publisher=ws;
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
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const counts=()=>page.evaluate(()=>({takes:window.__link.takes,finishes:window.__link.finishes}));
const queue=items=>page.evaluate(items=>{window.__link.queue.push(...items);},items);
const emit=(event,payload=null)=>page.evaluate(([event,payload])=>window.__fire(window.__link.handlers[event],{event,id:0,payload}),[event,payload]);
const wake=()=>emit('app-link');
const invoked=command=>page.evaluate(command=>window.__link.commands.filter(item=>item===command).length,command);
const dialog=page.locator('dialog.blueprint-link-dialog');
const dialogText=async()=>(await dialog.innerText()).split('\n').map(line=>line.trim()).filter(Boolean);
const startScreen=page.locator('section.start-screen');
const focused=()=>page.evaluate(()=>document.activeElement?.textContent?.trim()??null);
const cancel=()=>dialog.getByRole('button',{name:'Cancel'}).click();
const close=()=>dialog.getByRole('button',{name:'Close'}).click();

await page.goto(ORIGIN+'/?view=editor');
// The session mark shows its state only in its title while the session is connected.
await page.locator('.session-mark.connected').waitFor({state:'attached',timeout:15000});

// Untouched launch, at the first ready: counter.json from the queue (R9, R10, R11).
await dialog.waitFor({timeout:10000});
await settle(400);
let text=await dialogText();
check('R9: the first ready takes the link one time',(await counts()).takes===1,await counts());
check('R11: Confirm shows the title, the name, and the count line',text.includes('Import blueprint?')&&text.includes('Counter')&&text.includes(`7 nodes · ${HOST}`),text);
// The Editor scene of a normal launch has other camera IDs than the file, so a Missing line can show; it is checked below.
check('R11: Confirm has Cancel then Import and no other text',JSON.stringify(text.filter(line=>!line.startsWith('Missing: ')))===JSON.stringify(['Import blueprint?','Counter',`7 nodes · ${HOST}`,'Cancel','Import']),text);
check('R11: focus starts on Cancel',await focused()==='Cancel',await focused());
check('R9: the dialog shows over the start screen',await startScreen.isVisible());
await page.screenshot({path:out+'/confirm.png'});
await page.mouse.click(8,8);
await settle(300);
check('R11: a backdrop click does not close the dialog',await dialog.isVisible());
const before=await blueprints();
await cancel();
await settle(800);
let after=await blueprints();
check('R11, R13: Cancel closes, calls finish one time, and leaves the Blueprint revision and graphs unchanged',!(await dialog.isVisible())&&(await counts()).finishes===1&&after.revision===before.revision&&after.blueprints.length===before.blueprints.length,{counts:await counts(),before:before.revision,after:after.revision});
check('R12: Cancel keeps the start screen',await startScreen.isVisible());

// Escape does the same as Cancel.
await queue([linked('counter')]);await wake();await dialog.waitFor();await settle(300);
await page.keyboard.press('Escape');await settle(500);
check('R11: Escape closes the dialog, calls finish, and keeps the start screen',!(await dialog.isVisible())&&(await counts()).finishes===2&&await startScreen.isVisible(),await counts());

// app-link, then Import (R12, R15, R16).
await queue([linked('counter')]);await wake();await dialog.waitFor();await settle(300);
const graphsBefore=(await blueprints()).blueprints.length;
await dialog.getByRole('button',{name:'Import'}).click();
await settle(1200);
after=await blueprints();
const added=after.blueprints.find(graph=>graph.name==='Counter');
check('R12, R16: Import adds one disabled graph with the same name and node count',after.blueprints.length===graphsBefore+1&&added?.enabled===false&&added?.nodes.length===7,{graphs:after.blueprints.map(graph=>[graph.name,graph.enabled,graph.nodes.length])});
check('R12: the dialog closes and the Blueprints tab shows',!(await dialog.isVisible())&&await page.getByRole('heading',{name:'Blueprints'}).isVisible());
const row=page.locator('.blueprint-list li.selected');
check('R12: the new graph is selected and disabled in the list',(await row.innerText()).includes('Counter')&&await row.evaluate(node=>node.classList.contains('off')),await row.innerText());
await page.getByTitle('Assets').click();await settle(800);
check('R12: Import ends the start screen',!(await startScreen.isVisible()));

// missing-ref.json: the Missing line in the dialog and in the panel after Import.
await queue([linked('missing-ref')]);await wake();await dialog.waitFor();await settle(300);
text=await dialogText();
const missingLine=text.find(line=>line.startsWith('Missing: '));
check('R11: the dialog has the Missing line',!!missingLine&&text.includes('Missing Reference'),text);
await page.screenshot({path:out+'/missing.png'});
await dialog.getByRole('button',{name:'Import'}).click();
await settle(1200);
const state=(await page.locator('.blueprint-toolbar .blueprint-state').innerText()).trim();
check('R12: the panel status line has the same Missing line after Import',state===missingLine,{state,missingLine});

// Errors from the host and from the file (R11, R13).
for(const [item,reason] of [[{error:{code:'INVALID_INPUT',message:'Link must use HTTPS',ids:[]}},'Link must use HTTPS'],[{error:{code:'INVALID_INPUT',message:'Blueprint file is too large',ids:[]}},'Blueprint file is too large'],[linked('unknown-node'),'Unknown node types: character.wave']]){
 const start=await blueprints();
 await queue([item]);await wake();await dialog.waitFor();await settle(300);
 text=await dialogText();
 check(`R11: Failed shows the title, "${reason}", and Close`,JSON.stringify(text)===JSON.stringify(['Blueprint not imported',reason,'Close']),text);
 check(`R11: focus is on Close for "${reason}"`,await focused()==='Close',await focused());
 if(reason==='Link must use HTTPS')await page.screenshot({path:out+'/failed.png'});
 const finishes=(await counts()).finishes;
 await close();await settle(500);
 const end=await blueprints();
 check(`R13: Close calls finish and leaves the show unchanged for "${reason}"`,!(await dialog.isVisible())&&(await counts()).finishes===finishes+1&&end.revision===start.revision,{start:start.revision,end:end.revision});
}

// A second app-link while the dialog is open: no second take call. The host drops that link, so the queue has none.
await queue([linked('counter')]);await wake();await dialog.waitFor();await settle(300);
const open=(await counts()).takes;
await wake();await settle(800);
text=await dialogText();
check('R9: a second app-link while the dialog is open does not take again and does not change the dialog',(await counts()).takes===open&&text.includes('Counter'),{takes:(await counts()).takes,open,text});
// While the dialog is open, File › Open Show does nothing and Save Show works (R14).
const opens=await invoked('open_show'),saves=await invoked('save_show');
await emit('show-command','open');await settle(400);
await emit('show-command','save');await settle(800);
check('R14: Open Show does nothing while the dialog is open, and Save Show runs',await invoked('open_show')===opens&&await invoked('save_show')===saves+1&&await dialog.isVisible(),{open:[opens,await invoked('open_show')],save:[saves,await invoked('save_show')]});
await cancel();await settle(800);
check('R9: after the dialog closes, the window takes again and the host has no link',!(await dialog.isVisible())&&(await counts()).takes===open+1,await counts());

// 8 graphs: the content says the show is full.
const fill=(await blueprints()).blueprints.length;
const seed=JSON.parse(fixture('counter')).graph;
for(let i=fill;i<8;i++)await hostCall('blueprintEdit',{clientId:'check',batchId:`fill-${i}`,ops:[{kind:'createGraph',graph:{...seed,id:`fill-${i}`,name:`Fill ${i}`,enabled:false}}]});
await settle(1500);
const full=await blueprints();
await queue([linked('counter')]);await wake();await dialog.waitFor();await settle(400);
text=await dialogText();
check('R10, R13: with 8 graphs the dialog fails with "Show already has 8 blueprints"',full.blueprints.length===8&&JSON.stringify(text)===JSON.stringify(['Blueprint not imported','Show already has 8 blueprints','Close']),{graphs:full.blueprints.length,text});
await close();await settle(500);
check('R13: the dialog closes and the 8-graph show is unchanged',!(await dialog.isVisible())&&(await blueprints()).revision===full.revision);

// A take reply that comes after 1 s: the Spinner shows; Cancel closes the dialog.
await queue([{...linked('counter'),delay:1000}]);await wake();
await settle(600);
text=await dialogText();
check('R11: Loading shows after 300 ms with the title, the Spinner, and Cancel',JSON.stringify(text)===JSON.stringify(['Import blueprint','Cancel'])&&await dialog.locator('[role=status], svg.animate-spin, .animate-spin').count()>0,text);
const finishes=(await counts()).finishes;
await cancel();await settle(1000);
check('R11: Cancel closes the loading dialog, calls finish, and the late reply does not open it',!(await dialog.isVisible())&&(await counts()).finishes===finishes+1,await counts());

check('no page error',errors.length===0,errors);

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
