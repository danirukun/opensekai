<script lang="ts">
 import { onMount } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { Button } from '@oshi-connect/ui';
 import { Move, RotateCw, Scaling, PanelsTopLeft, Activity } from '@lucide/svelte';
 import Stats from 'stats.js';
 import {createMediaPipeTracker} from './tracking/mediapipe';
 import { bootstrapDesktop } from './bootstrap';
 import { createEditorModel, type EditorModel, type EditorView } from './editor/model';
 import { createEditorPoll } from './editor-poll';
 import { listenUI, sendUI } from './editor/ui-bridge';
 import { createDraftSender, fitPreview, type Tool } from './editor/ui-message';
 import { cycleCamera } from './editor/cameras';
 import LoadOverlay from './components/LoadOverlay.svelte';
 import {createLoadStatusSender} from './editor/load-status';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import ContextMenu, {type MenuAction} from './components/ContextMenu.svelte';
 let canvas:HTMLCanvasElement,stage:HTMLDivElement,monitorHost:HTMLDivElement;
 let previewSize=$state({width:0,height:0});
 let session:Awaited<ReturnType<typeof bootstrapDesktop>>|undefined;
 let model=$state.raw<EditorModel>();
 let view=$state<EditorView>({scene:null,selectedId:null,error:null,pending:false});
 let tool=$state<Tool>('translate'),canEdit=$state(false),available=$state(false),error=$state<string|null>(null),dragging=$state(false);
 let menu=$state<{x:number;y:number;actions:MenuAction[]}|null>(null);
 let perfVisible=$state(false);
 function togglePerf(){perfVisible=!perfVisible;try{localStorage.setItem('opensekai.scene.perfMonitor',perfVisible?'true':'false');}catch{}}
 let loads=$state<AssetLoadStatus[]>([]);
 const names=$derived(Object.fromEntries((view.scene?.entities??[]).map(entity=>[entity.id,entity.name])));
 const selected=$derived(view.scene?.entities.find(e=>e.id===view.selectedId));
 function sync(){const state=model?.read();session?.editor?.sync({scene:state?.scene??null,selectedId:selected?.kind==='tracking'?null:view.selectedId,tool,enabled:canEdit&&available&&!view.pending&&selected?.kind!=='tracking'});}
 function notify(message:Parameters<typeof sendUI>[1]){void sendUI('editor',message).catch(()=>{error='Editor unavailable';});}
 function setTool(value:Tool){tool=value;sync();notify({kind:'tool',tool});}
 function showEditor(){void invoke('show_editor').catch(()=>{error='Could not open editor';});}
 function key(event:KeyboardEvent){if(event.defaultPrevented)return;if(event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,[contenteditable="true"]')))return;if(event.ctrlKey||event.metaKey||event.altKey)return;
  const next=({w:'translate',e:'rotate',r:'scale'} as Record<string,Tool>)[event.key.toLowerCase()];if(next&&canEdit&&available){event.preventDefault();setTool(next);}else if(event.key==='Escape'){if(dragging){session?.editor?.cancel();dragging=false;}else if(!menu){showEditor();}}
 }
 function context(event:MouseEvent){event.preventDefault();const actions:MenuAction[]=[{label:'Open editor',run:showEditor}];if(selected&&selected.kind!=='tracking')for(const [label,value] of [['Move','translate'],['Rotate','rotate'],['Scale','scale']] as const)actions.push({label,disabled:!canEdit||!available||view.pending,run:()=>setTool(value)});menu={x:event.clientX,y:event.clientY,actions};}
 onMount(()=>{
  let disposed=false,off=()=>{},offUI=()=>{};let poll:ReturnType<typeof createEditorPoll>|undefined;
  const stats=new Stats();stats.showPanel(0);stats.dom.style.position='static';monitorHost.appendChild(stats.dom);
  try{perfVisible=localStorage.getItem('opensekai.scene.perfMonitor')==='true';}catch{}
  let tracker:ReturnType<typeof createMediaPipeTracker>|undefined,offClock=()=>{};
  let devices:{deviceId:string;label:string}[]=[];
  const reconcileTracking=()=>{if(!session||session.tracking.now()===null)return;tracker?.reconcile(model?.read().scene?.entities.filter(entity=>entity.kind==='tracking')??[]);};
  const loadSender=createLoadStatusSender(message=>sendUI('editor',message));let offLoads=()=>{};
  const drafts=createDraftSender(message=>sendUI('editor',message),()=>{if(!disposed)error='Editor unavailable';});
  const resize=new ResizeObserver(()=>{previewSize=fitPreview(stage.clientWidth,stage.clientHeight,24);});resize.observe(stage);
  const timer=setInterval(()=>{void poll?.poll();},500);
  void listenUI(message=>{if(message.kind==='selection'){if(message.entityId)model?.select(message.entityId);else model?.clearSelection();}else if(message.kind==='tool'){tool=message.tool;sync();}else if(message.kind==='refresh')void model?.load();else if(message.kind==='ready'){notify({kind:'trackingDevices',devices});notify({kind:'selection',entityId:view.selectedId});notify({kind:'tool',tool});loadSender.resend();}}).then(stop=>{if(disposed)stop();else offUI=stop;}).catch(()=>{if(!disposed)error='Editor connection unavailable';});
  void bootstrapDesktop(canvas,{
   onSelect(id){if(id)model?.select(id);else model?.clearSelection();notify({kind:'selection',entityId:id});},
   async onCommit(edit){const reply=await model!.setTransform(edit.entityId,edit.transform,edit.expectedRevision);notify({kind:'refresh'});return reply;},
   onDraft(draft){dragging=draft!==null;drafts.offer(draft);},
   // Navigation commits go straight to the patch route, so the model does not block the gesture as pending.
   onNavigate(edit){return session!.client.api.scenePatch(edit);},
   onNavigateEnd(){void model?.load();notify({kind:'refresh'});},
   onCycleCamera(direction){const state=model?.read();const next=cycleCamera(state?.scene??null,direction);if(next&&!state?.pending)void model?.selectCamera(next).then(()=>notify({kind:'refresh'}));},
  },{begin(){if(!perfVisible)return false;stats.begin();return true;},end(){stats.end();}}).then(async value=>{if(disposed){await value.stop();return;}session=value;offLoads=value.onLoadStatus(entries=>{loads=entries;loadSender.offer(entries);});canEdit=value.canEdit;model=createEditorModel(value.client.api);
   tracker=createMediaPipeTracker({now:()=>value.tracking.now()??0,onSample:sample=>value.tracking.submit({samples:[sample],statuses:[]}),onStatus:status=>value.tracking.submit({samples:[],statuses:[status]}),onDevices:choices=>{devices=choices.slice(0,8).map(device=>({deviceId:device.deviceId.slice(0,512),label:device.label.slice(0,128)}));notify({kind:'trackingDevices',devices});}});
   offClock=value.tracking.onClock(reconcileTracking);
   off=model.subscribe(next=>{view=next;sync();reconcileTracking();});poll=createEditorPoll(value.client.api,model,status=>{available=status.revision!==null;error=null;if(!available){session?.editor?.cancel();dragging=false;drafts.offer(null);}sync();},code=>{available=false;error=code;session?.editor?.cancel();dragging=false;drafts.offer(null);sync();});await poll.poll();sync();}).catch(cause=>{if(!disposed)error=cause instanceof Error?cause.message:'Session startup failed';});
  return()=>{disposed=true;clearInterval(timer);resize.disconnect();tracker?.shutdown();offClock();offLoads();loadSender.close();drafts.close();poll?.close();off();offUI();stats.dom.remove();void session?.stop().catch(()=>{});};
 });
</script>
<svelte:window onkeydown={key}/>
<main class="scene-window">
 <header class="scene-toolbar"><span class="scene-title">Scene</span><div class="tool-group" role="toolbar" aria-label="Transform tools">
  <Button variant="ghost" class={tool==='translate'?'active-tool':''} title="Move (W)" disabled={!canEdit||!available} onclick={()=>setTool('translate')}><Move size={17}/><span class="sr-only">Move</span></Button>
  <Button variant="ghost" class={tool==='rotate'?'active-tool':''} title="Rotate (E)" disabled={!canEdit||!available} onclick={()=>setTool('rotate')}><RotateCw size={17}/><span class="sr-only">Rotate</span></Button>
  <Button variant="ghost" class={tool==='scale'?'active-tool':''} title="Scale (R)" disabled={!canEdit||!available} onclick={()=>setTool('scale')}><Scaling size={17}/><span class="sr-only">Scale</span></Button>
 </div><span class="selection-name">{selected?.name??''}</span><div class="spacer"></div><Button variant="ghost" class={perfVisible?'active-tool':''} title={perfVisible?'Hide performance monitor':'Show performance monitor'} onclick={togglePerf}><Activity size={17}/><span class="sr-only">{perfVisible?'Hide performance monitor':'Show performance monitor'}</span></Button><Button variant="secondary" onclick={showEditor}><PanelsTopLeft size={15}/>Editor</Button></header>
 <div bind:this={stage} class="viewport" oncontextmenu={context} role="presentation"><div class="preview-surface" style:width={`${previewSize.width}px`} style:height={`${previewSize.height}px`}><canvas bind:this={canvas} id="preview" tabindex="0" aria-label="Scene preview"></canvas><div class="camera-frame" aria-hidden="true"></div><LoadOverlay entries={loads} {names} ondismiss={id=>session?.dismissLoad(id)}/></div><div bind:this={monitorHost} class="perf-monitor" class:visible={perfVisible} aria-label="Scene preview performance"></div></div>
 <footer><span>{view.scene?'Session connected':'Starting…'}</span><span>{canEdit?'W Move · E Rotate · R Scale':'Read only'}</span></footer>
 {#if error||view.error}<p class="window-error" role="alert">{error??view.error}</p>{/if}
</main>
{#if menu}<ContextMenu {...menu} onclose={()=>{menu=null;}}/>{/if}
