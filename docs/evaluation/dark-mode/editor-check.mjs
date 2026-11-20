// Headless editor check of the theme preference and the dark tokens (B40b R1–R5, R7, R8).
// The Editor window build runs in Chromium with the session in the page (the publisher), as in the app. A stand-in for
// the Tauri host serves the build, routes the operator and publisher WebSockets, sends the clock, counts
// `bootstrap_session` calls, and records each window theme call. The check captures the start screen, the editor with a
// selection, a context menu, the Blueprints panel with nodes, and Settings in Light, Dark A (the shipped tokens), and
// Dark B (candidate B injected as a style). With a second argument (a build of main), it also captures Light before the
// change and writes the pixel difference of each view.
// Run from the repository root after `pnpm build`:
//   pnpm exec tsx docs/evaluation/dark-mode/editor-check.mjs <output dir> [<main build dir>]
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const {PNG}=createRequire(process.cwd()+'/tools/evaluation/package.json')('pngjs');
const root=pathToFileURL(process.cwd()+'/').href;
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
const mainDist=process.argv[3]??null;
await mkdir(out,{recursive:true});
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

// Candidate B of the analysis: neutral steps with no navy tint. The other dark tokens stay as in A.
const DARK_B=`html[data-theme='dark']{--ds-color-bg:#16151b;--ds-color-rail:#1b1a20;--ds-color-toolbar:#1e1d24;--ds-color-panel:#1c1b21;--ds-color-surface:#211f27;--ds-color-surface-elevated:#2a2831;--ds-color-border:#3a3843;--ds-color-text:#ecebf1;--ds-color-text-muted:#a9a6b3;--ds-color-viewport:#0e0d12;--ds-color-preview:#26242b;--ds-color-preview-check:#2e2c33;--ds-color-hidden-text:#8b8996;--ds-color-warning-bg:#2b2517;--ds-color-warning-border:#57492c}`;

const SESSION='session_check',PORT=4187,ORIGIN=`http://127.0.0.1:${PORT}`;
const {WebSocketServer}=createRequire(process.cwd()+'/apps/mcp/package.json')('ws');
let dist=join(process.cwd(),'apps/desktop/dist');
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
const stub=info=>{
 let next=1;const callbacks=new Map();
 // `bootstrap_session` runs once per EditorApp mount. Each window theme call keeps its value.
 window.__boots=0;window.__frame=[];
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 window.__TAURI_INTERNALS__={
  metadata:{currentWindow:{label:'main'},currentWebview:{windowLabel:'main',label:'main'}},
  transformCallback(callback){const id=next++;callbacks.set(id,callback);return id;},
  unregisterCallback(id){callbacks.delete(id);},
  convertFileSrc:path=>path,
  async invoke(command,args){
   if(command==='bootstrap_session'){window.__boots++;return info;}
   if(command==='plugin:window|set_theme'){window.__frame.push(args?.value??null);return null;}
   if(command==='recent_show_list')return [];
   if(command==='show_template_list')return [{id:'stage-lights',name:'Stage Lights'}];
   if(command.startsWith('plugin:event|'))return next++;
   return null;
  },
 };
 // The theme at the moment the editor first adds its content to #app (R5).
 window.__mountTheme=null;window.__bodyTheme=null;
 // The theme when the parser adds <body>: the head script `theme-boot.js` sets it before that, and before any module runs.
 new MutationObserver((_,observer)=>{if(document.body){window.__bodyTheme=document.documentElement?.dataset.theme??'';observer.disconnect();}}).observe(document,{childList:true,subtree:true});
 document.addEventListener('DOMContentLoaded',()=>{
  const app=document.getElementById('app');
  const record=()=>{if(window.__mountTheme===null&&app.childElementCount>0)window.__mountTheme=document.documentElement.dataset.theme??'';};
  new MutationObserver(record).observe(app,{childList:true});record();
 });
};

