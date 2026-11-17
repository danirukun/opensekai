<script lang="ts">
 import {onDestroy,onMount,untrack} from 'svelte';
 import {Button,Input,Select,Spinner} from '@oshi-connect/ui';
 import {X} from '@lucide/svelte';
 import {DEFAULT_TRACKING_MAPPING,EXPRESSION_STEPS,FAILED_TRACKING_STATES,type AppApi,type AssetRecord,type ExpressionStepId,type Id,type TrackingProbe,type TrackingStatus} from '@opensekai/contracts';
 import type {EditorModel,EditorView} from '../editor/model';
 import {facePart,guideStep,initialGuide,mainValue,type GuideEffect,type GuideEvent,type GuideStep} from '../editor/tracking-guide';
 import {planCancel,planSetup,setupSnapshot,type GuideSnapshot,type PlannedPart} from '../editor/tracking-guide-plan';
 import {bodyOptions,canContinue,changeFace,faceOptions,initialChoice,resolveSetup,showsHands,type ChoiceOption,type FaceChoice,type SetupChoice,type SetupPart} from '../editor/tracking-guide-setup';
 import {groupLevel,rankAddresses,relaxHeading,relaxSecondsLeft,stepProgress,waitsForNext} from '../editor/tracking-guide-view';
 import {parseCameraList,trackingStateLabel,type FaceKitCommands} from '../editor/facekit';
 import {cameraOptions} from '../tracking/hidden-cameras';
 import {hiddenCameras} from '../tracking/hidden-cameras-store.svelte';
 import type {CameraDevice} from '../tracking/mediapipe';
 import CoachFace from './CoachFace.svelte';
 import GuideMeter from './GuideMeter.svelte';
 let {avatarId,model,view,api,assets=[],localAddresses=[],trackingStatus=[],devices=[],faceKit=null,isMac=false,disabled=false,onclose}:{avatarId:string;model:EditorModel;view:EditorView;api:AppApi;assets?:AssetRecord[];localAddresses?:string[];trackingStatus?:TrackingStatus[];devices?:CameraDevice[];faceKit?:FaceKitCommands|null;isMac?:boolean;disabled?:boolean;onclose:()=>void}=$props();

 const STEPS:GuideStep[]=['pick','connect','relax','expressions','review'];
 const PROMPTS:Record<ExpressionStepId,string>={blink:'Blink',mouthWide:'Open your mouth wide',browsUp:'Raise your brows',smile:'Smile',frown:'Frown',pucker:'Pucker your lips',puffCheeks:'Puff your cheeks',tongueOut:'Stick out your tongue',lookAround:'Look around'};
 const GROUPS=[['Eyes',EXPRESSION_STEPS.blink.main],['Mouth',EXPRESSION_STEPS.mouthWide.main],['Brows',EXPRESSION_STEPS.browsUp.main]] as const;

 let guide=$state.raw(initialGuide()),probes=$state.raw<Record<Id,TrackingProbe>>({}),now=$state(performance.now());
 let choice=$state<SetupChoice>(untrack(()=>view.scene?initialChoice(view.scene,avatarId):{face:'webcam',body:'same',hands:true})),limitReached=$state(false);
 let askPhone=$state(false),phone=$state(''),phoneTaken=$state(false),planned=$state.raw<PlannedPart[]>([]),connecting=$state(false),retry=$state(false),error=$state<string|null>(null),probeError=$state<string|null>(null),closing=$state(false);
 let hostCameras=$state.raw<CameraDevice[]>([]),hostCamerasLoaded=false;
 let snapshot:GuideSnapshot|null=null,pendingParts:SetupPart[]=[],finished=false,resetNext=false,inFlight=false,probeFailures=0,avatarGone=false,timer:ReturnType<typeof setInterval>|undefined;
 let effects:Promise<void>=Promise.resolve();

 const avatar=$derived(view.scene?.entities.find(e=>e.id===avatarId&&e.kind==='avatar'));
 const sourceOf=(id:Id|null)=>{const found=id?view.scene?.entities.find(e=>e.id===id):undefined;return found?.kind==='tracking'?found:undefined;};
 const source=$derived(sourceOf(guide.faceSourceId));
 const probe=$derived(guide.faceSourceId?probes[guide.faceSourceId]??null:null);
 const stepId=$derived(guide.step==='expressions'?facePart(guide)?.preset.steps[guide.index]:undefined);
 const current=$derived(STEPS.indexOf(guide.step));
 const addresses=$derived(rankAddresses(localAddresses));
 const faces=$derived(view.scene?faceOptions(isMac,view.scene,avatarId):[]);
 const bodies=$derived(bodyOptions(choice.face));
 const usesHostCamera=$derived(guide.parts.some(part=>part.preset.connect==='pickHostCamera'));
 const usesCamera=$derived(guide.parts.some(part=>part.preset.connect==='pickCamera'||part.preset.connect==='pickHostCamera'));
 $effect(()=>{if(usesCamera)hiddenCameras.setDevices([...devices,...hostCameras]);});
 // The FaceKit camera list loads one time, when its Connect block shows.
 $effect(()=>{if(usesHostCamera&&!hostCamerasLoaded){hostCamerasLoaded=true;void (async()=>{try{hostCameras=parseCameraList(await faceKit?.list());}catch{/* no list */}})();}});

 // Every guide write runs in this one chain, so a cancel can wait for the writes that are in flight.
 const queue=(task:()=>Promise<void>)=>{effects=effects.then(task).catch(()=>{});};
 function dispatch(event:GuideEvent){
  const out=guideStep(guide,event);guide=out.state;
  for(const effect of out.effects)queue(()=>run(effect));
 }
 async function run(effect:GuideEffect){
  if(effect.kind==='connect'){pendingParts=effect.parts;if(effect.parts.some(part=>part.preset.connect==='askPhone'))askPhone=true;else await connect(effect.parts,null);}
  else if(effect.kind==='resetPeaks')resetNext=true;
  else if(effect.kind==='calibrate'){const reply=await model.calibrateTracking(effect.sourceId);if(!reply.ok)error=reply.error.message;}
  else if(effect.kind==='fit'){
   const reply=await model.fitBlendShapeRanges(effect.sourceId,effect.neutral);
   dispatch(reply.ok?{kind:'fitted'}:{kind:'fitFailed',message:reply.error.message});
  }
 }
 function next(){
  const scene=model.read().scene;if(!scene)return;
  const parts=resolveSetup(choice);
  limitReached='blocked' in planSetup(scene,avatarId,parts,null,undefined,'limit-check');
  if(!limitReached)dispatch({kind:'pick',parts});
 }
 async function connect(parts:SetupPart[],phoneAddress:string|null){
  const scene=model.read().scene,target=scene?.entities.find(e=>e.id===avatarId);
  if(!scene||target?.kind!=='avatar'){error='Character not found';return;}
  // A connect that ran before keeps its snapshot, so a queued second connect cannot replace it.
  if(snapshot)return;
  const eyeBones=assets.find(asset=>asset.id===target.assetId)?.eyeBones;
  const plan=planSetup(scene,avatarId,parts,phoneAddress,eyeBones,crypto.randomUUID());
  if('blocked' in plan){error='Tracking source limit reached';retry=true;return;}
  phoneTaken=plan.needsPhone&&phoneAddress!==null;
  retry=false;
  if(plan.needsPhone){askPhone=true;return;}
  snapshot=setupSnapshot(scene,avatarId,plan);
  connecting=true;error=null;
  const reply=await model.applyOperations(plan.ops,scene.revision);
  connecting=false;
  if(!reply.ok){snapshot=null;error=reply.error.message;retry=phoneAddress===null;return;}
  askPhone=false;planned=plan.parts;
  dispatch({kind:'connected',sourceIds:plan.parts.map(part=>part.sourceId)});
 }
 function setCamera(sourceId:Id,deviceId:string){
  queue(async()=>{
   const scene=model.read().scene,target=scene?.entities.find(e=>e.id===sourceId);
   if(!scene||target?.kind!=='tracking'||!('deviceId' in target.config)||target.config.deviceId===deviceId)return;
   const reply=await model.setTrackingConfig(sourceId,{...target.config,deviceId},scene.revision);
   if(!reply.ok)error=reply.error.message;
  });
 }
 // One poll asks for each source of the run (at most two) and gives one probe event for each.
 function poll(){
  now=performance.now();
  const ids=guide.parts.flatMap(part=>part.sourceId?[part.sourceId]:[]);
  if(ids.length===0||inFlight||closing||finished)return;
  inFlight=true;
  const reset=resetNext;resetNext=false;
  const face=guide.faceSourceId;
  Promise.all(ids.map(sourceId=>api.trackingProbe(reset&&sourceId===face?{sourceId,resetPeaks:true}:{sourceId}).catch(()=>null)))
   .then(replies=>{
    if(closing||finished)return;
    const failure=replies.find(reply=>!reply?.ok);
    if(failure!==undefined){failed(reset,failure===null?'Tracking unavailable':!failure.ok&&failure.error.code==='NOT_FOUND'?'Source removed':!failure.ok?failure.error.message:'Tracking unavailable');}
    else{probeFailures=0;probeError=null;}
    for(const reply of replies)if(reply?.ok){probes={...probes,[reply.data.sourceId]:reply.data};dispatch({kind:'probe',probe:reply.data,nowMs:performance.now()});}
   })
   .finally(()=>{inFlight=false;});
 }
 function failed(reset:boolean,message:string){
  if(reset)resetNext=true;
  probeFailures+=1;
  if(probeFailures>=3)probeError=message;
 }
 function start(){if(timer===undefined)timer=setInterval(poll,100);}
 function stop(){clearInterval(timer);timer=undefined;}
 // The model refuses a write while another editor write is pending.
 async function idle(){for(let tries=0;tries<100&&model.read().pending;tries++)await new Promise(resolve=>setTimeout(resolve,50));}
 // A close before Done puts back the bindings, the mappings, and the source settings from before the run. A failed cancel keeps the guide open.
 async function cancel():Promise<boolean>{
  if(closing||finished)return false;
  closing=true;stop();
  await effects;await idle();
  const scene=model.read().scene;
  const operations=snapshot&&scene?planCancel(scene,snapshot):[];
  if(operations.length>0){
   const reply=await model.applyOperations(operations);
   if(!reply.ok){error=reply.error.message;closing=false;start();return false;}
  }
  return true;
 }
 async function close(){if(await cancel())onclose();}
 function done(){finished=true;stop();onclose();}
 function setEyeBones(box:HTMLInputElement){
  const checked=box.checked;
  queue(async()=>{
   const scene=model.read().scene,target=scene?.entities.find(e=>e.id===guide.faceSourceId);
   if(!scene||target?.kind!=='tracking')return;
   const reply=await model.setTrackingMapping(target.id,{...(target.mapping??structuredClone(DEFAULT_TRACKING_MAPPING)),useEyeBones:checked},scene.revision);
   if(!reply.ok)box.checked=target.mapping?.useEyeBones??true;
  });
 }
 // The kit Select has no disabled option, so this marks the rendered options after each options change.
 const disableOptions=(options:ChoiceOption<string>[])=>(node:HTMLElement)=>{for(const option of node.querySelectorAll('option'))option.disabled=options.find(item=>item.value===option.value)?.disabled??false;};
 const failure=(status:TrackingStatus|undefined)=>status!==undefined&&(FAILED_TRACKING_STATES as readonly string[]).includes(status.state)?status:undefined;
 // A deleted character ends the run; planCancel removes the sources that the guide created.
 $effect(()=>{if(view.scene&&!avatar&&!closing&&!finished&&!avatarGone){avatarGone=true;void close();}});
 onMount(start);
 // An unmount (app teardown, hot reload) only stops the probe. A rail panel switch keeps the guide mounted.
 onDestroy(stop);
