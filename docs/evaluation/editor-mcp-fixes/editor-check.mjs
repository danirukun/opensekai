// Headless Editor check of the Blueprint node layout (Editor and MCP fixes R8 to R10) and of a scene replace with a new
// scene ID from another client (R2). The Editor window build runs in Chromium with the session in the page (the publisher),
// as in the app. A stand-in for the Tauri host serves the build, routes the operator and publisher WebSockets, and sends the clock.
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/editor-mcp-fixes/editor-check.mjs <output dir> [before]
// With `before`, the script keeps only the 100% screenshot, as before-100.png.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
const before=process.argv[3]==='before';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',PORT=4183,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
// One local server gives the built Editor window and the WebSocket on one origin, as the host does.
// Playwright does not route a WebSocket that a Worker opens, so the stand-in is a real server.
const dist=join(process.cwd(),'apps/desktop/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2'};
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
log('chromium',browser.version());
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
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
const pending=new Map();
// The status has the live revision and the ID of the live scene, as the host status has after #244.
const status=async()=>{const scene=await refresh();return {ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:scene?.revision??0,...(scene?{sceneId:scene.sceneId}:{}),capabilities:['read','edit'],warnings:[],outputs:[]}};};
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
let inspected=null,sceneId='scene_smoke';
const refresh=async()=>{const reply=await hostCall('sceneInspect',{sceneId});if(reply.ok)inspected=reply.data;return inspected;};
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});page.on('console',m=>{if(m.type()==='error')log('console',m.text().slice(0,400));});
const settle=(ms=600)=>page.waitForTimeout(ms);
const mark=page.locator('.session-mark');

await page.goto(ORIGIN+'/?view=editor');
await page.locator('.session-mark[title="Session connected"]').waitFor({timeout:15000});
await refresh();
const entities=inspected.entities;
const cameraId=entities.find(entity=>entity.kind==='camera').id;
const shownId=(entities.find(entity=>entity.id==='marker')??entities.find(entity=>entity.kind!=='camera'&&entity.kind!=='tracking')).id;
log('scene',inspected.sceneId,'camera',cameraId,'visible target',shownId);

// One graph with the nodes of R8 and R10, 340 px apart on a grid of four columns.
const at=i=>({x:(i%4)*340,y:Math.floor(i/4)*340});
const LONG='A long Debug Value text that is wider than the widest node of this graph';
const nodes=[
 ['go','event.manual',{}],
 ['pos','property.set',{entityId:cameraId,property:'position'},{value:[-0.92,1.2,0.4]}],
 ['log','debug.log',{level:'info'},{message:'end'}],
 ['make','vector3.make',{}],
 ['wired','property.set',{entityId:cameraId,property:'position'}],
 ['fov','property.set',{entityId:cameraId,property:'fovDegrees'},{value:40}],
 ['shown','property.set',{entityId:shownId,property:'visible'},{value:true}],
 ['orbit','camera.orbitCharacter',{cameraId},{yaw:45,pitch:10,distance:2.5}],
 ['lerp','vector3.lerp',{}],
 ['toward','vector3.moveTowards',{}],
 ['replace','text.replace',{}],
 ['watch','debug.value',{valueType:'string'},{value:LONG}],
].map(([id,type,settings,inputs],i)=>({id,version:1,type,settings,position:at(i),...(inputs?{inputs}:{})}));
const wire=(id,sourceNodeId,sourcePort,targetNodeId,targetPort)=>({id,sourceNodeId,sourcePort,targetNodeId,targetPort});
const graph={schemaVersion:1,id:'layout',name:'Layout',enabled:true,variables:[],nodes,connections:[
 wire('a','go','flow','log','flow'),wire('b','pos','transitionEnd','log','flow'),wire('c','make','value','wired','value'),
]};
const loaded=await hostCall('blueprintEdit',{clientId:'check',batchId:'load',ops:[{kind:'replaceAll',graphs:[graph]}]});
check('the graph loads',loaded.ok,loaded.ok?undefined:loaded.error);
// A run of the graph gives the Debug Value node its watch value (the strip of R10).
const ran=await hostCall('blueprintRun',{graphId:'layout',triggerNodeId:'go'});
check('the run gives the Debug Value watch',ran.ok,ran);
await settle(1500);
await page.getByTitle('Blueprints').click();
await page.locator('[data-testid=node]').nth(nodes.length-1).waitFor({timeout:10000});
await page.locator('.bp-node-debug').waitFor({timeout:10000}).catch(()=>{});
check('the Debug Value node shows its strip',await page.locator('.bp-node-debug').count()===1);
await settle(800);

