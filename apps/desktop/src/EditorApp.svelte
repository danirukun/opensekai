<script lang="ts">
 import { onMount } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { getCurrentWindow } from '@tauri-apps/api/window';
 import { Button } from '@oshi-connect/ui';
 import { Box, Radio, PackageOpen } from '@lucide/svelte';
 import { bootstrapEditor } from './bootstrap';
 import { createEditorModel, type EditorModel, type EditorView } from './editor/model';
 import { createEditorPoll } from './editor-poll';
 import { listenUI, sendUI } from './editor/ui-bridge';
 import {collectWarnings} from './editor/warnings';
 import type { Draft, Tool } from './editor/ui-message';
 import type { AppStatus, AssetRecord } from '@opensekai/contracts';
 import Hierarchy from './components/Hierarchy.svelte';
 import Inspector from './components/Inspector.svelte';
 import OutputControls from './components/OutputControls.svelte';
 import AssetList from './components/AssetList.svelte';
 import ResizeHandle from './components/ResizeHandle.svelte';
 let model=$state.raw<EditorModel>(),view=$state<EditorView>({scene:null,selectedId:null,error:null,pending:false});
 let status=$state<AppStatus|null>(null),assets=$state<AssetRecord[]>([]),outputUrl=$state(''),canEdit=$state(false),available=$state(false),error=$state<string|null>(null);
 let panel=$state<'assets'|'output'|'resources'>('assets'),width=$state(224),maxWidth=$state(360),shell:HTMLDivElement;
 let draft=$state<Draft>(null),tool=$state<Tool>('translate');
 const warnings=$derived(collectWarnings(status));
 function notify(message:Parameters<typeof sendUI>[1]){void sendUI('main',message).catch(()=>{error='Scene unavailable';});}
 function select(id:string){draft=null;notify({kind:'selection',entityId:id});}
 function setTool(next:Tool){tool=next;notify({kind:'tool',tool});}
 onMount(()=>{
  let disposed=false,off=()=>{},offUI=()=>{},offClose=()=>{},connection:Awaited<ReturnType<typeof bootstrapEditor>>|undefined,poll:ReturnType<typeof createEditorPoll>|undefined;
  let pendingSelection:string|null|undefined;
  const resize=new ResizeObserver(()=>{maxWidth=Math.max(160,Math.min(420,shell.clientWidth-330));width=Math.min(width,maxWidth);});resize.observe(shell);
  const timer=setInterval(()=>{void poll?.poll();},500);
  void getCurrentWindow().onCloseRequested(event=>{event.preventDefault();void invoke('hide_editor').catch(()=>{error='Could not hide editor';});}).then(stop=>{if(disposed)stop();else offClose=stop;});
  void listenUI(message=>{if(message.kind==='selection'){draft=null;pendingSelection=message.entityId;if(model){if(message.entityId)model.select(message.entityId);else model.clearSelection();}}else if(message.kind==='tool')tool=message.tool;else if(message.kind==='draft')draft=available?message.draft:null;else if(message.kind==='refresh'){draft=null;void model?.load();}}).then(stop=>{if(disposed)stop();else offUI=stop;}).catch(()=>{if(!disposed)error='Scene connection unavailable';});
  void bootstrapEditor().then(async value=>{if(disposed){value.stop();return;}connection=value;assets=value.assets;outputUrl=value.outputUrl;canEdit=value.canEdit;model=createEditorModel(value.client.api);
   off=model.subscribe(next=>{const previous=view;view=next;if(previous.scene?.revision!==next.scene?.revision){draft=null;if(previous.scene)notify({kind:'refresh'});}});
   poll=createEditorPoll(value.client.api,model,next=>{status=next;available=next.revision!==null;error=null;if(!available)draft=null;},code=>{available=false;draft=null;error=code;});await poll.poll();if(pendingSelection)model.select(pendingSelection);notify({kind:'ready'});
  }).catch(cause=>{if(!disposed)error=cause instanceof Error?cause.message:'Editor startup failed';});
  return()=>{disposed=true;clearInterval(timer);resize.disconnect();poll?.close();off();offUI();offClose();connection?.stop();};
 });
</script>
<main class="editor-window">
 <nav class="editor-rail" aria-label="Editor panels">
  <Button variant="ghost" class={panel==='assets'?'active-panel':''} title="Assets" onclick={()=>{panel='assets';}}><Box size={20}/><span class="sr-only">Assets</span></Button>
  <Button variant="ghost" class={panel==='output'?'active-panel':''} title="Output" onclick={()=>{panel='output';}}><Radio size={20}/><span class="sr-only">Output</span></Button>
  <div class="spacer"></div>
  <Button variant="ghost" class={panel==='resources'?'active-panel':''} title="Resources" onclick={()=>{panel='resources';}}><PackageOpen size={20}/><span class="sr-only">Resources</span></Button>
 </nav>
 <div class="editor-content">
  <div bind:this={shell} class="editor-body">
   {#if panel==='assets'}<div class="assets-column" style:width="{width}px">{#if model}<Hierarchy {model} {view} onselect={select} ontool={setTool} disabled={!canEdit||!available}/>{/if}<div class="asset-list-footer">{view.scene?.entities.length??0} assets</div></div>
    <ResizeHandle value={width} min={160} max={maxWidth} onchange={value=>{width=value;}}/>
    <div class="properties-column">{#if model}<Inspector {model} {view} {draft} disabled={!canEdit||!available}/>{/if}</div>
   {:else if panel==='output'}<section class="output-panel"><h2>Output</h2>{#if model}<OutputControls {model} {view} {status} {outputUrl} disabled={!canEdit||!available}/>{/if}</section>
   {:else}<AssetList {assets} {warnings}/>{/if}
  </div>
  <footer><span>{error??(view.scene?'Session connected':'Starting…')}</span><span>{canEdit ? (tool==='translate'?'Move':tool==='rotate'?'Rotate':'Scale'):'Read only'}</span></footer>
 </div>
</main>
