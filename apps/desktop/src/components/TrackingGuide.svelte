<script lang="ts">
 import {onDestroy,onMount} from 'svelte';
 import {Button,Input,Spinner} from '@oshi-connect/ui';
 import {X} from '@lucide/svelte';
 import {DEFAULT_TRACKING_MAPPING,EXPRESSION_STEPS,TRACKING_PRESETS,type AppApi,type AssetRecord,type ExpressionStepId,type TrackingPreset,type TrackingProbe,type TrackingStatus} from '@opensekai/contracts';
 import type {EditorModel,EditorView} from '../editor/model';
 import {guideStep,initialGuide,mainValue,type GuideEffect,type GuideEvent,type GuideStep} from '../editor/tracking-guide';
 import {planCancel,planConnect,type GuideSnapshot} from '../editor/tracking-guide-plan';
 import {groupLevel,rankAddresses,relaxSecondsLeft,stepProgress,waitsForNext} from '../editor/tracking-guide-view';
 import CoachFace from './CoachFace.svelte';
 import GuideMeter from './GuideMeter.svelte';
 let {avatarId,model,view,api,assets=[],localAddresses=[],trackingStatus=[],disabled=false,onclose}:{avatarId:string;model:EditorModel;view:EditorView;api:AppApi;assets?:AssetRecord[];localAddresses?:string[];trackingStatus?:TrackingStatus[];disabled?:boolean;onclose:()=>void}=$props();

 const STEPS:GuideStep[]=['pick','connect','relax','expressions','review'];
 const PROMPTS:Record<ExpressionStepId,string>={blink:'Blink',mouthWide:'Open your mouth wide',browsUp:'Raise your brows',smile:'Smile',frown:'Frown',pucker:'Pucker your lips',puffCheeks:'Puff your cheeks',tongueOut:'Stick out your tongue',lookAround:'Look around'};
 const GROUPS=[['Eyes',EXPRESSION_STEPS.blink.main],['Mouth',EXPRESSION_STEPS.mouthWide.main],['Brows',EXPRESSION_STEPS.browsUp.main]] as const;

 let guide=$state.raw(initialGuide()),probe=$state.raw<TrackingProbe|null>(null),now=$state(performance.now());
 let askPhone=$state(false),phone=$state(''),phoneTaken=$state(false),port=$state<number|null>(null),connecting=$state(false),retry=$state(false),error=$state<string|null>(null),probeError=$state<string|null>(null),closing=$state(false);
 let snapshot:GuideSnapshot|null=null,fitSent=false,finished=false,resetNext=false,inFlight=false,probeFailures=0,avatarGone=false,timer:ReturnType<typeof setInterval>|undefined;
 let effects:Promise<void>=Promise.resolve();

 const avatar=$derived(view.scene?.entities.find(e=>e.id===avatarId&&e.kind==='avatar'));
 const source=$derived.by(()=>{const found=view.scene?.entities.find(e=>e.id===guide.sourceId);return found?.kind==='tracking'?found:undefined;});
 const stepId=$derived(guide.step==='expressions'?guide.preset?.steps[guide.index]:undefined);
 const current=$derived(STEPS.indexOf(guide.step));
 const status=$derived(trackingStatus.find(item=>item.sourceId===guide.sourceId));
 const addresses=$derived(rankAddresses(localAddresses));

 // Every guide write runs in this one chain, so a cancel can wait for the writes that are in flight.
 const queue=(task:()=>Promise<void>)=>{effects=effects.then(task).catch(()=>{});};
 function dispatch(event:GuideEvent){
  const out=guideStep(guide,event);guide=out.state;
  for(const effect of out.effects)queue(()=>run(effect));
 }
 async function run(effect:GuideEffect){
  const sourceId=guide.sourceId;
  if(effect.kind==='connect'){if(effect.preset.connect==='askPhone')askPhone=true;else await connect(effect.preset,null);}
  else if(effect.kind==='resetPeaks')resetNext=true;
  else if(effect.kind==='calibrate'&&sourceId){const reply=await model.calibrateTracking(sourceId);if(!reply.ok)error=reply.error.message;}
  else if(effect.kind==='fit'&&sourceId){
   fitSent=true;
   const reply=await model.fitBlendShapeRanges(sourceId,effect.neutral);
   dispatch(reply.ok?{kind:'fitted'}:{kind:'fitFailed',message:reply.error.message});
  }
 }
 async function connect(preset:TrackingPreset,phoneAddress:string|null){
  const scene=model.read().scene,target=scene?.entities.find(e=>e.id===avatarId);
  if(!scene||target?.kind!=='avatar'){error='Character not found';return;}
  const eyeBones=assets.find(asset=>asset.id===target.assetId)?.eyeBones;
  const plan=planConnect(scene,avatarId,preset,phoneAddress,eyeBones,crypto.randomUUID());
  phoneTaken=plan.needsPhone&&phoneAddress!==null;
  retry=false;
  if(plan.needsPhone){askPhone=true;return;}
  const held=scene.entities.find(e=>e.id===plan.sourceId);
  snapshot={avatarId,tracking:structuredClone(target.tracking),sourceId:plan.sourceId,created:plan.created,mapping:held?.kind==='tracking'?structuredClone(held.mapping):undefined};
  connecting=true;error=null;
  const reply=await model.applyOperations(plan.operations,scene.revision);
  connecting=false;
  if(!reply.ok){snapshot=null;error=reply.error.message;retry=phoneAddress===null;return;}
  port=plan.port;
  dispatch({kind:'connected',sourceId:plan.sourceId});
 }
 function poll(){
  now=performance.now();
  const sourceId=guide.sourceId;
  if(!sourceId||inFlight||closing||finished)return;
  inFlight=true;
  const reset=resetNext;resetNext=false;
  api.trackingProbe(reset?{sourceId,resetPeaks:true}:{sourceId})
   .then(reply=>{
    if(closing||finished)return;
    if(!reply.ok){failed(reset,reply.error.code==='NOT_FOUND'?'Source removed':reply.error.message);return;}
    probeFailures=0;probeError=null;
    probe=reply.data;
    dispatch({kind:'probe',probe:reply.data,nowMs:performance.now()});
   })
   .catch(()=>{failed(reset,'Tracking unavailable');})
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
 // A close before Done puts back the bindings and the mapping from before the run. A failed cancel keeps the guide open.
 async function cancel():Promise<boolean>{
  if(closing||finished)return false;
  closing=true;stop();
  await effects;await idle();
  const scene=model.read().scene;
  const operations=snapshot&&scene?planCancel(scene,snapshot,fitSent):[];
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
   const scene=model.read().scene,target=scene?.entities.find(e=>e.id===guide.sourceId);
   if(!scene||target?.kind!=='tracking')return;
   const reply=await model.setTrackingMapping(target.id,{...(target.mapping??structuredClone(DEFAULT_TRACKING_MAPPING)),useEyeBones:checked},scene.revision);
   if(!reply.ok)box.checked=target.mapping?.useEyeBones??true;
  });
 }
 // A deleted character ends the run; planCancel removes the source that the guide created.
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
  <h3>Pick the app</h3>
  <div class="tiles">{#each TRACKING_PRESETS as preset (preset.id)}<Button variant="secondary" size="lg" class="tile" {disabled} onclick={()=>dispatch({kind:'pick',preset})}>{preset.label}</Button>{/each}</div>

 {:else if guide.step==='connect'}
  {#if askPhone&&guide.sourceId===null}
   <form class="phone" onsubmit={event=>{event.preventDefault();const preset=guide.preset,address=phone.trim();if(preset)queue(()=>connect(preset,address));}}>
    <Input label="Phone address" bind:value={phone} state={phoneTaken?'error':'default'} helperText={phoneTaken?'Address in use':undefined} autocomplete="off" disabled={disabled||connecting}/>
    <Button type="submit" variant="primary" disabled={disabled||connecting||phone.trim()===''} loading={connecting}>Connect</Button>
   </form>
  {:else if guide.preset?.config.kind==='vmc'}
   <p class="muted">Send VMC to</p>
   <p class="address"><span>{addresses[0]??'—'}</span><span>{port??''}</span></p>
   {#if addresses.length>1}<p class="others">{addresses.slice(1).join(' · ')}</p>{/if}
  {/if}
  {#if guide.sourceId}
   {#if probe?.state==='error'&&status?.error}<p role="alert">{status.error}</p>
   {:else if !probeError}<p class="waiting"><Spinner size="sm" variant="muted"/>Waiting for data</p>{/if}
  {:else if retry&&guide.preset}
   {@const preset=guide.preset}
   <div class="actions"><Button variant="primary" {disabled} loading={connecting} onclick={()=>{error=null;queue(()=>connect(preset,null));}}>Connect</Button></div>
  {/if}

 {:else if guide.step==='relax'}
  <h3>Relax your face</h3>
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
  <div class="groups">{#each GROUPS as [label,names] (label)}<div><span class="muted">{label}</span><GuideMeter {label} value={groupLevel(probe?.values??{},names,source?.mapping)}/></div>{/each}</div>
  {#if guide.fitError}<p role="alert">{guide.fitError}</p>{/if}
  <div class="actions"><Button variant="primary" onclick={done}>Done</Button></div>
 {/if}
 {#if error}<p role="alert">{error}</p>{/if}
 {#if probeError&&guide.step!=='pick'}<p role="alert">{probeError}</p>{/if}
</section>
<style>
 .tracking-guide{display:flex;flex-direction:column;gap:16px;padding:20px 24px;max-width:420px}
 header{display:flex;align-items:center;justify-content:space-between}
 h2{margin:0;font-size:11px;color:#9a93a5}
 h3{margin:0;font-size:16px;color:#35333d}
 .prompt{text-align:center}
 .steps{display:flex;gap:6px;list-style:none;margin:0;padding:0}
 .steps li{flex:1;height:3px;border-radius:2px;background:#eeecf2}
 .steps li.on{background:#8571ac}
 .tiles{display:grid;gap:8px}
 .tiles :global(.tile){width:100%;justify-content:center}
 .phone{display:grid;gap:10px}
 .muted{margin:0;font-size:12px;color:#85818f}
 .address{display:grid;gap:2px;margin:0;padding:12px;border-radius:6px;background:#f6f5fa;font:600 22px/1.25 ui-monospace,Menlo,monospace;color:#35333d;text-align:center;font-variant-numeric:tabular-nums}
 .others{margin:-8px 0 0;font:12px ui-monospace,Menlo,monospace;color:#85818f;text-align:center;overflow-wrap:anywhere}
 .waiting{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;color:#85818f}
 .count{margin:0;font:700 44px/1 system-ui,sans-serif;color:#8571ac;text-align:center;font-variant-numeric:tabular-nums}
 .option{display:flex;gap:8px;align-items:center;font-size:12px}
 .option input{accent-color:#8571ac}
 .actions{display:flex;justify-content:flex-end}
 .groups{display:grid;gap:12px}
 .groups div{display:grid;gap:6px}
 p[role=alert]{margin:0;font-size:12px}
</style>
