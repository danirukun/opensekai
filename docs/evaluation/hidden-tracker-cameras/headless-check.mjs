// Headless check of the hidden tracker cameras (B18).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands, routes the
// operator WebSocket to a real @opensekai/session in this process, and sends `trackingDevices` as the Scene window does.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/hidden-tracker-cameras/headless-check.mjs <output dir>
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(process.cwd()+'/apps/desktop/package.json');
const {chromium}=require('playwright');
const root=pathToFileURL(process.cwd()+'/').href;
const {createSession,sessionApi,SESSION_METHODS}=await import(root+'packages/session/src/index.ts');
const {makeEmptyScene,makeAuthoringEntity}=await import(root+'apps/desktop/src/editor/authoring.ts');
const out=process.argv[2]??'.';
const results=[];
const log=(...a)=>console.log(...a);
const check=(name,pass,detail)=>{results.push({name,pass});log(pass?'PASS':'FAIL',name,detail===undefined?'':JSON.stringify(detail));};

const SESSION='session_check',ORIGIN='http://127.0.0.1:4173';
const scene=makeEmptyScene();
const source=makeAuthoringEntity('mediapipe','tracking_mediapipe',scene.entities);
scene.entities.push(source);
const session=createSession(scene,SESSION);
const api=sessionApi(session);
const calls=[];
const descriptor=(role,capabilities,outputId)=>({schemaVersion:1,sessionId:SESSION,httpOrigin:ORIGIN+'/',wsUrl:'ws://127.0.0.1:4173/ws',role,token:`token_${role}`,capabilities,outputId});
const status=()=>({ok:true,data:{schemaVersion:1,sessionId:SESSION,ready:true,revision:session.inspect().revision,capabilities:['read','edit'],warnings:[],outputs:[]}});
async function answer(method,params){
 if(method==='appStatus')return status();
 if(SESSION_METHODS.includes(method))return api[method](params);
 return {ok:false,error:{code:'UNAVAILABLE',message:'Not in the headless host',ids:[]}};
}

const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1});
await context.addInitScript(({operator,output})=>{
 let next=1;const callbacks=new Map(),listeners=new Map();
 window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}};
 // The Scene window sends UI messages on this event; the check calls it to deliver `trackingDevices`.
 window.__sendUI=payload=>{for(const id of listeners.get('opensekai-editor-ui')??[])callbacks.get(id)?.({event:'opensekai-editor-ui',id:0,payload});};
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
  calls.push({method:message.method,params:message.params});
  ws.send(JSON.stringify({kind:'reply',requestId:message.requestId,result:await answer(message.method,message.params)}));
 });
});
const devices=[{deviceId:'cam-facetime',label:'FaceTime HD Camera'},{deviceId:'cam-usb',label:'USB Webcam'},{deviceId:'cam-vseeface',label:'VSeeFace Camera'},{deviceId:'cam-obs',label:'OBS Virtual Camera'},{deviceId:'cam-slow',label:`${'a'.repeat(127)}!`}];
const page=await context.newPage();
page.on('pageerror',error=>log('pageerror',error.message));
const open=async()=>{
 await page.goto(ORIGIN+'/?view=editor');
 await page.getByText('Session connected').waitFor({timeout:15000});
 await page.locator('.asset-row').filter({hasText:source.name}).first().getByRole('button').first().click();
 await page.getByLabel('Hidden cameras').waitFor({timeout:5000});
 await page.evaluate(devices=>window.__sendUI({kind:'trackingDevices',devices}),devices);
 await settle();
};
const settle=()=>page.waitForTimeout(500);
const options=()=>page.evaluate(()=>[...document.querySelectorAll('.inspector select option')].map(option=>option.textContent.trim()));
const field=()=>page.getByLabel('Hidden cameras');
const alerts=()=>page.evaluate(()=>[...document.querySelectorAll('.hidden-cameras [role=alert]')].map(node=>node.textContent));
const stored=()=>page.evaluate(()=>localStorage.getItem('opensekai.tracking.hiddenCameras'));
const patches=()=>calls.filter(call=>call.method==='scenePatch').length;
const type=async text=>{await field().fill(text);await settle();};

