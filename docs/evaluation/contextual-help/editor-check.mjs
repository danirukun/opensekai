// Headless editor check of the Help buttons (B40a R1–R4, R6).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, sends the clock, and records each
// `open_help` call. Rust builds the URL from the topic; this check asserts only the topic that each button sends.
// Run from the repository root after `pnpm --filter @opensekai/desktop build`:
//   pnpm exec tsx docs/evaluation/contextual-help/editor-check.mjs <output dir>
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
await mkdir(out,{recursive:true});
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',PORT=4186,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
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
const info={publisher:descriptor('publisher',['read','edit'],null),operator:descriptor('operator',['read','edit'],null),preview:descriptor('renderer',['read'],'preview_main'),output:descriptor('renderer',['read'],'output_main'),operatorDescriptorFile:'operator.json',rendererDescriptorFile:'renderer.json',assets:[],fixtureMode:false,rendererMode:'auto'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(info=>{
 let next=1;const callbacks=new Map();
 // Each open_help call, with its arguments. While __helpFail is true the host rejects the call, as Rust does when the open fails.
 window.__help=[];window.__helpFail=false;
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'main'},currentWebview:{windowLabel:'main',label:'main'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   if(command==='bootstrap_session')return info;
   if(command==='open_help'){window.__help.push(args);if(window.__helpFail)throw {code:'UNAVAILABLE',message:'Help unavailable',ids:[]};return null;}
   if(command==='recent_show_list')return [];
   if(command==='show_template_list')return [{id:'stage-lights',name:'Stage Lights'}];
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
},info);
let publisher=null,preview=null,nextCall=1;
const pending=new Map();
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
   const result=message.method==='appStatus'?await status():await hostCall(message.method,message.params);
   ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result}));
  }
 });
});
let inspected=null;
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId:'scene_smoke'});if(reply.ok)inspected=reply.data;return inspected;};
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const sent=()=>page.evaluate(()=>window.__help.map(args=>args?.topic));
// Clicks the Help button inside one panel and returns the topic that it sent.
const help=async(scope,label)=>{
 const before=(await sent()).length;
 const button=page.locator(scope).getByRole('button',{name:'Help',exact:true});
 const count=await button.count();
 await button.first().click();
 await settle(200);
 const topics=(await sent()).slice(before);
 check(`${label}: one Help button in the header sends one topic`,count===1&&topics.length===1,{count,topics});
 return topics[0];
};

await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000}).catch(()=>{});
await page.locator('.start-screen').waitFor({timeout:15000});
await settle(800);
await page.screenshot({path:join(out,'start-screen.png')});
check('R4: start screen Help opens gettingStarted',await help('.start-close','Start screen')==='gettingStarted');
const selected=await page.locator('.entity-row.selected').count();
check('R3: Properties Help with no selection opens scene',selected===0&&await help('.inspector .panel-heading','Properties (no selection)')==='scene',{selected});

// The guide and the light need a character and a light. Add a character through the Add menu (this also ends the start screen).
await page.locator('.hierarchy').getByTitle('Add asset').click();
await page.getByRole('menuitem',{name:'Character'}).click();
await settle(1000);
await refresh();
const avatar=inspected.entities.find(entity=>entity.kind==='avatar');
const light=inspected.entities.find(entity=>entity.kind==='light');
check('the scene has a character and a light',Boolean(avatar&&light),inspected.entities.map(entity=>[entity.kind,entity.id]));
check('R1: Hierarchy Help opens scene',await help('.hierarchy .asset-heading','Hierarchy')==='scene');
check('R1: Scene toolbar Help opens scene',await help('.scene-toolbar','Scene')==='scene');
await page.locator(`button[data-asset-id="${light.id}"]`).click();
await settle(600);
check('R3: Properties Help with a light selected opens light',await help('.inspector .panel-heading','Properties (light)')==='light');
await page.screenshot({path:join(out,'editor-properties-light.png')});
await page.locator(`button[data-asset-id="${avatar.id}"]`).click();
await settle(600);
check('R3: Properties Help with a character selected opens character',await help('.inspector .panel-heading','Properties (character)')==='character');
await page.getByRole('button',{name:'Set up tracking'}).click();
await page.locator('.tracking-guide').waitFor({timeout:5000});
await settle(400);
check('R1: tracking guide Help opens motionCapture',await help('.tracking-guide header','Tracking guide')==='motionCapture');
await page.screenshot({path:join(out,'editor-tracking-guide.png')});
await page.locator('.tracking-guide header').getByRole('button',{name:'Close',exact:true}).click();
await settle(800);
for(const [rail,scope,topic] of [['Output','.output-panel .panel-heading','output'],['Blueprints','.blueprint-toolbar','blueprints'],['Resources','.assets .panel-heading','resources'],['Settings','.settings-panel .panel-heading','settings']]){
 await page.locator('.editor-rail').getByTitle(rail,{exact:true}).click();
 await settle(700);
 check(`R1: ${rail} Help opens ${topic}`,await help(scope,rail)===topic);
}
await page.screenshot({path:join(out,'editor-settings.png')});

// R6: a rejected open shows the toast and sends nothing else.
await page.evaluate(()=>{window.__helpFail=true;});
await help('.settings-panel .panel-heading','Settings (failed open)');
const toast=await page.getByText('Could not open help').waitFor({timeout:3000}).then(()=>true,()=>false);
check('R6: a rejected open shows "Could not open help"',toast);
await page.evaluate(()=>{window.__helpFail=false;});

const all=await page.evaluate(()=>window.__help);
check('R5: each call sends only a topic',all.every(args=>Object.keys(args??{}).join()==='topic'),all);
check('no page error',errors.length===0,errors);
log('topics',JSON.stringify(all.map(args=>args.topic)));

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
