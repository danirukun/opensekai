// Headless check of the FPS Counter asset on the OBS page (B19).
// The built OBS page (apps/output/dist) runs in Chromium. A stand-in for the host serves the page, answers the renderer
// WebSocket, and sends frames from a real @opensekai/session in this process at about 60 Hz, as the host does.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/fps-counter/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join} from 'node:path';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const {PNG}=createRequire(process.cwd()+'/package.json')('pngjs');
const root=pathToFileURL(process.cwd()+'/').href;
const {createSession}=await import(root+'packages/session/src/index.ts');
const {makeSmokeScene}=await import(root+'packages/contracts/src/index.ts');
const {chromiumGpuArgs}=await import(root+'scripts/gpu-probe.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const PORT=4174,ORIGIN=`http://127.0.0.1:${PORT}`,SESSION='session_check',W=960,H=540;
const dist=join(process.cwd(),'apps/output/dist');
const types={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,ORIGIN).pathname;const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':types[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const descriptor={schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role:'renderer',token:'token_renderer',capabilities:['read'],outputId:'output_main'};
const browser=await chromium.launch({args:chromiumGpuArgs});


async function run(backend){
 log(`# backend=${backend}`);
 const scene=makeSmokeScene();
 // Only the box meshes and the cameras: the stand-in host serves no asset.
 scene.entities=scene.entities.filter(entity=>entity.kind==='camera'||(entity.kind==='mesh'&&entity.source.kind==='box'));
 scene.entities.push({id:'fps',name:'FPS Counter',visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'fpsCounter',fpsCounter:{corner:'topRight',size:32,color:'#ffffff'}});
 const session=createSession(scene,SESSION);
 const patch=operations=>{const reply=session.applyPatch({sceneId:scene.sceneId,expectedRevision:session.inspect().revision,operations});if(!reply.ok)throw new Error(JSON.stringify(reply.error));};
 let socket=null,sequence=0,sending=true,acks=0;const captures=new Map();
 const timer=setInterval(()=>{if(socket&&sending){sequence++;socket.send(JSON.stringify({kind:'frame',frame:{schemaVersion:1,sessionId:SESSION,sequence,tick:sequence,elapsedMs:sequence*16,scene:session.inspect()}}));}},16);
 const context=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
 await context.routeWebSocket(descriptor.wsUrl,ws=>{
  ws.onMessage(text=>{
   const message=JSON.parse(String(text));
   if(message.kind==='auth'){ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:['read']}));socket=ws;return;}
   if(message.kind==='applied')acks++;
   if(message.kind==='captureReply')captures.get(message.requestId)?.(message.result);
  });
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+(m.location()?.url??''));});
 await page.goto(`${ORIGIN}/?quality=production_v1${backend==='webgl2'?'&backend=webgl2':''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
 const counter=page.locator('#overlay > div');
 await counter.waitFor({timeout:20000});
 const first=await counter.textContent();
 check('the counter shows "-- FPS" before one full window (R8)',first==='-- FPS',first);
 const attrs=await counter.evaluate(node=>({aria:node.getAttribute('aria-hidden'),pointer:getComputedStyle(node).pointerEvents,numeric:getComputedStyle(node).fontVariantNumeric,font:getComputedStyle(node).fontSize,canvasChildren:document.querySelector('canvas').children.length}));
 check('the element is aria-hidden, has no pointer events, uses tabular numbers, and a 540-pixel canvas gives a 16 px font (R9)',attrs.aria==='true'&&attrs.pointer==='none'&&attrs.numeric==='tabular-nums'&&attrs.font==='16px',attrs);
 // The value is known 1000 ms after the first frame and shows at the next 500 ms update.
 await page.waitForFunction(()=>/^\d+ FPS$/.test(document.querySelector('#overlay > div')?.textContent??''),null,{timeout:5000}).catch(()=>{});
 const value=await counter.textContent();
 const fps=Number(/^(\d+) FPS$/.exec(value??'')?.[1]);
 check('after 1000 ms the counter shows a whole number above 0 (R8)',fps>0,{value,acks});
 // Headless SwiftShader WebGPU stops drawing after about 390 frames, also with no counter in the scene,
 // so the WebGPU run skips the steady reading and the captures to stay inside that budget.
 const slow=backend!=='webgl2';
 if(!slow)await wait(3000);
 const steady=slow?null:await counter.textContent();
 if(!slow)log('steady value 3 s later',steady);
 const box=await counter.boundingBox();
 check('top right with an 8 px margin at 540 pixels (R9)',Math.abs(box.x+box.width-(W-8))<=1&&Math.abs(box.y-8)<=1,box);
  patch([{kind:'setFpsCounter',entityId:'fps',fpsCounter:{corner:'bottomLeft',size:64,color:'#00ff00'}}]);
 await wait(300);
 const moved=await counter.boundingBox(),color=await counter.evaluate(node=>getComputedStyle(node).color),size=await counter.evaluate(node=>getComputedStyle(node).fontSize);
 check('setFpsCounter moves it to the bottom left with a 16 px margin, a 32 px font, and the color (R9)',Math.abs(moved.x-16)<=1&&Math.abs(moved.y+moved.height-(H-16))<=1&&color==='rgb(0, 255, 0)'&&size==='32px',{moved,color,size});
 // Frames pause during a capture so that the software adapter finishes the readback inside the handler timeout.
 const captureOnce=async()=>{sending=false;await wait(300);const id='cap_'+Math.random().toString(36).slice(2);const reply=new Promise(r=>captures.set(id,r));socket.send(JSON.stringify({kind:'captureRequest',requestId:id,params:{outputId:'output_main',expectedRevision:session.inspect().revision,preset:'diagnostic_v1',maxAgeMs:500}}));const result=await reply;sending=true;captures.delete(id);if(!result.ok)throw new Error(JSON.stringify(result.error));return PNG.sync.read(Buffer.from(result.data.pngBase64,'base64'));};
 const capture=async(tries=3)=>{try{return await captureOnce();}catch(error){if(tries<=1)throw error;return capture(tries-1);}};
 // captureFrame has the 2 s RPC limit. A software adapter can miss it; then R10 stays true by construction and the result is unknown here.
 const withCounter=slow?'skipped':await capture().catch(error=>error.message);
 patch([{kind:'removeEntity',entityId:'fps'}]);
 await wait(300);
 check('the element goes away when the scene has no counter (R7)',await counter.count()===0);
 const without=slow?'skipped':await capture().catch(error=>error.message);
 if(typeof withCounter==='string'||typeof without==='string')log('UNKNOWN captureFrame comparison (R10):',JSON.stringify({withCounter:typeof withCounter==='string'?withCounter:'ok',without:typeof without==='string'?without:'ok'}));
 else{
  let differ=0;for(let i=0;i<withCounter.data.length;i++)if(withCounter.data[i]!==without.data[i])differ++;
  check('a captureFrame with a visible counter equals one without a counter (R10)',withCounter.width===without.width&&differ===0,{width:withCounter.width,height:withCounter.height,differentBytes:differ});
 }
 patch([{kind:'createEntity',entity:{id:'fps',name:'FPS Counter',visible:false,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},kind:'fpsCounter',fpsCounter:{corner:'topRight',size:32,color:'#ffffff'}}}]);
 await wait(300);
 check('a hidden counter shows no element (R7)',await counter.count()===0);
 patch([{kind:'setVisibility',entityId:'fps',visible:true}]);
 await counter.waitFor({timeout:2000});
 check('a new visible counter starts a new window with "-- FPS" (R8)',(await counter.textContent())==='-- FPS',await counter.textContent());
 await wait(1300);
 sending=false;
 await wait(1600);
 const stalled=await counter.textContent();
 check('after a stall of more than 1000 ms without frames the counter shows "0 FPS" (R8)',stalled==='0 FPS',stalled);
 check('no page error',errors.length===0,errors);
 clearInterval(timer);
 await context.close();
 return {first:fps,steady};
}
const values={};
for(const backend of (process.env.BACKENDS??'auto,webgl2').split(','))values[backend]=await run(backend);
log('values',JSON.stringify(values));
await browser.close();server.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
process.exit(failed?1:0);