await open();
const first=await options();
check('the VSeeFace device is absent and the OBS device is present with the default list (R1, R4)',!first.includes('VSeeFace Camera')&&first.includes('OBS Virtual Camera')&&first.includes('FaceTime HD Camera')&&first[0]==='Default camera',first);
check('the field shows the default list (R4)',(await field().inputValue())==='VSeeFace\nVTube Studio\nVMC\nUnity Video Capture\nOpenSekai',await field().inputValue());
await page.screenshot({path:out+'/defaults.png'});
const before=patches();
await type((await field().inputValue())+'\nobs');
check('a new line "obs" hides the OBS device at once, with no Apply and no scenePatch (R2, R3)',!(await options()).includes('OBS Virtual Camera')&&patches()===before,{options:await options(),patches:patches()-before});
check('the valid patterns are saved in opensekai.tracking.hiddenCameras (R5)',(await stored())==='["VSeeFace","VTube Studio","VMC","Unity Video Capture","OpenSekai","obs"]',await stored());
await page.reload();await open();
check('a reload keeps the edit (R5)',!(await options()).includes('OBS Virtual Camera')&&(await field().inputValue()).endsWith('\nobs'),{options:await options()});
await page.getByRole('button',{name:'Restore defaults'}).click();await settle();
check('"Restore defaults" shows the OBS device again and sends no scenePatch (R2, R4)',(await options()).includes('OBS Virtual Camera')&&patches()===before&&!(await field().inputValue()).includes('obs'),{options:await options(),patches:patches()-before});
await type('VSeeFace\n[\nobs');
check('an invalid line shows "Line 2 is not used." and the other lines still apply; the field keeps the text (R8)',JSON.stringify(await alerts())==='["Line 2 is not used."]'&&!(await options()).includes('OBS Virtual Camera')&&(await field().inputValue())==='VSeeFace\n[\nobs'&&(await stored())==='["VSeeFace","obs"]',{alerts:await alerts(),stored:await stored()});
await page.screenshot({path:out+'/invalid-line.png'});
const start=Date.now();
await type('(a+)+$');
const slow={alerts:await alerts(),options:await options(),stored:await stored(),ms:Date.now()-start};
check('a backtracking pattern shows "Patterns take too long.", shows every device, and does not save (R9)',JSON.stringify(slow.alerts)==='["Patterns take too long."]'&&slow.options.includes('VSeeFace Camera')&&slow.options.includes('OBS Virtual Camera')&&slow.stored==='["VSeeFace","obs"]',slow);
await page.screenshot({path:out+'/too-long.png'});
await type('VSeeFace\nobs');
check('the next change matches again in a new Worker (R9)',(await alerts()).length===0&&!(await options()).includes('OBS Virtual Camera'),{alerts:await alerts(),options:await options()});
// Select the OBS camera in the draft, then hide it: the selected device stays.
await type('VSeeFace');
await page.locator('.inspector select').first().selectOption('cam-obs');
await type('VSeeFace\nobs');
const kept=await options();
check('the device that the draft selects stays with its label when a pattern matches it (R7)',kept.includes('OBS Virtual Camera')&&!kept.includes('Unavailable camera')&&!kept.includes('VSeeFace Camera'),kept);
const outside=await page.evaluate(()=>{const area=document.querySelector('.hidden-cameras textarea');return {inForm:!!area.closest('form'),button:document.querySelector('.hidden-cameras button').type};});
check('the field and the button are outside the source form, and the button has type="button" (R2)',!outside.inForm&&outside.button==='button',outside);
await page.screenshot({path:out+'/selected-kept.png'});

const failed=results.filter(result=>!result.pass).length;
log(`${results.length-failed} pass, ${failed} fail`);
await browser.close();
process.exit(failed?1:0);
