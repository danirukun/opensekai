<script lang="ts">
 import { onMount, tick } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { getCurrentWindow } from '@tauri-apps/api/window';
 import { Button, ToastRegion, toasts } from '@oshi-connect/ui';
 import { Box, Radio, PackageOpen, Workflow, FolderOpen, Save, Settings } from '@lucide/svelte';
 import Stats from 'stats.js';
 import {createMediaPipeTracker} from './tracking/mediapipe';
 import {fitDevices} from './tracking/hidden-cameras';
 import { bootstrapDesktop } from './bootstrap';
 import { createEditorModel, type EditorModel, type EditorView } from './editor/model';
 import {createLiveTransform} from './editor/live-transform';
 import {createLiveEdit,type LiveEdit} from './editor/live-edit';
 import { createEditorPoll } from './editor-poll';
 import { createBlueprintSync, type BlueprintSync } from './blueprints/blueprint-sync';
import { createEditorMemory } from './blueprints/editor-memory';
 import { createDebugFeed, planToasts, type DebugFeed } from './blueprints/debug-feed';
 import { compileBlueprint } from '@opensekai/session';
 import {cycleCamera} from './editor/cameras';
 import {previewActive} from './editor/preview-gate';
 import {toolForKey} from './editor/scene-keys';
 import {collectWarnings} from './editor/warnings';
 import {screenVideo,type PlaybackState} from './editor/screen';
 import type {CaptureCommands} from './editor/capture';
 import type { Draft, Tool } from './editor/ui-message';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {AssetRecordSchema,ShowDocumentSchema} from '@opensekai/contracts';
 import {makeAuthoringEntity,importFailure} from './editor/authoring';
 import {applyTrackingConfig} from './editor/tracking-activation';
 import {openShowDocument,showDirty,type ShowMark} from './editor/show-management';
 import type {AddKind} from './editor/live-fields';
 import type { AppApi, AppStatus, AssetRecord, ShowDocument, TrackingConfig,Transform } from '@opensekai/contracts';
 import Hierarchy from './components/Hierarchy.svelte';
 import Inspector from './components/Inspector.svelte';
 import OutputControls from './components/OutputControls.svelte';
 import AssetList from './components/AssetList.svelte';
 import ResizeHandle from './components/ResizeHandle.svelte';
 import BlueprintPanel from './components/BlueprintPanel.svelte';
 import TrackingGuide from './components/TrackingGuide.svelte';
 import SettingsPanel from './components/SettingsPanel.svelte';
 import ScenePane from './components/ScenePane.svelte';
 let model=$state.raw<EditorModel>(),view=$state<EditorView>({scene:null,selectedId:null,error:null,pending:false});
 let status=$state<AppStatus|null>(null),assets=$state<AssetRecord[]>([]),outputUrl=$state(''),canEdit=$state(false),available=$state(false),error=$state<string|null>(null);
 let panel=$state<'assets'|'output'|'resources'|'blueprints'|'settings'>('assets'),width=$state(224),maxWidth=$state(360),shell:HTMLDivElement;
 let api=$state.raw<AppApi|null>(null),sync=$state.raw<BlueprintSync|null>(null);
 const memory=createEditorMemory();
 // Show Toast entries of the session debug log (slice F R12): at most 3 on screen, only in this window.
 let debugFeed=$state.raw<DebugFeed|null>(null);const debugToasts=new Set<string>();
 const offToasts=toasts.subscribe(list=>{const live=new Set(list.map(item=>item.id));for(const id of debugToasts)if(!live.has(id))debugToasts.delete(id);});
 function showDebugToasts(entries:Parameters<typeof planToasts>[0]){for(const item of planToasts(entries,3-debugToasts.size))debugToasts.add(toasts.push({variant:item.variant,message:item.message},item.durationMs));}
 const expressionApi=$derived(api?{get:(avatarId:string)=>api!.expressionGet({avatarId}),set:(avatarId:string,name:string,active:boolean)=>api!.expressionSet({avatarId,name,active})}:null);
 let showName=$state('Untitled Show'),showBusy=$state(false),showError=$state<string|null>(null),savedMark=$state<ShowMark|null>(null);
 const currentMark=():ShowMark=>({name:showName,revision:view.scene?.revision??null,blueprintRevision:status?.blueprintRevision});
 const dirty=$derived(showDirty(savedMark,currentMark()));
 $effect(()=>{if(canEdit)void invoke('set_show_dirty',{dirty}).catch(()=>{});});
 let importError=$state<{entityId:string;message:string}|null>(null),trackingError=$state<string|null>(null);
 let importingId=$state<string|null>(null);const importing=$derived(importingId!==null);let loads=$state<AssetLoadStatus[]>([]);
 // The playing value of each video screen from the preview frames (B29 R19).
 let playback=$state.raw<PlaybackState>(new Map());
 // The editor-only capture commands (B31 R17, R18). The source list and the allow go only through this window.
 const captureCommands:CaptureCommands={list:()=>invoke<unknown>('capture_source_list'),allow:source=>invoke<void>('capture_source_allow',{source}),openSettings:()=>invoke<void>('open_capture_settings')};
 let devices=$state<{deviceId:string;label:string}[]>([]);
 // The avatar whose tracking guide replaces the Inspector.
 let guideFor=$state<string|null>(null);
 let liveTransform:ReturnType<typeof createLiveTransform>|undefined,transformError=$state<string|null>(null),livePending=$state(false);
 function transformLive(id:string,transform:Transform){transformError=null;if(!liveTransform?.offer(id,transform))transformError=model?.read().pending?'BUSY':'INVALID_INPUT';}
 // Live slider and color edits (B12 R13).
 let liveField:LiveEdit|undefined,fieldPending=$state(false);
 let draft=$state<Draft>(null),tool=$state<Tool>('translate'),dragging=$state(false);
 let canvas=$state<HTMLCanvasElement>(),webBack=$state<HTMLDivElement>(),webFront=$state<HTMLDivElement>(),monitorHost=$state<HTMLDivElement>(),counterHost=$state<HTMLDivElement>();
 let session=$state.raw<Awaited<ReturnType<typeof bootstrapDesktop>>>();
 let previewOn=$state(true),perfVisible=$state(false);
 function togglePerf(){perfVisible=!perfVisible;try{localStorage.setItem('opensekai.scene.perfMonitor',perfVisible?'true':'false');}catch{}}
 const names=$derived(Object.fromEntries((view.scene?.entities??[]).map(entity=>[entity.id,entity.name])));
 const selected=$derived(view.scene?.entities.find(e=>e.id===view.selectedId));
 function syncViewport(){const state=model?.read();session?.editor?.sync({scene:state?.scene??null,selectedId:selected?.kind==='tracking'?null:view.selectedId,tool,enabled:canEdit&&available&&!(view.pending&&!view.livePending)&&selected?.kind!=='tracking'});}
 function cancelDrag(){session?.editor?.cancel();dragging=false;draft=null;}
 // The preview draws only on the Assets tab; the session and the OBS output never pause (R6).
 $effect(()=>{session?.setPreviewEnabled(previewActive({toggleOn:previewOn,assetsShown:panel==='assets'}));});
 $effect(()=>{if(panel!=='assets'&&dragging)cancelDrag();});
 function key(event:KeyboardEvent){
  if(event.defaultPrevented)return;
  const target=event.target instanceof Element?event.target:null;
  const next=toolForKey({key:event.key,modifier:event.ctrlKey||event.metaKey||event.altKey,editableTarget:!!target?.closest('input,textarea,select,[contenteditable="true"]')},{assetsShown:panel==='assets',editable:canEdit&&available});
  if(next){event.preventDefault();setTool(next);}else if(event.key==='Escape'&&dragging){session?.editor?.cancel();dragging=false;}
 }
 const warnings=$derived(collectWarnings(status));
 function select(id:string|null){if(importError&&importError.entityId!==id)importError=null;liveTransform?.cancel();liveField?.cancel();transformError=null;draft=null;if(model&&model.read().selectedId!==id){if(id)model.select(id);else model.clearSelection();}}
 async function add(kind:AddKind,revision:number){if(!model||!view.scene)return;const entity=makeAuthoringEntity(kind,crypto.randomUUID(),model.read().scene!.entities);const reply=await model.createEntity(entity,revision);if(reply.ok)select(entity.id);}
 async function chooseModel(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_avatar');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await model.setAvatarModel(entityId,record.id,model.read().scene?.revision);
  }catch(cause){importError={entityId,message:importFailure(cause)};}finally{importingId=null;}
 }
 // An environment and a prop take their model from the same scene library (prop import R8).
 function setSceneModel(entityId:string,assetId:string|null){
  if(!model)return;const revision=model.read().scene?.revision;
  return model.read().scene?.entities.some(entity=>entity.id===entityId&&entity.kind==='mesh')?model.setMeshModel(entityId,assetId,revision):model.setEnvironmentModel(entityId,assetId,revision);
 }
 async function chooseScene(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_scene');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await setSceneModel(entityId,record.id);
  }catch(cause){importError={entityId,message:importFailure(cause,'Could not import model')};}finally{importingId=null;}
 }
 // The returned record goes only to the screen that asked for it (B28 R19).
 async function chooseImage(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_image');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await model.setScreenImage(entityId,record.id,model.read().scene?.revision);
  }catch(cause){importError={entityId,message:importFailure(cause,'Could not import image')};}finally{importingId=null;}
 }
 async function chooseVideo(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_video');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   const entity=model.read().scene?.entities.find(item=>item.id===entityId);
   if(entity)await model.setScreenVideo(entityId,{...screenVideo(entity),assetId:record.id},model.read().scene?.revision);
  }catch(cause){importError={entityId,message:importFailure(cause,'Could not import video')};}finally{importingId=null;}
 }
 async function configureTracking(id:string,config:TrackingConfig,revision:number){
  if(!model)return;trackingError=null;
  const reply=await applyTrackingConfig(id,config,revision,{commit:(id,config,revision)=>model!.setTrackingConfig(id,config,revision)});
  if(!reply.ok)trackingError=reply.error.message;
 }
 async function toggleTracking(id:string,enabled:boolean,revision:number){const entity=model?.read().scene?.entities.find(item=>item.id===id);if(entity?.kind==='tracking')await configureTracking(id,{...entity.config,enabled},revision);}
 function setTool(next:Tool){tool=next;syncViewport();}
 function showFailure(cause:unknown){return cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause&&typeof cause.message==='string'?cause.message:'Show operation failed';}
 async function saveShow(chooseFile=false):Promise<boolean>{
  if(!view.scene||!api||showBusy||view.pending)return false;
  showBusy=true;showError=null;
  try{
   const inspected=await api.sceneInspect({sceneId:view.scene.sceneId});
   if(!inspected.ok){showError=inspected.error.message;return false;}
   await sync?.idle();
   const blueprints=await api.blueprintInspect({});
   if(!blueprints.ok){showError=blueprints.error.message;return false;}
   const document=ShowDocumentSchema.parse({schemaVersion:1,name:showName,scene:inspected.data,blueprints:blueprints.data.kind==='snapshot'?blueprints.data.blueprints:[]}) satisfies ShowDocument;
   const path=await invoke<string|null>(chooseFile?'save_show_as':'save_show',{document});
   if(!path)return false;
   showName=document.name;savedMark={name:document.name,revision:inspected.data.revision,blueprintRevision:blueprints.data.revision};
   toasts.push({variant:'success',message:`Saved ${path.split(/[\\/]/).pop()}`},3000);
   return true;
  }catch(cause){showError=showFailure(cause);return false;}
  finally{showBusy=false;if(showError)toasts.push({variant:'error',message:showError});}
 }
 async function openShow(){
  if(!model||showBusy||view.pending||guideFor!==null)return;
  showBusy=true;showError=null;
  try{
   const raw=await invoke<unknown|null>('open_show');if(raw===null)return;
   liveTransform?.cancel();liveField?.cancel();
   const reply=await openShowDocument(raw,scene=>model!.replaceScene(scene),async document=>{
    panel='assets';await tick();
    showName=document.name;
    select(null);
    const broken=document.blueprints.map(graph=>({graph,result:compileBlueprint(graph)})).find(item=>!item.result.ok);
    if(broken&&!broken.result.ok)showError=`${broken.graph.name}: ${broken.result.error.message}`;
    if(sync){const applied=sync.edit([{kind:'replaceAll',graphs:document.blueprints}]);await sync.idle();if(applied.ok)memory.history.clear();if((!applied.ok||sync.issue())&&!showError)showError='Blueprints were not applied';}
   });
   if(reply.ok)savedMark={name:showName,revision:reply.data.revision,blueprintRevision:sync?.revision()};
   if(!reply.ok){showError=reply.error.message;return;}
  }catch(cause){showError=showFailure(cause);}
  finally{showBusy=false;}
 }
 const showCommands={open:()=>openShow(),save:()=>saveShow(),saveAs:()=>saveShow(true)};
 function runShowCommand(command:unknown){if(canEdit&&available&&typeof command==='string'&&Object.hasOwn(showCommands,command))void showCommands[command as keyof typeof showCommands]();}
 onMount(()=>{
  let disposed=false,off=()=>{},offMenu=()=>{},offLoads=()=>{},offPlayback=()=>{},offClock=()=>{},poll:ReturnType<typeof createEditorPoll>|undefined;
  let tracker:ReturnType<typeof createMediaPipeTracker>|undefined;
  const stats=new Stats();stats.showPanel(0);stats.dom.style.position='static';monitorHost!.appendChild(stats.dom);
  try{perfVisible=localStorage.getItem('opensekai.scene.perfMonitor')==='true';}catch{}
  const reconcileTracking=()=>{if(!session||session.tracking.now()===null)return;tracker?.reconcile(model?.read().scene?.entities.filter(entity=>entity.kind==='tracking')??[]);};
  // The scene pane keeps at least 320 px beside the 320 px Inspector (R3).
  const resize=new ResizeObserver(()=>{maxWidth=Math.max(160,Math.min(360,shell.clientWidth-320-320));width=Math.min(width,maxWidth);});resize.observe(shell);
  const timer=setInterval(()=>{void poll?.poll();void debugFeed?.poll();},500);
  void getCurrentWindow().listen<unknown>('show-command',event=>runShowCommand(event.payload)).then(stop=>{if(disposed)stop();else offMenu=stop;});
  void bootstrapDesktop(canvas!,{
   onSelect(id){draft=null;if(id)model?.select(id);else model?.clearSelection();},
   // Gizmo commits are live (B12 R8): the model does not hold them as pending, and the editor refreshes once at the end.
   onCommit(edit){return model!.setTransform(edit.entityId,edit.transform,edit.expectedRevision,true);},
   onGestureEnd(){draft=null;void model?.load();},
   onDraft(next){dragging=next!==null;draft=available?structuredClone(next):null;},
   // Navigation commits go straight to the patch route, so the model does not block the gesture as pending.
   onNavigate(edit){return session!.client.api.scenePatch(edit);},
   onNavigateEnd(){draft=null;void model?.load();},
   onInspect(sceneId){return session!.client.api.sceneInspect({sceneId});},
   onCycleCamera(direction){const state=model?.read();const next=cycleCamera(state?.scene??null,direction);if(next&&!state?.pending)void model?.selectCamera(next);},
  },{begin(){if(!perfVisible)return false;stats.begin();return true;},end(){stats.end();}},counterHost!,{back:webBack!,front:webFront!}).then(async value=>{if(disposed){await value.stop();return;}
   session=value;api=value.client.api;assets=value.assets;outputUrl=value.outputUrl;canEdit=value.canEdit;
   offLoads=value.onLoadStatus(entries=>{loads=entries;});offPlayback=value.onPlayback(next=>{playback=next;});
   model=createEditorModel(value.client.api);sync=createBlueprintSync(value.client.api);debugFeed=createDebugFeed(value.client.api,showDebugToasts);liveTransform=createLiveTransform(model,code=>{transformError=code;},pending=>{livePending=pending;});liveField=createLiveEdit(model,()=>{},pending=>{fieldPending=pending;});
   tracker=createMediaPipeTracker({now:()=>value.tracking.now()??0,onSample:sample=>value.tracking.submit({samples:[sample],statuses:[]}),onStatus:status=>value.tracking.submit({samples:[],statuses:[status]}),onDevices:choices=>{devices=fitDevices(choices.map(device=>({deviceId:device.deviceId.slice(0,512),label:device.label.slice(0,128)})));}});
   offClock=value.tracking.onClock(reconcileTracking);
   off=model.subscribe(next=>{const previous=view;view=next;if(previous.scene?.revision!==next.scene?.revision)draft=null;syncViewport();reconcileTracking();});
   poll=createEditorPoll(value.client.api,model,next=>{status=next;available=next.revision!==null;error=null;if(!available)cancelDrag();if(!savedMark&&next.revision!==null)savedMark={name:showName,revision:next.revision,blueprintRevision:next.blueprintRevision};syncViewport();},code=>{available=false;error=code;cancelDrag();syncViewport();},sync,()=>panel==='blueprints');await poll.poll();syncViewport();
  }).catch(cause=>{if(!disposed)error=cause instanceof Error?cause.message:'Session startup failed';});
  return()=>{disposed=true;clearInterval(timer);offToasts();resize.disconnect();tracker?.shutdown();offClock();offLoads();offPlayback();liveTransform?.close();liveField?.close();poll?.close();off();offMenu();stats.dom.remove();void session?.stop().catch(()=>{});};
 });