let publisher=null,preview=null,nextCall=1;
const pending=new Map();
const status=async()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:0,capabilities:['read','edit'],warnings:[],outputs:[]}});
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

// Visible elements in a dark theme that paint a light background, and text under 4.5:1 on the background behind it.
// The preview, lime status, and the kit primary and secondary buttons are light by design.
const audit=page=>page.evaluate(()=>{
 const parse=value=>{
  const m=value.match(/^rgba?\(([^)]+)\)$/)??value.match(/^color\(srgb ([^)]+)\)$/);
  if(!m)return null;
  const parts=m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const scale=value.startsWith('color(')?255:1;
  return {rgb:parts.slice(0,3).map(v=>v*scale),alpha:parts[3]??1};
 };
 const lin=c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;};
 const lum=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
 const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
 const visible=el=>{const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.bottom<0||r.right<0||r.top>innerHeight||r.left>innerWidth)return false;const s=getComputedStyle(el);return s.visibility!=='hidden'&&s.display!=='none';};
 const exempt=el=>el.closest('.preview-surface,canvas,.coach-face,.status-positive,.bg-ds-primary,.bg-ds-secondary,.perf-monitor,svg')!==null;
 const name=el=>el.tagName.toLowerCase()+(typeof el.className==='string'&&el.className.trim()?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
 const faded=el=>{for(let node=el;node;node=node.parentElement)if(Number(getComputedStyle(node).opacity)<1)return true;return false;};
 const behind=el=>{
  let base=[255,255,255];const layers=[];
  for(let node=el;node;node=node.parentElement){const bg=parse(getComputedStyle(node).backgroundColor);if(bg&&bg.alpha>0){layers.push(bg);if(bg.alpha>=1)break;}}
  for(const layer of layers.reverse())base=base.map((c,i)=>c*(1-layer.alpha)+layer.rgb[i]*layer.alpha);
  return base;
 };
 const light=new Set(),weak=new Map();
 for(const el of document.querySelectorAll('body *')){
  if(!visible(el)||exempt(el))continue;
  const bg=parse(getComputedStyle(el).backgroundColor);
  if(bg&&bg.alpha>=0.5&&lum(bg.rgb)>0.4)light.add(name(el));
  const own=[...el.childNodes].some(node=>node.nodeType===3&&node.textContent.trim());
  if(!own||faded(el)||el.closest('.hidden-asset'))continue;
  const fg=parse(getComputedStyle(el).color);
  if(!fg)continue;
  const value=ratio(fg.rgb,behind(el));
  if(value<4.5)weak.set(name(el),Math.round(value*100)/100);
 }
 return {light:[...light],weak:Object.fromEntries(weak)};
});

const settle=(page,ms=600)=>page.waitForTimeout(ms);
const graph=cameraId=>{
 const nodes=[
  ['go','event.manual',{}],
  ['log','debug.log',{level:'info'},{message:'hello'}],
  ['make','vector3.make',{}],
  ['wired','property.set',{entityId:cameraId,property:'position'}],
 ].map(([id,type,settings,inputs],i)=>({id,version:1,type,settings,position:{x:40+(i%2)*300,y:40+Math.floor(i/2)*220},...(inputs?{inputs}:{})}));
 const wire=(id,sourceNodeId,sourcePort,targetNodeId,targetPort)=>({id,sourceNodeId,sourcePort,targetNodeId,targetPort});
 return {schemaVersion:1,id:'theme',name:'Theme',enabled:true,variables:[],nodes,connections:[wire('a','go','flow','log','flow'),wire('b','make','value','wired','value')]};
};

