// Headless editor check of the Blueprint Color type and the kit ColorPicker in each Editor color field (B38 R10, R11).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, and sends the clock (the method of the
// camera-orbit-selection check).
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/color-type/editor-check.mjs <output dir>
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
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',PORT=4191,ORIGIN=`http://127.0.0.1:${PORT}`;
const VIEWPORT={width:1440,height:900};
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
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
const context=await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:1});
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
const pending=new Map(),calls=[];
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
   calls.push({method:message.method,params:message.params});
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
const ops=()=>calls.filter(call=>call.method==='blueprintEdit').flatMap(call=>call.params.ops);
const lightPatches=()=>calls.filter(call=>call.method==='scenePatch').flatMap(call=>call.params.operations).filter(op=>op.kind==='setLight');
const panelOf=picker=>picker.locator('[role=dialog]');
// The panel box is inside the viewport, and the element at its center belongs to the panel (nothing covers it).
const placement=async panel=>{
 const box=await panel.boundingBox();
 const inside=box!==null&&box.x>=0&&box.y>=0&&box.x+box.width<=VIEWPORT.width&&box.y+box.height<=VIEWPORT.height;
 const top=box!==null&&await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest('[role=dialog]')!==null,[box.x+box.width/2,box.y+box.height/2]);
 return {box,inside,top};
};
// A pointer drag across the saturation and value area of an open panel, with pauses so each move is a live input.
const dragArea=async(panel,path=[[0.2,0.2],[0.5,0.45],[0.8,0.7]])=>{
 const box=await panel.locator('div[role=slider]').boundingBox();
 const at=([x,y])=>[box.x+box.width*x,box.y+box.height*y];
 await page.mouse.move(...at(path[0]));await page.mouse.down();
 for(const point of path.slice(1)){await page.mouse.move(...at(point),{steps:4});await settle(120);}
 await page.mouse.up();
};

await page.goto(ORIGIN+'/?view=editor');
await page.locator('.session-mark.connected').waitFor({timeout:15000});
await refresh();
const cameraId=inspected.entities.find(entity=>entity.kind==='camera').id;
const at=(x,y)=>({x,y});
const graph={schemaVersion:1,id:'colors',name:'Colors',enabled:true,variables:[{id:'tint',name:'Tint',type:'color',default:'#000000'}],nodes:[
 {id:'swatch',version:1,type:'value.color',settings:{value:'#336699'},position:at(-260,40)},
 {id:'split',version:1,type:'color.break',settings:{},position:at(40,40),inputs:{value:'#ff8000'}},
],connections:[]};
const loaded=await hostCall('blueprintEdit',{clientId:'check',batchId:'load',ops:[{kind:'replaceAll',graphs:[graph]}]});
check('the graph with a Color node and a Break Color node loads',loaded.ok,loaded.ok||loaded.error);
await page.getByTitle('Blueprints').click();
await settle(1000);
const breakNode=page.locator('[data-testid=node]').filter({hasText:'Break Color'});
const colorNode=page.locator('[data-testid=node]').filter({hasText:/^\s*Color/});
await breakNode.waitFor({timeout:10000});
const socket=await breakNode.locator('.bp-socket[data-kind=color]').first().evaluate(node=>getComputedStyle(node,'::before').backgroundImage);
check('R10: a color socket has its own color',socket.startsWith('conic-gradient'),socket.slice(0,60));
const nodeStyle=()=>breakNode.evaluate(node=>node.closest('[style*=translate]')?.style.transform??null);
const scale=()=>breakNode.evaluate(node=>node.getBoundingClientRect().width/node.offsetWidth);