</script>
<svelte:window onkeydown={key}/>
<main class="editor-window">
 <nav class="editor-rail" aria-label="Editor panels">
  <Button variant="ghost" class={panel==='assets'?'active-panel':''} title="Assets" onclick={()=>{panel='assets';}}><Box size={20}/><span class="sr-only">Assets</span></Button>
  <Button variant="ghost" class={panel==='output'?'active-panel':''} title="Output" onclick={()=>{panel='output';}}><Radio size={20}/><span class="sr-only">Output</span></Button>
  <Button variant="ghost" class={panel==='blueprints'?'active-panel':''} title="Blueprints" onclick={()=>{panel='blueprints';}}><Workflow size={20}/><span class="sr-only">Blueprints</span></Button>
  <div class="spacer"></div>
  <Button variant="ghost" class={panel==='resources'?'active-panel':''} title="Resources" onclick={()=>{panel='resources';}}><PackageOpen size={20}/><span class="sr-only">Resources</span></Button>
  <Button variant="ghost" class={panel==='settings'?'active-panel':''} title="Settings" onclick={()=>{panel='settings';}}><Settings size={20}/><span class="sr-only">Settings</span></Button>
 </nav>
 <div class="editor-content">
  <div class="show-toolbar"><input aria-label="Show name" maxlength="128" bind:value={showName} disabled={!canEdit||showBusy}/><div class="spacer"></div><Button variant="ghost" title="Open show" disabled={!canEdit||!available||showBusy||view.pending||guideFor!==null} onclick={openShow}><FolderOpen size={16}/></Button><Button variant="ghost" title="Save show (⇧ Save As)" disabled={!canEdit||!available||showBusy||view.pending} onclick={(event:MouseEvent)=>{void saveShow(event.shiftKey);}}><Save size={16}/></Button></div>
  <div bind:this={shell} class="editor-body">
   {#if panel==='assets'}<div class="assets-column" style:width="{width}px">{#if model}<Hierarchy {model} {view} onselect={select} ontool={setTool} disabled={!canEdit||!available||importing||livePending||fieldPending} onadd={add} loading={new Set(loads.filter(load=>load.stage!=='failed').map(load=>load.entityId))} ontrackingtoggle={toggleTracking}/>{/if}<div class="asset-list-footer">{view.scene?.entities.length??0} assets</div></div>
    <ResizeHandle value={width} min={160} max={maxWidth} onchange={value=>{width=value;}}/>
   {/if}
   <!-- The pane stays mounted on every tab, so the renderer and its loaded assets stay (R5). -->
   <ScenePane bind:canvas bind:webBack bind:webFront bind:counterHost bind:monitorHost hidden={panel!=='assets'} {tool} {canEdit} {available} pending={view.pending} selectedName={selected?.name??''} selectedEditable={!!selected&&selected.kind!=='tracking'} {previewOn} {perfVisible} {loads} {names} ontool={setTool} onpreviewtoggle={()=>{previewOn=!previewOn;}} onperftoggle={togglePerf} ondismissload={id=>session?.dismissLoad(id)}/>
   <!-- The guide stays mounted while another rail panel shows, so a panel switch keeps the run (R14a). -->
   {#if model&&api&&guideFor}<div class="properties-column" hidden={panel!=='assets'}><TrackingGuide avatarId={guideFor} {model} {view} {api} {assets} localAddresses={status?.localAddresses??[]} trackingStatus={status?.trackingStatus??[]} disabled={!canEdit||!available} onclose={()=>{guideFor=null;}}/></div>{/if}
   {#if panel==='assets'}{#if model&&!(api&&guideFor)}<div class="properties-column"><Inspector onguide={id=>{guideFor=id;}} {model} {view} onlivefield={request=>{liveField?.offer(request);}} onlivefieldend={()=>liveField?.end()} {assets} {loads} {importingId} {importError} onchoosemodel={chooseModel} onchoosescene={chooseScene} onchooseimage={chooseImage} onchoosevideo={chooseVideo} {playback} onpickimage={(id,assetId)=>{void model?.setScreenImage(id,assetId,model.read().scene?.revision);}} onpickscene={(id,assetId)=>{void setSceneModel(id,assetId);}} onrenderenvironment={(id,value,revision)=>model?.setCameraRenderEnvironment(id,value,revision)??Promise.resolve(undefined)} {expressionApi} onexpressionsettings={(id,name,settings,revision)=>model?.setAvatarExpression(id,name,settings,revision)??Promise.resolve(undefined)} onnavigation={(id,navigation,revision)=>model?.setCameraNavigation(id,navigation,revision)??Promise.resolve(undefined)} onscreenshot={id=>model?.cameraScreenshot(id)??Promise.resolve(undefined)} onopenscreenshots={()=>invoke<void>('open_screenshots_folder')} {draft} {transformError} {livePending} onlivetransform={transformLive} oncanceltransform={()=>liveTransform?.cancel()} onfinishtransform={()=>liveTransform?.end()} disabled={!canEdit||!available||importing} {devices} trackingStatus={status?.trackingStatus??[]} localAddresses={status?.localAddresses??[]} vmcSenders={status?.vmcSenders??[]} captureCommands={canEdit?captureCommands:null} captureStatus={status} onlens={async(id,lens,revision)=>{await model?.setCameraLens(id,lens,revision);}} onavataridle={async(id,idle,revision)=>{await model?.setAvatarIdle(id,idle,revision);}} onavatartracking={async(id,tracking,revision)=>{await model?.setAvatarTracking(id,tracking,revision);}} ontrackingsmoothing={async(id,smoothing,revision)=>{await model?.setTrackingSmoothing(id,smoothing,revision);}} ontrackingmapping={async(id,mapping,revision)=>{await model?.setTrackingMapping(id,mapping,revision);}} ontrackingcalibrate={(id,revision)=>model?.calibrateTracking(id,revision)??Promise.resolve(undefined)} ontrackingcalibrationreset={(id,revision)=>model?.resetTrackingCalibration(id,revision)??Promise.resolve(undefined)} ontrackingconfig={configureTracking} ontrackingtoggle={toggleTracking}/></div>{/if}
   {:else if panel==='output'}<section class="output-panel"><h2>Output</h2>{#if model}<OutputControls {model} {view} {status} {outputUrl} disabled={!canEdit||!available||livePending||fieldPending}/>{/if}</section>
   {:else if panel==='blueprints'}{#if sync}<BlueprintPanel {api} {sync} debug={debugFeed} {memory} {status} {assets} scene={view.scene} selectedEntityId={view.selectedId} disabled={!canEdit||!available||view.pending} onrun={()=>{void model?.load();}}/>{/if}
   {:else if panel==='settings'}<SettingsPanel {api} youtube={status?.youtube} disabled={!canEdit} onchange={youtube=>{if(status)status={...status,youtube};}}/>
   {:else}<AssetList {assets} {warnings}/>{/if}
  </div>
  <footer><span>{showError??importError?.message??trackingError??transformError??error??view.error??(view.scene?'Session connected':'Starting…')}</span><span>{canEdit ? (tool==='translate'?'Move':tool==='rotate'?'Rotate':'Scale'):'Read only'}</span></footer>
 </div>
</main>
<ToastRegion/>
