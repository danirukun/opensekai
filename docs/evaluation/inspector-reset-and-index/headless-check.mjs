// Headless check of the Inspector reset marks, sections, and index (B17).
// The Editor window build runs in Chromium. A stand-in for the Tauri host answers the window commands and routes the
// operator WebSocket to a real @opensekai/session in this process, so each scene command runs the session code.
// Run from the repository root after `pnpm --filter @opensekai/desktop build` and `vite preview --port 4173` in apps/desktop:
//   pnpm exec tsx docs/evaluation/inspector-reset-and-index/headless-check.mjs <output dir>
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
scene.entities.push(makeAuthoringEntity('vmc','tracking_vmc',scene.entities));
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
const context=await browser.newContext({viewport:{width:1280,height:640},deviceScaleFactor:1});
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
const entity=id=>session.inspect().entities.find(item=>item.id===id);
const revision=()=>session.inspect().revision;
const marks=()=>page.evaluate(()=>[...document.querySelectorAll('.inspector .reset-mark, .inspector .row-reset:not(.at-default)')].filter(node=>node.checkVisibility()).map(node=>node.title));
const patches=()=>calls.filter(call=>call.method==='scenePatch').length;
const settle=()=>page.waitForTimeout(700);

// Add a Point Light through the Add menu, then select it.
await page.getByTitle('Add asset').click();
await page.getByRole('menuitem',{name:'Point Light',exact:true}).click();
await settle();
const point=session.inspect().entities.find(item=>item.kind==='light'&&item.light.type==='point');
await page.locator('.asset-row').filter({hasText:point.name}).first().getByRole('button').first().click();
await settle();
check('a new Point Light shows no field reset mark; only the Position row (add position is not the reset target, R1/R8)',JSON.stringify(await marks())==='["Reset Position"]',await marks());
await page.screenshot({path:out+'/point-light-new.png'});

// Drag Intensity.
const track=page.locator('input[type=range][aria-label=Intensity]');
await track.scrollIntoViewIfNeeded();
const box=await track.boundingBox();
await page.mouse.move(box.x+box.width*.3,box.y+box.height/2);await page.mouse.down();
await page.mouse.move(box.x+box.width*.6,box.y+box.height/2,{steps:8});await page.mouse.up();
await page.waitForTimeout(1200);
const dragged=entity(point.id).light.intensity;
check('a drag of Intensity shows the Intensity mark (R5)',(await marks()).includes('Reset Intensity')&&dragged!==20,{intensity:dragged,marks:await marks()});
const before={patches:patches(),revision:revision()};
await page.getByTitle('Reset Intensity').click();
await settle();
const after={patches:patches(),revision:revision(),intensity:entity(point.id).light.intensity};
check('one click sends exactly one scenePatch, Intensity is 20, the revision increases by one, the mark goes away (R6)',after.patches-before.patches===1&&after.intensity===20&&after.revision===before.revision+1&&!(await marks()).includes('Reset Intensity'),{before,after});
const last=calls.filter(call=>call.method==='scenePatch').at(-1).params;
check('the reset patch is an ordinary setLight with the current expectedRevision (R6)',last.operations.length===1&&last.operations[0].kind==='setLight'&&last.expectedRevision===before.revision,last);

// Change Range from outside the editor through the same session command API that MCP scene_patch uses.
const light=entity(point.id).light;
const outside=await api.scenePatch({sceneId:session.inspect().sceneId,expectedRevision:revision(),operations:[{kind:'setLight',entityId:point.id,light:{...light,range:4}}]});
await page.waitForTimeout(1500);
check('an outside scenePatch of Range shows the Range mark after the revision arrives (R9)',outside.ok&&(await marks()).includes('Reset Range (m)'),{ok:outside.ok,marks:await marks()});

// Transform Position row.
await page.getByTitle('Reset Position').click();
await settle();
const position=entity(point.id).transform.position;
check('the Position button resets to zero and then hides (R8)',position.every(v=>v===0)&&!(await marks()).includes('Reset Position'),{position,marks:await marks()});
const x=page.getByLabel('position X',{exact:true});
await x.fill('1.5');await x.press('Tab');
await page.waitForTimeout(1200);
check('the Position button shows again after a move (R8)',(await marks()).includes('Reset Position'),{position:entity(point.id).transform.position,marks:await marks()});