const canvas=page.locator('.blueprint-canvas');
// The zoom k of the Rete area content element, from its transform matrix.
const zoom=()=>canvas.evaluate(element=>{const holder=[...element.querySelectorAll('div')].find(item=>item.style.transform.includes('scale('));return new DOMMatrixReadOnly(getComputedStyle(holder).transform).a;});
// The geometry of each node in CSS pixels of the graph (screen pixels divided by k), relative to the node rectangle.
const measure=k=>page.locator('[data-testid=node]').evaluateAll((elements,k)=>elements.map(node=>{
 const box=node.getBoundingClientRect();
 const rect=(element,kind,name)=>{const r=element.getBoundingClientRect();return {kind,name,left:(r.left-box.left)/k,top:(r.top-box.top)/k,right:(r.right-box.left)/k,bottom:(r.bottom-box.top)/k};};
 const ports=[...node.querySelectorAll('.bp-port')];
 const labels=ports.flatMap(port=>[...port.children].filter(child=>child.tagName==='SPAN'&&!child.classList.contains('bp-inline')&&child.textContent.trim()).map(child=>rect(child,'label',child.textContent.trim())));
 const inputs=[...node.querySelectorAll('.bp-inline input')].map((input,i)=>rect(input,'input',`${input.closest('.bp-port').querySelector('span').textContent.trim()}#${i}`));
 const sockets=[...node.querySelectorAll('.bp-socket')].map((socket,i)=>rect(socket,'socket',`${socket.closest('.bp-port').classList.contains('input')?'in':'out'}#${i}`));
 const button=[...node.querySelectorAll('.bp-node-action button')].map(b=>rect(b,'button',b.textContent.trim()));
 const strip=[...node.querySelectorAll('.bp-node-debug')].map(d=>rect(d,'debug','strip'));
 const title=node.querySelector('.bp-node-title').textContent.trim();
 const names=labels.map(l=>l.name).join(',');
 return {name:`${title} [${names}] inline=${inputs.length}`,width:box.width/k,height:box.height/k,lastRow:Math.max(...ports.map(port=>(port.getBoundingClientRect().bottom-box.top)/k)),controls:[...labels,...inputs,...sockets,...button,...strip]};
}),k);
const T=0.5;
const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>T&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>T;
const geometry=async view=>{
 const k=await zoom();
 const measured=await measure(k);
 const crossings=[],outside=[],gaps=[];
 for(const node of measured){
  const c=node.controls;
  for(let i=0;i<c.length;i++)for(let j=i+1;j<c.length;j++)if(overlap(c[i],c[j]))crossings.push(`${node.name}: ${c[i].kind} ${c[i].name} x ${c[j].kind} ${c[j].name}`);
  for(const r of c){const slack=r.kind==='socket'?9+T:T;if(r.left< -slack||r.top< -slack||r.right>node.width+slack||r.bottom>node.height+slack)outside.push(`${node.name}: ${r.kind} ${r.name} ${JSON.stringify([r.left,r.top,r.right,r.bottom].map(v=>Math.round(v*10)/10))} in ${Math.round(node.width*10)/10} x ${Math.round(node.height*10)/10}`);}
  for(const b of c.filter(r=>r.kind==='button'))if(b.top-node.lastRow<4-T)gaps.push(`${node.name}: ${Math.round((b.top-node.lastRow)*10)/10} px`);
 }
 check(`R8 (${view}, k=${k.toFixed(3)}): no two controls of a node intersect`,crossings.length===0,crossings);
 check(`R8 (${view}): each control is inside its node (a socket up to 9 px outside)`,outside.length===0,outside);
 check(`R9 (${view}): the button is 4 px or more below the last port row`,gaps.length===0,gaps);
 return {k,measured};
};

