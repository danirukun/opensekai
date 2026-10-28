// Headless check of the Camera Sway template and Use current value (B24, BP-09 slice 1).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process, which advances on a 20 ms clock as the app tick does.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/camera-animation-example/headless-check.mjs <output dir>
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
// A scene with a camera and a light, and no avatar: only Camera Sway is offered.
const scene=makeEmptyScene();
const session=createSession(scene,SESSION);
const api=sessionApi(session);
const started=performance.now();
let frame=session.advance(0);
const clock=setInterval(()=>{frame=session.advance(performance.now()-started);},20);
const calls=[];
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[]}});
async function answer(method,params){
 if(method==='appStatus')return status();
 if(SESSION_METHODS.includes(method))return api[method](params);
 return {ok:false,error:{code:'UNAVAILABLE',message:'Not in the headless host',ids:[]}};
}

const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:800},deviceScaleFactor:1});
await context.addInitScript(({operator,output})=>{
 let next=1;const callbacks=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'editor'},currentWebview:{windowLabel:'editor',label:'editor'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command){
   if(command==='editor_connection')return {operator,output,assets:[],rendererMode:'auto'};
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
  calls.push({method:message.method,params:message.params});
  ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result:await answer(message.method,message.params)}));
 });
});
const page=await context.newPage();
page.on('pageerror',error=>log('pageerror',error.message));
await page.goto(ORIGIN+'/?view=editor');
await page.getByText('Session connected').waitFor({timeout:15000});
const settle=()=>page.waitForTimeout(700);
const cameraAt=()=>frame.scene.entities.find(item=>item.id==='camera_main');
const edits=()=>calls.filter(call=>call.method==='blueprintEdit');

await page.getByTitle('Blueprints').click();
await settle();
await page.getByRole('button',{name:'Templates'}).click();
const items=await page.getByRole('menuitem').allTextContents();
check('the Templates menu offers Camera Sway only, in a scene without a character (R9)',JSON.stringify(items.map(item=>item.trim()))==='["Camera Sway"]',items);
const start=structuredClone(cameraAt().transform.position);
await page.getByRole('menuitem',{name:'Camera Sway'}).click();
await page.waitForTimeout(1500);
const graphs=session.inspectBlueprints().blueprints;
const sway=graphs.find(item=>item.name==='Camera Sway');
check('Camera Sway imports enabled on the main camera (R8)',!!sway&&sway.enabled&&sway.nodes.filter(node=>node.type==='property.set').every(node=>node.settings.entityId==='camera_main'),sway&&{enabled:sway.enabled});
check('the graph has the loop: each Position node On Transition End starts the other (R8)',!!sway&&['slide','back'].every(id=>sway.connections.some(wire=>wire.sourceNodeId===id&&wire.sourcePort==='transitionEnd')),sway?.connections.map(wire=>`${wire.sourceNodeId}.${wire.sourcePort}`));
await page.locator('[data-testid=node]').first().waitFor({timeout:5000});
const labels=await page.locator('.bp-port.output span').allTextContents();
check('the canvas shows the On Transition End output on the Set Asset Property nodes (R1)',labels.filter(text=>text==='On Transition End').length===4,labels);
await page.screenshot({path:out+'/camera-sway-graph.png'});
const moved=cameraAt().transform.position;
check('the camera position moves in the evaluated scene after the import',JSON.stringify(moved)!==JSON.stringify(start),{start,moved});
check('the persistent scene does not change while the loop runs (R5b)',session.inspect().revision===0,session.inspect().revision);

// Use current value on a Field of View node: it writes the committed Field of View into the inline value.
const before=edits().length;
const committedFov=session.inspect().entities.find(item=>item.id==='camera_main').lens.fovDegrees;
const buttons=page.getByRole('button',{name:'Use current value'});
check('each Set Asset Property node with an unwired value shows Use current value (R7)',await buttons.count()===4,await buttons.count());
const nodes=page.locator('[data-testid=node]');
let zoom=null;
for(let i=0;i<await nodes.count();i++){const node=nodes.nth(i);if(await node.locator('.bp-inline input[type=number]').count()===1&&await node.getByRole('button',{name:'Use current value'}).count()===1){zoom=node;break;}}
const field=zoom.locator('.bp-inline input[type=number]');
const previous=Number(await field.inputValue());
await zoom.getByRole('button',{name:'Use current value'}).click();
await settle();
const sent=edits().slice(before).flatMap(call=>call.params.ops);
check('the button sends one setNodeInput with the committed Field of View (R7)',sent.length===1&&sent[0].kind==='setNodeInput'&&sent[0].port==='value'&&sent[0].value===committedFov,sent);
check('the inline value shows the committed value',Number(await field.inputValue())===committedFov,{previous,now:await field.inputValue()});
await page.screenshot({path:out+'/use-current-value.png'});
await page.keyboard.press(process.platform==='darwin'?'Meta+z':'Control+z');
await settle();
const undo=edits().slice(before).flatMap(call=>call.params.ops).at(-1);
check('one undo step restores the previous inline value',edits().slice(before).length===2&&undo?.kind==='setNodeInput'&&undo.value===previous&&Number(await field.inputValue())===previous,undo);

clearInterval(clock);
await browser.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