// Sections and index on a light with a shadow.
await page.getByRole('checkbox',{name:'Shadow',exact:true}).check();
await settle();
const index=()=>page.evaluate(()=>{const nav=document.querySelector('nav.inspector-index');return nav?{entries:[...nav.querySelectorAll('button')].map(b=>b.textContent),current:nav.querySelector('[aria-current=true]')?.textContent??null}:null;});
const columnWidth=()=>page.evaluate(()=>document.querySelector('.properties-column').clientWidth);
check('the index lists Transform, Light, Affect, Shadow (R11, R13)',JSON.stringify((await index())?.entries)==='["Transform","Light","Affect","Shadow"]',{index:await index(),width:await columnWidth()});
const scrollTo=async top=>{await page.evaluate(top=>{document.querySelector('.properties-column').scrollTop=top;},top);await page.waitForTimeout(250);};
await scrollTo(0);const atTop=(await index()).current;
const lightTop=await page.evaluate(()=>{const c=document.querySelector('.properties-column');const s=document.querySelector('[data-section=light]');return s.getBoundingClientRect().top-c.getBoundingClientRect().top+c.scrollTop;});
await scrollTo(lightTop);const atLight=(await index()).current;
await scrollTo(100000);const atEnd=(await index()).current;
check('scrolling moves aria-current: top, Light heading, end (R14)',atTop==='Transform'&&atLight==='Light'&&atEnd==='Shadow',{atTop,atLight,atEnd});
await page.screenshot({path:out+'/light-index-scrolled.png'});
await scrollTo(0);
await page.emulateMedia({reducedMotion:'reduce'});
await page.locator('nav.inspector-index').getByRole('button',{name:'Affect'}).click();
await page.waitForTimeout(400);
const jump=await page.evaluate(()=>{const c=document.querySelector('.properties-column');const h=document.querySelector('[data-section=affect] .section-heading');return {offset:Math.round(h.getBoundingClientRect().top-c.getBoundingClientRect().top),focused:document.activeElement===h,current:document.querySelector('nav.inspector-index [aria-current=true]')?.textContent,scrollTop:c.scrollTop,max:c.scrollHeight-c.clientHeight};});
check('a click on Affect scrolls its heading to the top of the column, focuses it, and marks it current (R16)',Math.abs(jump.offset)<=1&&jump.focused&&jump.current==='Affect',jump);
await page.emulateMedia({reducedMotion:'no-preference'});
await page.locator('nav.inspector-index').getByRole('button',{name:'Shadow'}).click();
await page.waitForTimeout(1200);
const jumpShadow=await page.evaluate(()=>{const c=document.querySelector('.properties-column');const h=document.querySelector('[data-section=shadow] .section-heading');return {offset:Math.round(h.getBoundingClientRect().top-c.getBoundingClientRect().top),focused:document.activeElement===h,current:document.querySelector('nav.inspector-index [aria-current=true]')?.textContent,scrollTop:c.scrollTop,max:c.scrollHeight-c.clientHeight};});
check('a smooth jump to Shadow ends with Shadow focused and current; its heading is at the top or the column is at its end (R16)',jumpShadow.focused&&jumpShadow.current==='Shadow'&&(Math.abs(jumpShadow.offset)<=1||Math.abs(jumpShadow.scrollTop-jumpShadow.max)<=1),jumpShadow);

// Collapse Affect with the keyboard, reload, and it stays collapsed.
await page.locator('[data-section=affect] .section-heading').focus();
await page.keyboard.press('Enter');
await settle();
const collapsed=await page.evaluate(()=>({expanded:document.querySelector('[data-section=affect] .section-heading').getAttribute('aria-expanded'),hidden:document.querySelector('[data-section=affect] .section-body').hidden,mounted:document.querySelectorAll('[data-section=affect] input[type=checkbox]').length,stored:localStorage.getItem('opensekai.inspector.sections')}));
check('Enter collapses Affect; its fields stay mounted and the state is in opensekai.inspector.sections (R10, R12)',collapsed.expanded==='false'&&collapsed.hidden&&collapsed.mounted===3&&JSON.parse(collapsed.stored).collapsed.includes('light:affect'),collapsed);
await page.reload();
await page.getByText('Session connected').waitFor({timeout:15000});
await page.locator('.asset-row').filter({hasText:point.name}).first().getByRole('button').first().click();
await settle();
const reloaded=await page.evaluate(()=>document.querySelector('[data-section=affect] .section-heading')?.getAttribute('aria-expanded'));
check('Affect is still collapsed after a reload (R12)',reloaded==='false',reloaded);
await page.screenshot({path:out+'/light-affect-collapsed.png'});