// R10: the inline picker on the unconnected color input of Break Color, at zoom 1 and at zoom 0.5.
const inline=breakNode.locator('.bp-inline-color');
const rem=await page.evaluate(()=>Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
// The kit panel is 15rem wide; a panel that the canvas scaled would be narrower.
const inlineCheck=async(label,path,shotName)=>{
 const k=await scale();
 const startOps=ops().length,position=await nodeStyle();
 await inline.locator('button[aria-haspopup]').click();
 const panel=panelOf(inline);
 await panel.waitFor({timeout:3000});
 const where=await placement(panel);
 check(`R10: at zoom ${label} the inline panel is inside the viewport and on top`,where.inside&&where.top,{scale:k,...where});
 check(`R10: at zoom ${label} the panel is not scaled by the canvas`,where.box!==null&&Math.abs(where.box.width-15*rem)<1,{width:where.box?.width,expected:15*rem});
 if(shotName)await page.screenshot({path:`${out}/${shotName}`});
 await dragArea(panel,path);
 await settle(800);
 const sent=ops().slice(startOps);
 const inputs=sent.filter(op=>op.kind==='setNodeInput'&&op.nodeId==='split'&&op.port==='value');
 check(`R10: at zoom ${label} a drag in the panel sends one setNodeInput with a new color and does not move the node`,inputs.length===1&&/^#[0-9a-f]{6}$/.test(inputs[0].value)&&inputs[0].value!=='#ff8000'&&!sent.some(op=>op.kind==='moveNode')&&await nodeStyle()===position,{sent,position,now:await nodeStyle()});
 await page.keyboard.press('Escape');
 await settle(300);
 check(`R10: at zoom ${label} Escape closes the panel and the node stays`,await panel.count()===0&&await breakNode.count()===1);
};
await inlineCheck('1',[[0.2,0.2],[0.5,0.45],[0.8,0.7]],'node-picker.png');
const canvas=page.locator('.blueprint-canvas');
const canvasBox=await canvas.boundingBox();
await page.mouse.move(canvasBox.x+canvasBox.width*0.8,canvasBox.y+canvasBox.height*0.8);
for(let i=0;i<30&&await scale()>0.52;i++){await page.mouse.wheel(0,120);await settle(60);}
await settle(400);
await inlineCheck(String(Math.round(await scale()*100)/100),[[0.7,0.1],[0.4,0.3],[0.15,0.35]]);

// R10: the properties picker of a Color node sends setNodeSettings.
await colorNode.locator('.bp-node-title').click();
await settle(500);
const props=page.locator('aside[aria-label="Node properties"]');
await props.getByRole('button',{name:'Value',exact:true}).click();
const propsPanel=panelOf(props);
await propsPanel.waitFor({timeout:3000});
let mark=ops().length;
await dragArea(propsPanel);
await settle(800);
const settings=ops().slice(mark).filter(op=>op.kind==='setNodeSettings'&&op.nodeId==='swatch');
check('R10: a drag in the Color node properties picker sends one setNodeSettings with a new color',settings.length===1&&/^#[0-9a-f]{6}$/.test(settings[0].settings.value)&&settings[0].settings.value!=='#336699',ops().slice(mark));
await page.keyboard.press('Escape');
await settle(300);

// R10: the default of a Color variable, typed as hex.
await page.getByTitle('Variables').click();
await settle(500);
const hex=page.locator('.blueprint-variable-color input');
mark=ops().length;
await hex.fill('#336699');await hex.press('Enter');
await settle(800);
const updates=ops().slice(mark).filter(op=>op.kind==='updateVariable');
check('R10: a typed #336699 in the Color variable default sends one updateVariable',updates.length===1&&updates[0].variableId==='tint'&&updates[0].default==='#336699',ops().slice(mark));
await page.getByTitle('Variables').click();

// R11: the Inspector Color of a point light: live patches during a drag, none after it; one commit for a typed hex.
await page.getByTitle('Assets').click();
await settle(500);
const startScreen=page.locator('section.start-screen');
if(await startScreen.count())await startScreen.getByRole('button',{name:'Close'}).click();
const lightsBefore=new Set((await refresh()).entities.filter(entity=>entity.kind==='light').map(entity=>entity.id));
await page.getByTitle('Add asset').click();
await page.getByRole('menuitem',{name:'Point Light'}).click();
await settle(1000);
await refresh();
const light=inspected.entities.find(entity=>entity.kind==='light'&&!lightsBefore.has(entity.id));
check('Add asset › Point Light adds a light',light!==undefined,inspected.entities.map(entity=>entity.kind));
await page.locator(`button[data-asset-id="${light.id}"]`).click();
await settle(500);
const inspector=page.locator('.inspector');
const lightPicker=inspector.locator('.color-field').first();
await lightPicker.getByRole('button',{name:'Color',exact:true}).click();
const lightPanel=panelOf(lightPicker);
await lightPanel.waitFor({timeout:3000});
const lightPlace=await placement(lightPanel);
check('R11: the light Color panel is inside the viewport and on top',lightPlace.inside&&lightPlace.top,lightPlace);
await page.screenshot({path:`${out}/light-picker.png`});
mark=lightPatches().length;
await dragArea(lightPanel,[[0.1,0.1],[0.3,0.3],[0.5,0.5],[0.7,0.6],[0.9,0.4]]);
await settle(400);
const live=lightPatches().slice(mark);
await settle(1500);
const afterEnd=lightPatches().slice(mark);
await refresh();
const shownHex=await lightPicker.locator('input:not([type=range])').inputValue();
const committed=inspected.entities.find(entity=>entity.id===light.id).light.color;
check('R11: a drag sends two or more live setLight patches',live.length>=2,live.map(op=>op.light.color));
check('R11: the end of the drag sends no extra patch, and the scene holds the shown color',afterEnd.length===live.length&&committed===shownHex&&live.at(-1)?.light.color===shownHex,{live:live.length,afterEnd:afterEnd.length,committed,shownHex});
await page.keyboard.press('Escape');
await settle(300);
mark=lightPatches().length;
const lightHex=lightPicker.locator('input:not([type=range])');
await lightHex.fill('#00ff00');await lightHex.press('Enter');
await settle(1000);
const typed=lightPatches().slice(mark);
await refresh();
check('R11: a typed #00ff00 sends one setLight patch',typed.length===1&&typed[0].light.color==='#00ff00'&&inspected.entities.find(entity=>entity.id===light.id).light.color==='#00ff00',typed.map(op=>op.light.color));

// R11: the other Inspector color fields open the kit picker.
const opens=async(name,picker)=>{
 await picker.click();
 const dialog=page.locator('[role=dialog]:popover-open');
 let ok=false;try{await dialog.waitFor({timeout:3000});ok=true;}catch{/* reported below */}
 check(`R11: ${name} opens the kit color picker`,ok&&(await placement(dialog)).inside);
 await page.keyboard.press('Escape');await settle(300);
};
await page.getByTitle('Add asset').click();
await page.getByRole('menuitem',{name:'FPS Counter'}).click();
await settle(1000);
await page.locator('.asset-row').filter({hasText:'FPS Counter'}).first().getByRole('button').first().click();
await settle(500);
await opens('FPS Counter Color',inspector.getByRole('button',{name:'Color',exact:true}));
await page.locator(`button[data-asset-id="${cameraId}"]`).click();
await settle(500);
for(const id of ['grading','effects']){const heading=page.locator(`#inspector-section-${id}`);if(await heading.getAttribute('aria-expanded')==='false'){await heading.click();await settle(300);}}
await opens('camera Grading Tint',inspector.getByRole('button',{name:'Tint',exact:true}));
const effects=page.locator('#inspector-section-body-effects');
for(const name of ['Vignetting','Night Vision']){
 const group=effects.getByRole('group',{name});
 await group.getByRole('checkbox',{name}).check();
 await settle(800);
 await opens(`camera ${name} Color`,group.getByRole('button',{name:'Color',exact:true}));
}
// The avatar Rim Tint uses ColorField too.
const current=await refresh();
const avatarAdded=await hostCall('scenePatch',{sceneId:current.sceneId,expectedRevision:current.revision,operations:[{kind:'createEntity',entity:{id:'avatar_check',name:'Avatar',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'avatar',assetId:null}}]});
check('an avatar is added for the Rim Tint check',avatarAdded.ok,avatarAdded.ok||avatarAdded.error);
await settle(1000);
await page.locator('button[data-asset-id="avatar_check"]').click();
await settle(500);
const lighting=page.locator('#inspector-section-lighting');
if(await lighting.getAttribute('aria-expanded')==='false'){await lighting.click();await settle(300);}
await opens('avatar Rim Tint',inspector.getByRole('button',{name:'Rim Tint',exact:true}));
check('no page error',errors.length===0,errors);

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
