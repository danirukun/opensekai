// Headless check of the output format on the OBS page (B22 R5, R6, R9).
// The built OBS page (apps/output/dist) runs in Chromium. A stand-in for the host serves the page, answers the renderer
// WebSocket, and sends frames from a real @opensekai/session in this process on a 60 Hz clock. As the host does, it sends a
// frame only while fewer than 2 frames are unacknowledged, and an acknowledgment of a newer frame releases the older frames.
// Run from the repository root after `pnpm --filter @opensekai/output build`:
//   pnpm exec tsx docs/evaluation/output-format/headless-check.mjs
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
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));

const PORT=4175,ORIGIN=`http://127.0.0.1:${PORT}`,SESSION='session_check',W=960,H=540,WINDOW_MS=5000;
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
 const session=createSession(scene,SESSION);
 const patch=operations=>{const reply=session.applyPatch({sceneId:scene.sceneId,expectedRevision:session.inspect().revision,operations});if(!reply.ok)throw new Error(JSON.stringify(reply.error));};
 let socket=null,sequence=0,acked=0,sending=true;const counts={ticks:0,sent:0,capped:0,acks:0};const captures=new Map();
 const start=performance.now();
 // A 60 Hz clock on absolute due times, as the host clock: a late tick does not move the next one.
 const tick=()=>{
  counts.ticks++;
  if(socket&&sending){
   if(sequence-acked>=2)counts.capped++;
   else{sequence++;counts.sent++;socket.send(JSON.stringify({kind:'frame',frame:{schemaVersion:1,sessionId:SESSION,sequence,tick:sequence,elapsedMs:sequence*1000/60,scene:session.inspect()}}));}
  }
  timer=setTimeout(tick,Math.max(0,start+(counts.ticks+1)*1000/60-performance.now()));
 };
 let timer=setTimeout(tick,0);
 const context=await browser.newContext({viewport:{width:W,height:H},deviceScaleFactor:1});
 await context.routeWebSocket(descriptor.wsUrl,ws=>{
  ws.onMessage(text=>{
   const message=JSON.parse(String(text));
   if(message.kind==='auth'){ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:['read']}));socket=ws;return;}
   if(message.kind==='applied'){counts.acks++;acked=Math.max(acked,message.frame.sequence);}
   if(message.kind==='captureReply')captures.get(message.requestId)?.(message.result);
  });
 });
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(`${ORIGIN}/?quality=production_v1${backend==='webgl2'?'&backend=webgl2':''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
 const buffer=()=>page.evaluate(()=>{const c=document.querySelector('#output');const r=c.getBoundingClientRect();return {width:c.width,height:c.height,cssWidth:r.width,cssHeight:r.height};});
 await page.waitForFunction(()=>document.querySelector('#output')?.width===1920,null,{timeout:20000});
 const measure=async()=>{const before={...counts};await wait(WINDOW_MS);const s=WINDOW_MS/1000;return {ticksPerS:(counts.ticks-before.ticks)/s,sentPerS:(counts.sent-before.sent)/s,cappedPerS:(counts.capped-before.capped)/s,acksPerS:(counts.acks-before.acks)/s};};
 await wait(1000);
 const defaults=await buffer();
 check('the default output draws a 1920 x 1080 buffer (R5, R8)',defaults.width===1920&&defaults.height===1080,defaults);
 const at60=await measure();
 check('at 60 FPS the page acknowledges each frame that the host sends (R6)',at60.acksPerS>=at60.sentPerS-1&&at60.sentPerS>0,at60);
 patch([{kind:'setOutputFormat',outputId:'output_main',width:1280,height:720,fps:30,renderScale:0.75}]);
 await page.waitForFunction(()=>document.querySelector('#output')?.width===960,null,{timeout:5000}).catch(()=>{});
 const scaled=await buffer();
 check('1280 x 720 at render scale 0.75 draws a 960 x 540 buffer and keeps the CSS size (R5)',scaled.width===960&&scaled.height===540&&scaled.cssWidth===defaults.cssWidth&&scaled.cssHeight===defaults.cssHeight,scaled);
 await wait(500);
 const at30=await measure();
 check('at 30 FPS the page acknowledges about 30 frames each second on a 60 Hz host clock (R6)',at30.acksPerS>=27&&at30.acksPerS<=31&&at30.ticksPerS>=58,at30);
 // Frames pause during a capture so that the software adapter finishes the readback inside the handler timeout.
 const captureOnce=async()=>{sending=false;await wait(300);const id='cap_'+Math.random().toString(36).slice(2);const reply=new Promise(r=>captures.set(id,r));socket.send(JSON.stringify({kind:'captureRequest',requestId:id,params:{outputId:'output_main',expectedRevision:session.inspect().revision,preset:'diagnostic_v1',maxAgeMs:500}}));const result=await reply;sending=true;captures.delete(id);if(!result.ok)throw new Error(JSON.stringify(result.error));return PNG.sync.read(Buffer.from(result.data.pngBase64,'base64'));};
 const capture=async(tries=3)=>{try{return await captureOnce();}catch(error){if(tries<=1)throw error;return capture(tries-1);}};
 const png=await capture().catch(error=>error.message);
 if(typeof png==='string')log('UNKNOWN capture at 960 x 540:',png);
 else{
  // The top-left corner is far from the boxes; the diagnostic marker is at the bottom.
  const alpha=png.data[(10*png.width+10)*4+3];
  check('the capture is the 960 x 540 buffer and the transparent clear keeps alpha 0 far from geometry (R5, R8)',png.width===960&&png.height===540&&alpha===0,{width:png.width,height:png.height,alpha});
 }
 patch([{kind:'setOutputFormat',outputId:'output_main',width:1280,height:720,fps:60,renderScale:0.75}]);
 await wait(500);
 const back=await measure();
 check('after a change back to 60 FPS the page acknowledges each frame again (R6)',back.acksPerS>=back.sentPerS-1&&back.acksPerS>=50,back);
 check('no page error',errors.length===0,errors);
 clearTimeout(timer);
 await context.close();
 return {at60,at30,back};
}
const values={};
for(const backend of (process.env.BACKENDS??'webgl2').split(','))values[backend]=await run(backend);
log('values',JSON.stringify(values));
await browser.close();server.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
process.exit(failed?1:0);