// Keyboard order: the marks are in the tab order of the fields (R5).
await page.locator('input[type=range][aria-label="Range (m)"]').focus();
await page.keyboard.press('Tab');
const afterRange=await page.evaluate(()=>document.activeElement?.title);
await page.keyboard.press('Tab');
const afterMark=await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')??document.activeElement?.type);
check('Tab from the Range slider reaches the Range mark, then the next field (R5)',afterRange==='Reset Range (m)'&&afterMark==='Volumetric'||afterRange==='Reset Range (m)'&&afterMark==='checkbox',{afterRange,afterMark});

// Tracking source: Receiver open; Smoothing, Face, Diagnostics start collapsed; no Advanced disclosure.
await page.locator('.asset-row').filter({hasText:'VMC Receiver'}).first().getByRole('button').first().click();
await settle();
const tracking=await page.evaluate(()=>({sections:[...document.querySelectorAll('.inspector-section')].map(s=>[s.dataset.section,s.querySelector('.section-heading').getAttribute('aria-expanded')]),advanced:document.querySelectorAll('.inspector details.advanced').length,index:[...document.querySelectorAll('nav.inspector-index button')].map(b=>b.textContent)}));
check('a tracking source shows Receiver open and Smoothing, Face, Diagnostics collapsed, without Advanced (R11, R12)',JSON.stringify(tracking.sections)==='[["receiver","true"],["smoothing","false"],["face","false"],["diagnostics","false"]]'&&tracking.advanced===0,tracking);
await page.locator('nav.inspector-index').getByRole('button',{name:'Smoothing'}).click();
await settle();
const beta=page.locator('input[type=range][aria-label=Beta]');
await beta.scrollIntoViewIfNeeded();
const bb=await beta.boundingBox();
await page.mouse.click(bb.x+bb.width*.8,bb.y+bb.height/2);
await page.waitForTimeout(1200);
const smoothingBefore=entity('tracking_vmc').smoothing;
await page.getByTitle('Reset Beta').click();
await settle();
const smoothingAfter=entity('tracking_vmc').smoothing;
check('a Beta reset sets only Beta to 0.5 (R6)',smoothingBefore&&smoothingBefore.beta!==.5&&smoothingAfter.beta===.5&&smoothingAfter.minCutoff===smoothingBefore.minCutoff&&smoothingAfter.enabled===smoothingBefore.enabled,{smoothingBefore,smoothingAfter});
await page.screenshot({path:out+'/tracking-smoothing.png'});

// A narrow properties column shows no index (R13).
await page.setViewportSize({width:760,height:640});
await page.waitForTimeout(300);
const narrow={width:await columnWidth(),index:await index()};
check('a properties column under 520 px shows no index (R13)',narrow.width<520&&narrow.index===null,narrow);
await page.evaluate(()=>{const a=document.querySelector('.assets-column');a.style.width='160px';});
await page.setViewportSize({width:1280,height:640});

// A new selection starts at the top of the column (R17).
await scrollTo(100000);
await page.locator('.asset-row').filter({hasText:point.name}).first().getByRole('button').first().click();
await settle();
const top=await page.evaluate(()=>document.querySelector('.properties-column').scrollTop);
check('a change of the selected entity scrolls the column to the top (R17)',top===0,top);

log(JSON.stringify({passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,scenePatchCalls:patches(),finalRevision:revision(),userAgent:await page.evaluate(()=>navigator.userAgent)}));
await browser.close();
process.exit(results.every(r=>r.pass)?0:1);