// The vector Set Asset Property node: the one with three inline inputs.
const vectorNode=page.locator('[data-testid=node]').filter({has:page.locator('.bp-inline[data-type=vector3]')}).first();
const centre=async()=>{const r=await vectorNode.boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
const canvasBox=async()=>canvas.boundingBox();
// A drag on the canvas background moves the vector node to the canvas centre.
const pan=async()=>{
 const c=await canvasBox(),n=await centre();
 const empty=await page.evaluate(({c})=>{for(let y=c.y+20;y<c.y+c.height-20;y+=20)for(let x=c.x+20;x<c.x+c.width-20;x+=20){const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.blueprint-canvas')&&!hit.closest('.bp-node')&&!hit.closest('svg'))return {x,y};}return null;},{c});
 if(!empty)return;
 const dx=c.x+c.width/2-n.x,dy=c.y+c.height/2-n.y;
 const to={x:Math.min(c.x+c.width-2,Math.max(c.x+2,empty.x+dx)),y:Math.min(c.y+c.height-2,Math.max(c.y+2,empty.y+dy))};
 await page.mouse.move(empty.x,empty.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();await settle(200);
};
// Wheel steps over the vector node until k is within 2% of the target. A wheel pixel changes k by 1.25% of k (rete-area-plugin, intensity 0.1).
const zoomTo=async target=>{
 for(let i=0;i<60;i++){
  const k=await zoom();
  if(Math.abs(k/target-1)<0.02)return k;
  const d=Math.max(-0.1,Math.min(0.1,target/k-1));
  const n=await centre();
  await page.mouse.move(n.x,n.y);
  await page.mouse.wheel(0,-d*80);
  await settle(60);
 }
 return zoom();
};
const shoot=async view=>{const path=before?(view==='zoom-100'?'before-100.png':null):`${view}.png`;if(path)await canvas.screenshot({path:`${out}/${path}`});};

const views=[];
const fitK=await zoom();
log('open view k',fitK.toFixed(3));
views.push(['open-fit',await geometry('open fit')]);
await shoot('open-fit');
for(const [view,target] of [['zoom-50',0.5],['zoom-100',1],['zoom-200',2]]){
 const k=await zoomTo(target);
 await pan();
 check(`${view}: k is within 2% of ${target}`,Math.abs(k/target-1)<0.02,{k});
 views.push([view,await geometry(view)]);
 await shoot(view);
}
// R10: the node widths at 100%.
for(const node of views.find(([view])=>view==='zoom-100')[1].measured)log('WIDTH',node.width.toFixed(1),node.name);

// R2 in the Editor window: another client replaces the scene with a new scene ID.
await refresh();
const samples=[];
const replaced=await hostCall('sceneReplace',{scene:{...inspected,sceneId:'scene_b33'},expectedRevision:inspected.revision});
sceneId='scene_b33';
check('R2: sceneReplace with scene_b33 succeeds',replaced.ok,replaced.ok?undefined:replaced.error);
// The Editor polls the status each 500 ms. Sample the footer for 3 s (six polls); the last second must be all connected.
const deadline=Date.now()+3000;
while(Date.now()<deadline){samples.push([Date.now(),await mark.getAttribute('title')]);await page.waitForTimeout(100);}
const settled=samples.filter(([at])=>at>=deadline-1000).map(([,title])=>title);
check('R2: the footer shows Session connected after the replace and does not settle on NOT_FOUND',settled.length>0&&settled.every(title=>title==='Session connected'),{seen:[...new Set(samples.map(([,title])=>title))],last:settled.at(-1)});
const scene=await refresh();
check('R2: the session holds scene_b33',scene?.sceneId==='scene_b33',{sceneId:scene?.sceneId});
check('no page error',errors.length===0,errors);

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