// One pass through the five views. Returns the page for later checks.
const capture=async({label,colorScheme,inject=false,storage=null})=>{
 publisher=null;preview=null;
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme});
 await context.addInitScript(stub,info);
 if(storage)await context.addInitScript(value=>{try{localStorage.setItem('opensekai.theme',value);}catch{}},storage);
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>{errors.push(error.message);log('pageerror',error.message);});
 const shot=async view=>{if(inject)await page.addStyleTag({content:DARK_B}).catch(()=>{});await settle(page,250);await page.screenshot({path:join(out,`${view}-${label}.png`)});};
 await page.goto(ORIGIN+'/?view=editor');
 await page.locator('.start-screen').waitFor({timeout:15000});
 await settle(page,900);
 const audits={};
 await shot('start');audits.start=await audit(page);
 await page.locator('.hierarchy').getByTitle('Add asset').click();
 await page.getByRole('menuitem',{name:'Character'}).click();
 await settle(page,1200);
 const scene=(await hostCall('sceneInspect',{sceneId:'scene_smoke'})).data;
 const avatar=scene.entities.find(entity=>entity.kind==='avatar');
 const camera=scene.entities.find(entity=>entity.kind==='camera');
 await page.locator(`button[data-asset-id="${avatar.id}"]`).click();
 await settle(page,700);
 await shot('editor');audits.editor=await audit(page);
 await page.locator(`button[data-asset-id="${avatar.id}"]`).click({button:'right'});
 await page.locator('.context-menu').waitFor({timeout:5000});
 await settle(page,300);
 await shot('context-menu');audits.contextMenu=await audit(page);
 await page.keyboard.press('Escape');
 await settle(page,300);
 const loaded=await hostCall('blueprintEdit',{clientId:'check',batchId:'load',ops:[{kind:'replaceAll',graphs:[graph(camera.id)]}]});
 if(!loaded.ok)log('blueprint load',JSON.stringify(loaded.error));
 await page.locator('.editor-rail').getByTitle('Blueprints',{exact:true}).click();
 await page.locator('[data-testid=node]').nth(3).waitFor({timeout:10000});
 await settle(page,800);
 await page.locator('.bp-node-title').filter({hasText:/log/i}).first().click().catch(()=>page.locator('.bp-node-title').first().click());
 await settle(page,400);
 await shot('blueprints');audits.blueprints=await audit(page);
 await page.locator('.editor-rail').getByTitle('Settings',{exact:true}).click();
 await settle(page,800);
 await shot('settings');audits.settings=await audit(page);
 return {context,page,errors,audits};
};

const views=['start','editor','context-menu','blueprints','settings'];
const theme=page=>page.evaluate(()=>document.documentElement.dataset.theme);

// Light before the change, from the main build.
if(mainDist){
 dist=mainDist;
 const before=await capture({label:'light-before',colorScheme:'light'});
 await before.context.close();
 dist=join(process.cwd(),'apps/desktop/dist');
}

const lightRun=await capture({label:'light',colorScheme:'light'});
check('R2: System follows a light OS',await theme(lightRun.page)==='light');
check('no page error (light)',lightRun.errors.length===0,lightRun.errors);
await lightRun.context.close();

const darkB=await capture({label:'dark-b',colorScheme:'dark',inject:true});
check('Dark B: no visible light surface',Object.values(darkB.audits).every(a=>a.light.length===0),Object.fromEntries(Object.entries(darkB.audits).map(([k,a])=>[k,a.light])));
log('Dark B text under 4.5:1',JSON.stringify(Object.fromEntries(Object.entries(darkB.audits).map(([k,a])=>[k,a.weak]))));
await darkB.context.close();

const dark=await capture({label:'dark-a',colorScheme:'dark'});
const {page}=dark;
check('R2: System follows a dark OS',await theme(page)==='dark');
check('R5: System under a dark OS is dark before the body parses',await page.evaluate(()=>window.__bodyTheme)==='dark');
check('R7: Dark A has no visible light surface',Object.values(dark.audits).every(a=>a.light.length===0),Object.fromEntries(Object.entries(dark.audits).map(([k,a])=>[k,a.light])));
const weak=Object.fromEntries(Object.entries(dark.audits).map(([k,a])=>[k,a.weak]));
log('Dark A text under 4.5:1',JSON.stringify(weak));
check('R7: Dark A has no text under 3:1',Object.values(weak).every(entries=>Object.values(entries).every(v=>v>=3)),weak);

