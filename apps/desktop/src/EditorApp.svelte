<script lang="ts">
 import { onMount, tick } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { getCurrentWindow } from '@tauri-apps/api/window';
 import { Button } from '@oshi-connect/ui';
 import { Box, Radio, PackageOpen, Workflow, FolderOpen, Save } from '@lucide/svelte';
 import { bootstrapEditor } from './bootstrap';
 import { createEditorModel, type EditorModel, type EditorView } from './editor/model';
 import {createLiveTransform} from './editor/live-transform';
 import { createEditorPoll } from './editor-poll';
 import { createBlueprintSync, type BlueprintSync } from './blueprints/blueprint-sync';
 import { compileBlueprint } from '@opensekai/session';
 import { listenUI, sendUI } from './editor/ui-bridge';
 import {collectWarnings} from './editor/warnings';
 import type { Draft, Tool } from './editor/ui-message';
 import {AssetRecordSchema,ShowDocumentSchema} from '@opensekai/contracts';
 import {makeAuthoringEntity,makeImportedAvatar,importFailure} from './editor/authoring';
 import {applyTrackingConfig} from './editor/tracking-activation';
 import {openShowDocument} from './editor/show-management';
 import type {AddKind} from './editor/live-fields';
 import type { AppApi, AppStatus, AssetRecord, ShowDocument, TrackingConfig,Transform } from '@opensekai/contracts';
 import Hierarchy from './components/Hierarchy.svelte';
 import Inspector from './components/Inspector.svelte';
 import OutputControls from './components/OutputControls.svelte';
 import AssetList from './components/AssetList.svelte';
 import ResizeHandle from './components/ResizeHandle.svelte';
 import BlueprintPanel from './components/BlueprintPanel.svelte';
 let model=$state.raw<EditorModel>(),view=$state<EditorView>({scene:null,selectedId:null,error:null,pending:false});
 let status=$state<AppStatus|null>(null),assets=$state<AssetRecord[]>([]),outputUrl=$state(''),canEdit=$state(false),available=$state(false),error=$state<string|null>(null);
 let panel=$state<'assets'|'output'|'resources'|'blueprints'>('assets'),width=$state(224),maxWidth=$state(360),shell:HTMLDivElement;
 let api=$state.raw<AppApi|null>(null),sync=$state.raw<BlueprintSync|null>(null);
 let showName=$state('Untitled Show'),showBusy=$state(false),showError=$state<string|null>(null);
 let importError=$state<string|null>(null),trackingError=$state<string|null>(null);
 let importing=$state(false),devices=$state<{deviceId:string;label:string}[]>([]);
 let liveTransform:ReturnType<typeof createLiveTransform>|undefined,transformError=$state<string|null>(null),livePending=$state(false);
 function transformLive(id:string,transform:Transform){transformError=null;if(!liveTransform?.offer(id,transform))transformError=model?.read().pending?'BUSY':'INVALID_INPUT';}
 let draft=$state<Draft>(null),tool=$state<Tool>('translate');
 const warnings=$derived(collectWarnings(status));
 function notify(message:Parameters<typeof sendUI>[1]){void sendUI('main',message).catch(()=>{error='Scene unavailable';});}
 function select(id:string|null){liveTransform?.cancel();transformError=null;draft=null;notify({kind:'selection',entityId:id});}
 async function add(kind:AddKind,revision:number){if(!model||!view.scene)return;const entity=makeAuthoringEntity(kind,crypto.randomUUID(),model.read().scene!.entities);const reply=await model.createEntity(entity,revision);if(reply.ok)select(entity.id);}
 async function importAvatar(){
  if(importing||!model||!view.scene)return;importing=true;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_avatar');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   const id=crypto.randomUUID();const reply=await model.createEntity(makeImportedAvatar(id,record.id,result.name),model.read().scene?.revision);
   if(reply.ok)select(id);
  }catch(cause){importError=importFailure(cause);}finally{importing=false;}
 }
 async function configureTracking(id:string,config:TrackingConfig,revision:number){
  if(!model)return;trackingError=null;
  const reply=await applyTrackingConfig(id,config,revision,{activate:()=>invoke<void>('show_scene'),commit:(id,config,revision)=>model!.setTrackingConfig(id,config,revision)});
  if(!reply.ok)trackingError=reply.error.message;
 }
 async function toggleTracking(id:string,enabled:boolean,revision:number){const entity=model?.read().scene?.entities.find(item=>item.id===id);if(entity?.kind==='tracking')await configureTracking(id,{...entity.config,enabled},revision);}
 function setTool(next:Tool){tool=next;notify({kind:'tool',tool});}
 function showFailure(cause:unknown){return cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message' in cause&&typeof cause.message==='string'?cause.message:'Show operation failed';}
 async function saveShow(){
  if(!view.scene||!api||showBusy||view.pending)return;
  showBusy=true;showError=null;
  try{
   const inspected=await api.sceneInspect({sceneId:view.scene.sceneId});
   if(!inspected.ok){showError=inspected.error.message;return;}
   await sync?.idle();
   const blueprints=await api.blueprintInspect({});
   if(!blueprints.ok){showError=blueprints.error.message;return;}
   const document=ShowDocumentSchema.parse({schemaVersion:1,name:showName,scene:inspected.data,blueprints:blueprints.data.kind==='snapshot'?blueprints.data.blueprints:[]}) satisfies ShowDocument;
   const path=await invoke<string|null>('save_show_as',{document});
   if(path)showName=document.name;
  }catch(cause){showError=showFailure(cause);}
  finally{showBusy=false;}
 }
 async function openShow(){
  if(!model||showBusy||view.pending)return;
  showBusy=true;showError=null;
  try{
   const raw=await invoke<unknown|null>('open_show');if(raw===null)return;
   liveTransform?.cancel();
   const reply=await openShowDocument(raw,scene=>model!.replaceScene(scene),async document=>{
    panel='assets';await tick();
    showName=document.name;
    select(null);
    const broken=document.blueprints.map(graph=>({graph,result:compileBlueprint(graph)})).find(item=>!item.result.ok);
    if(broken&&!broken.result.ok)showError=`${broken.graph.name}: ${broken.result.error.message}`;
    if(sync){const applied=sync.edit([{kind:'replaceAll',graphs:document.blueprints}]);await sync.idle();if((!applied.ok||sync.issue())&&!showError)showError='Blueprints were not applied';}
   });
   if(!reply.ok){showError=reply.error.message;return;}
  }catch(cause){showError=showFailure(cause);}
  finally{showBusy=false;}
 }
 onMount(()=>{
  let disposed=false,off=()=>{},offUI=()=>{},offClose=()=>{},connection:Awaited<ReturnType<typeof bootstrapEditor>>|undefined,poll:ReturnType<typeof createEditorPoll>|undefined;
  let pendingSelection:string|null|undefined;
  const resize=new ResizeObserver(()=>{maxWidth=Math.max(160,Math.min(420,shell.clientWidth-330));width=Math.min(width,maxWidth);});resize.observe(shell);
  const timer=setInterval(()=>{void poll?.poll();},500);
  void getCurrentWindow().onCloseRequested(event=>{event.preventDefault();void invoke('hide_editor').catch(()=>{error='Could not hide editor';});}).then(stop=>{if(disposed)stop();else offClose=stop;});
  void listenUI(message=>{if(message.kind==='trackingDevices')devices=message.devices;else if(message.kind==='selection'){draft=null;pendingSelection=message.entityId;if(model){if(message.entityId)model.select(message.entityId);else model.clearSelection();}}else if(message.kind==='tool')tool=message.tool;else if(message.kind==='draft')draft=available?message.draft:null;else if(message.kind==='refresh'){draft=null;void model?.load();}}).then(stop=>{if(disposed)stop();else offUI=stop;}).catch(()=>{if(!disposed)error='Scene connection unavailable';});
  void bootstrapEditor().then(async value=>{if(disposed){value.stop();return;}connection=value;api=value.client.api;assets=value.assets;outputUrl=value.outputUrl;canEdit=value.canEdit;model=createEditorModel(value.client.api);sync=createBlueprintSync(value.client.api);liveTransform=createLiveTransform(model,code=>{transformError=code;},pending=>{livePending=pending;});
   off=model.subscribe(next=>{const previous=view;view=next;if(previous.scene?.revision!==next.scene?.revision){draft=null;if(previous.scene)notify({kind:'refresh'});}});
   poll=createEditorPoll(value.client.api,model,next=>{status=next;available=next.revision!==null;error=null;if(!available)draft=null;},code=>{available=false;draft=null;error=code;},sync);await poll.poll();if(pendingSelection)model.select(pendingSelection);notify({kind:'ready'});
  }).catch(cause=>{if(!disposed)error=cause instanceof Error?cause.message:'Editor startup failed';});
  return()=>{disposed=true;clearInterval(timer);resize.disconnect();liveTransform?.close();poll?.close();off();offUI();offClose();connection?.stop();};
 });
</script>
<main class="editor-window">
 <nav class="editor-rail" aria-label="Editor panels">
  <Button variant="ghost" class={panel==='assets'?'active-panel':''} title="Assets" onclick={()=>{panel='assets';}}><Box size={20}/><span class="sr-only">Assets</span></Button>
  <Button variant="ghost" class={panel==='output'?'active-panel':''} title="Output" onclick={()=>{panel='output';}}><Radio size={20}/><span class="sr-only">Output</span></Button>
  <Button variant="ghost" class={panel==='blueprints'?'active-panel':''} title="Blueprints" onclick={()=>{panel='blueprints';}}><Workflow size={20}/><span class="sr-only">Blueprints</span></Button>
  <div class="spacer"></div>
  <Button variant="ghost" class={panel==='resources'?'active-panel':''} title="Resources" onclick={()=>{panel='resources';}}><PackageOpen size={20}/><span class="sr-only">Resources</span></Button>
 </nav>
 <div class="editor-content">
  <div class="show-toolbar"><input aria-label="Show name" maxlength="128" bind:value={showName} disabled={!canEdit||showBusy}/><div class="spacer"></div><Button variant="ghost" title="Open show" disabled={!canEdit||!available||showBusy||view.pending} onclick={openShow}><FolderOpen size={16}/></Button><Button variant="ghost" title="Save show as" disabled={!canEdit||!available||showBusy||view.pending} onclick={saveShow}><Save size={16}/></Button></div>
  <div bind:this={shell} class="editor-body">
   {#if panel==='assets'}<div class="assets-column" style:width="{width}px">{#if model}<Hierarchy {model} {view} onselect={select} ontool={setTool} disabled={!canEdit||!available||importing||livePending} onadd={add} onimport={importAvatar} ontrackingtoggle={toggleTracking}/>{/if}<div class="asset-list-footer">{view.scene?.entities.length??0} assets</div></div>
    <ResizeHandle value={width} min={160} max={maxWidth} onchange={value=>{width=value;}}/>
    <div class="properties-column">{#if model}<Inspector {model} {view} {draft} {transformError} {livePending} onlivetransform={transformLive} oncanceltransform={()=>liveTransform?.cancel()} onfinishtransform={()=>liveTransform?.end()} disabled={!canEdit||!available||importing} {devices} trackingStatus={status?.trackingStatus??[]} onlens={async(id,lens,revision)=>{await model?.setCameraLens(id,lens,revision);}} onavataridle={async(id,idle,revision)=>{await model?.setAvatarIdle(id,idle,revision);}} onavatartracking={async(id,tracking,revision)=>{await model?.setAvatarTracking(id,tracking,revision);}} ontrackingsmoothing={async(id,smoothing,revision)=>{await model?.setTrackingSmoothing(id,smoothing,revision);}} ontrackingconfig={configureTracking} ontrackingtoggle={toggleTracking}/>{/if}</div>
   {:else if panel==='output'}<section class="output-panel"><h2>Output</h2>{#if model}<OutputControls {model} {view} {status} {outputUrl} disabled={!canEdit||!available||livePending}/>{/if}</section>
   {:else if panel==='blueprints'}{#if sync}<BlueprintPanel {api} {sync} {status} scene={view.scene} disabled={!canEdit||!available||view.pending} onrun={()=>{void model?.load();notify({kind:'refresh'});}}/>{/if}
   {:else}<AssetList {assets} {warnings}/>{/if}
  </div>
  <footer><span>{showError??importError??trackingError??transformError??error??view.error??(view.scene?'Session connected':'Starting…')}</span><span>{canEdit ? (tool==='translate'?'Move':tool==='rotate'?'Rotate':'Scale'):'Read only'}</span></footer>
 </div>
</main>
