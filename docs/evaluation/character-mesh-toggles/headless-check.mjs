// Headless render check of the character mesh toggles on the OBS page (B26 R7). A functional check on the software adapter,
// not a visual quality check: it counts the drawn pixels of the fixture avatar with no hidden mesh, with Hair hidden, and
// with each mesh hidden. The built OBS page (apps/output/dist) runs in Chromium. A stand-in for the host serves the page and
// the fixture VRM, answers the renderer WebSocket, and sends frames from a real @opensekai/session (the method of the B22 check).
// Run from the repository root after `pnpm --filter @opensekai/output build` and `pnpm fixtures`:
//   pnpm exec tsx docs/evaluation/character-mesh-toggles/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
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

const manifestPath='fixtures/local/manifest.json';
if(!existsSync(manifestPath)){log('SKIP: no',manifestPath);process.exit(0);}
const fixture=JSON.parse(readFileSync(manifestPath,'utf8')).assets.find(asset=>asset.record.id==='fixture_vrm_1');
const vrm=readFileSync(fixture.path);
const PORT=4176,ORIGIN=`http://127.0.0.1:${PORT}`,SESSION='session_check';
const dist=join(process.cwd(),'apps/output/dist');
const types={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,ORIGIN).pathname;if(path==='/assets/fixture_vrm_1'){res.writeHead(200,{'content-type':'model/gltf-binary','content-length':vrm.length});res.end(vrm);return;}const body=await readFile(join(dist,path==='/'?'index.html':path));res.writeHead(200,{'content-type':types[extname(path)]??(path==='/'?'text/html':'application/octet-stream')});res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
const descriptor={schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:`ws://127.0.0.1:${PORT}/ws`,role:'renderer',token:'token_renderer',capabilities:['read'],outputId:'output_main'};
const browser=await chromium.launch({args:chromiumGpuArgs});
const backend=process.env.BACKEND??'webgl2';
log(`# backend=${backend}`);
// The smoke avatar and the close camera only. The output uses the close camera.
const scene=makeSmokeScene();
scene.entities=scene.entities.filter(entity=>entity.kind==='camera'||entity.kind==='avatar');
for(const output of scene.outputs)output.cameraId='camera_close';
const session=createSession(scene,SESSION);
const patch=operations=>{const reply=session.applyPatch({sceneId:scene.sceneId,expectedRevision:session.inspect().revision,operations});if(!reply.ok)throw new Error(JSON.stringify(reply.error));};
// A small output (960 x 540 at render scale 0.5, 30 FPS) keeps the software adapter fast enough for a page screenshot.
patch([{kind:'setOutputFormat',outputId:'output_main',width:960,height:540,fps:30,renderScale:0.5}]);
let socket=null,sequence=0,acked=0,sending=true;
const timer=setInterval(()=>{if(socket&&sending&&sequence-acked<2){sequence++;socket.send(JSON.stringify({kind:'frame',frame:{schemaVersion:1,sessionId:SESSION,sequence,tick:sequence,elapsedMs:sequence*1000/60,scene:session.inspect()}}));}},1000/60);
const context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
await context.routeWebSocket(descriptor.wsUrl,ws=>{
 ws.onMessage(text=>{
  const message=JSON.parse(String(text));
  if(message.kind==='auth'){ws.send(JSON.stringify({kind:'authReply',sessionId:SESSION,schemaVersion:1,capabilities:['read']}));socket=ws;return;}
  if(message.kind==='applied')acked=Math.max(acked,message.frame.sequence);
 });
});
const page=await context.newPage();
const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto(`${ORIGIN}/?quality=production_v1${backend==='webgl2'?'&backend=webgl2':''}#${encodeURIComponent(JSON.stringify(descriptor))}`);
// A page screenshot with a transparent background, not the capture protocol: the capture handler timeout is shorter than a
// VRM readback on the software adapter. The page clears to alpha 0, so the screenshot keeps the alpha of the output.
const capture=async()=>{sending=false;await wait(500);try{return PNG.sync.read(await page.screenshot({omitBackground:true,timeout:90000}));}finally{sending=true;}};
// Drawn pixels: alpha above 0.
const drawn=png=>{let count=0;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.data[(y*png.width+x)*4+3]>0)count++;return count;};
const shot=async name=>{await wait(3000);const png=await capture();if(name)writeFileSync(join(out,name+'.png'),PNG.sync.write(png));return drawn(png);};
// Wait for the model: the first capture with drawn pixels.
let all=0;for(let i=0;i<10&&all===0;i++){await wait(1000);all=await shot('all-meshes');}
check('the fixture avatar draws with no hidden mesh',all>0,{drawn:all});
patch([{kind:'setHiddenMeshes',entityId:'performer',hiddenMeshes:['Hair']}]);
const hair=await shot('hair-hidden');
check('hiding Hair draws fewer pixels and keeps the rest of the avatar (R7)',hair>0&&hair<all,{all,hair});
patch([{kind:'setHiddenMeshes',entityId:'performer',hiddenMeshes:['Body','Face','Hair']}]);
const none=await shot();
check('hiding each mesh draws nothing, and the transparent clear keeps alpha 0 (R7)',none===0,{none});
patch([{kind:'setHiddenMeshes',entityId:'performer',hiddenMeshes:[]}]);
const back=await shot();
check('an empty list shows each mesh again without a reload (R7)',Math.abs(back-all)<=all*0.02,{all,back});
check('no page error',errors.length===0,errors);
clearInterval(timer);
await browser.close();server.close();
const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
process.exit(failed?1:0);