// R1, R3, R6: the Settings select changes the theme with no remount. The editor root keeps a mark across the changes.
const select=page.getByLabel('Theme');
check('R1: Settings has a Theme select with System, Light, Dark',JSON.stringify(await select.locator('option').allTextContents())==='["System","Light","Dark"]'&&await select.inputValue()==='system');
await page.evaluate(()=>{document.querySelector('.editor-window').__mark='kept';});
const step=async(value,expected,frame)=>{
 await select.selectOption(value);
 await settle(page,300);
 const state=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,scheme:document.documentElement.style.colorScheme,boots:window.__boots,mark:document.querySelector('.editor-window')?.__mark,frame:window.__frame.at(-1),stored:localStorage.getItem('opensekai.theme')}));
 check(`R3/R6: ${value} gives ${expected}, the frame ${frame}, and no remount`,state.theme===expected&&state.scheme===expected&&state.boots===1&&state.mark==='kept'&&state.frame===frame&&state.stored===value,state);
};
await step('light','light','light');
await page.screenshot({path:join(out,'settings-switched-light.png')});
await step('dark','dark','dark');
await step('system','dark',null);
await page.emulateMedia({colorScheme:'light'});
await settle(page,300);
check('R2: System changes when the OS changes',await theme(page)==='light');
await page.emulateMedia({colorScheme:'dark'});
await settle(page,300);
check('R2: System changes back',await theme(page)==='dark');
check('the session stays connected after the changes',await page.locator('.session-mark.connected').count()===1);
check('no page error (dark A)',dark.errors.length===0,dark.errors);
await dark.context.close();

// R4, R5: a stored Dark survives a restart under a light OS and applies before the editor mounts.
{
 publisher=null;
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,colorScheme:'light'});
 await context.addInitScript(stub,info);
 await context.addInitScript(()=>{try{localStorage.setItem('opensekai.theme','dark');}catch{}});
 const restart=await context.newPage();
 await restart.goto(ORIGIN+'/?view=editor');
 await restart.locator('.start-screen').waitFor({timeout:15000});
 const state=await restart.evaluate(()=>({body:window.__bodyTheme,mount:window.__mountTheme,theme:document.documentElement.dataset.theme,frame:window.__frame}));
 check('R4/R5: a stored Dark applies before the body parses under a light OS, and the frame gets dark',state.body==='dark'&&state.mount==='dark'&&state.theme==='dark'&&state.frame[0]==='dark',state);
 await context.close();
}

// R8: the pixel difference of Light against Light before the change.
if(mainDist){
 const read=async path=>PNG.sync.read(await readFile(path));
 for(const view of views){
  const a=await read(join(out,`${view}-light-before.png`)),b=await read(join(out,`${view}-light.png`));
  const diff=new PNG({width:a.width,height:a.height});
  let count=0,box=null;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){
   const i=(y*a.width+x)*4;
   const changed=Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>6;
   const grey=Math.round((a.data[i]+a.data[i+1]+a.data[i+2])/3*0.3+180);
   diff.data.set(changed?[255,0,80,255]:[grey,grey,grey,255],i);
   if(changed){count++;box=box?{x0:Math.min(box.x0,x),y0:Math.min(box.y0,y),x1:Math.max(box.x1,x),y1:Math.max(box.y1,y)}:{x0:x,y0:y,x1:x,y1:y};}
  }
  await writeFile(join(out,`${view}-light-diff.png`),PNG.sync.write(diff));
  log('R8 light diff',view,JSON.stringify({changedPixels:count,box}));
 }
}

clearInterval(clock);
await browser.close();
http.close();
const failed=results.filter(item=>!item.pass);
log(`${results.length-failed.length}/${results.length} passed`);
process.exit(failed.length?1:0);