</script>
<section class="editor-panel tracking-guide" aria-labelledby="guide-heading">
 <header>
  <h2 id="guide-heading">{avatar?.name??'Character'}</h2>
  <Button variant="ghost" size="sm" title="Close" disabled={closing||connecting} onclick={close}><X size={16}/><span class="sr-only">Close</span></Button>
 </header>
 <ol class="steps" aria-label="Steps">{#each STEPS as item,index (item)}<li class:on={index<=current} aria-current={index===current?'step':undefined}></li>{/each}</ol>

 {#if guide.step==='pick'}
  <div {@attach disableOptions(faces)}><Select label="Face" value={choice.face} options={faces} {disabled} onchange={event=>{choice=changeFace(choice,event.currentTarget.value as FaceChoice);limitReached=false;}}/></div>
  <div {@attach disableOptions(bodies)}><Select label="Body" value={choice.body} options={bodies} {disabled} onchange={event=>{choice={...choice,body:event.currentTarget.value as SetupChoice['body']};limitReached=false;}}/></div>
  {#if showsHands(choice)}<label class="option"><input type="checkbox" checked={choice.hands} {disabled} onchange={event=>{choice={...choice,hands:event.currentTarget.checked};}}/>Hands</label>{/if}
  {#if limitReached}<p role="alert">Tracking source limit reached</p>{/if}
  <div class="actions"><Button variant="primary" disabled={disabled||!canContinue(choice)} onclick={next}>Next</Button></div>

 {:else if guide.step==='connect'}
  {#if askPhone&&planned.length===0}
   <form class="phone" onsubmit={event=>{event.preventDefault();const parts=pendingParts,address=phone.trim();queue(()=>connect(parts,address));}}>
    <Input label="Phone address" bind:value={phone} state={phoneTaken?'error':'default'} helperText={phoneTaken?'Address in use':undefined} autocomplete="off" disabled={disabled||connecting}/>
    <Button type="submit" variant="primary" disabled={disabled||connecting||phone.trim()===''} loading={connecting}>Connect</Button>
   </form>
  {/if}
  {#each planned as part (part.sourceId)}
   {@const held=sourceOf(part.sourceId)}
   {@const status=trackingStatus.find(item=>item.sourceId===part.sourceId)}
   {@const failedStatus=failure(status)}
   <div class="part">
    {#if planned.length>1}<p class="muted">{part.preset.label}</p>{/if}
    {#if held?.config.kind==='vmc'}
     <p class="muted">Send VMC to</p>
     <p class="address"><span>{addresses[0]??'—'}</span><span>{part.port??''}</span></p>
     {#if addresses.length>1}<p class="others">{addresses.slice(1).join(' · ')}</p>{/if}
    {:else if held?.config.kind==='openseeface'}
     <p class="address"><span>{held.config.bindAddress==='0.0.0.0'?addresses[0]??'—':held.config.bindAddress}</span><span>{part.port??''}</span></p>
    {:else if held&&(held.config.kind==='mediapipe'||held.config.kind==='facekit')}
     {@const deviceId=held.config.deviceId}
     <Select label="Camera" value={deviceId} options={cameraOptions(held.config.kind==='facekit'?hostCameras:devices,hiddenCameras.state.hidden,deviceId)} {disabled} onchange={event=>setCamera(part.sourceId,event.currentTarget.value)}/>
     {#if held.config.kind==='facekit'}<p class="muted">Uses a private macOS API. It can stop after a macOS update.</p>{/if}
    {/if}
    {#if failedStatus}
     <p role="alert">{failedStatus.error??trackingStateLabel(failedStatus.state)}</p>
     {#if failedStatus.state==='permissionNeeded'&&faceKit}<div><Button type="button" variant="secondary" {disabled} onclick={()=>{void faceKit?.openSettings().catch(()=>{});}}>Open Settings</Button></div>{/if}
    {:else if !guide.receiving.includes(part.sourceId)&&!probeError}<p class="waiting"><Spinner size="sm" variant="muted"/>Waiting for data</p>{/if}
   </div>
  {/each}
  {#if planned.length===0&&retry}
   <div class="actions"><Button variant="primary" {disabled} loading={connecting} onclick={()=>{error=null;const parts=pendingParts;queue(()=>connect(parts,null));}}>Connect</Button></div>
  {/if}

 {:else if guide.step==='relax'}
  <h3>{relaxHeading(guide.parts)}</h3>
  <p class="count" aria-live="polite">{relaxSecondsLeft(guide,now)}</p>

 {:else if guide.step==='expressions'}
  {#if stepId}
   <CoachFace step={stepId} progress={stepProgress(guide,now)}/>
   <h3 class="prompt">{PROMPTS[stepId]}</h3>
   {#if !waitsForNext(guide)}<GuideMeter label={PROMPTS[stepId]} value={probe?mainValue(probe,stepId):0} peak={guide.stepPeak}/>{/if}
   {#if stepId==='lookAround'}<label class="option"><input type="checkbox" checked={source?.mapping?.useEyeBones??true} disabled={disabled||view.pending||!source} onchange={event=>{void setEyeBones(event.currentTarget);}}/>Use bones for eye movement</label>{/if}
   <div class="actions">{#if waitsForNext(guide)}<Button variant="primary" {disabled} onclick={()=>dispatch({kind:'next',nowMs:performance.now()})}>Next</Button>{:else}<Button variant="secondary" {disabled} onclick={()=>dispatch({kind:'next',nowMs:performance.now()})}>Skip</Button>{/if}</div>
  {:else}<p class="waiting"><Spinner size="sm" variant="muted"/></p>{/if}

 {:else}
  <h3>Try it</h3>
  {#if guide.faceSourceId}<div class="groups">{#each GROUPS as [label,names] (label)}<div><span class="muted">{label}</span><GuideMeter {label} value={groupLevel(probe?.values??{},names,source?.mapping)}/></div>{/each}</div>{/if}
  {#if guide.fitError}<p role="alert">{guide.fitError}</p>{/if}
  <div class="actions start"><Button variant="primary" onclick={done}>Done</Button></div>
 {/if}
 {#if error}<p role="alert">{error}</p>{/if}
 {#if probeError&&guide.step!=='pick'}<p role="alert">{probeError}</p>{/if}
</section>
<style>
 .tracking-guide{display:flex;flex-direction:column;gap:16px;padding:20px 24px;max-width:420px}
 header{display:flex;align-items:center;justify-content:space-between}
 h2{margin:0;font-size:11px;color:var(--ds-color-text-muted)}
 h3{margin:0;font-size:16px;color:var(--ds-color-text)}
 .prompt{text-align:center}
 .steps{display:flex;gap:6px;list-style:none;margin:0;padding:0}
 .steps li{flex:1;height:3px;border-radius:2px;background:var(--ds-color-border)}
 .steps li.on{background:var(--ds-color-accent)}
 .phone{display:grid;gap:10px}
 .part{display:grid;gap:10px}
 .muted{margin:0;font-size:12px;color:var(--ds-color-text-muted)}
 .address{display:grid;gap:2px;margin:0;padding:12px;border-radius:6px;background:var(--ds-color-rail);font:600 22px/1.25 ui-monospace,Menlo,monospace;color:var(--ds-color-text);text-align:center;font-variant-numeric:tabular-nums}
 .others{margin:-8px 0 0;font:12px ui-monospace,Menlo,monospace;color:var(--ds-color-text-muted);text-align:center;overflow-wrap:anywhere}
 .waiting{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;color:var(--ds-color-text-muted)}
 .count{margin:0;font:700 44px/1 system-ui,sans-serif;color:var(--ds-color-accent);text-align:center;font-variant-numeric:tabular-nums}
 .option{display:flex;gap:8px;align-items:center;font-size:12px}
 .option input{accent-color:var(--ds-color-accent)}
 .actions{display:flex;justify-content:flex-end}
 .actions.start{justify-content:flex-start}
 .groups{display:grid;gap:12px}
 .groups div{display:grid;gap:6px}
 p[role=alert]{margin:0;font-size:12px}
</style>
