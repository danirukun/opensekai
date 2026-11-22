<script lang="ts">
 import { onMount, tick } from 'svelte';
 import { cubicIn, cubicOut } from 'svelte/easing';
 import { MediaQuery } from 'svelte/reactivity';
 import { invoke } from '@tauri-apps/api/core';
 import { getCurrentWindow } from '@tauri-apps/api/window';
 import { Button, ToastRegion, toasts } from '@oshi-connect/ui';
 import { Radio, PackageOpen, Workflow, FolderOpen, Save, Settings } from '@lucide/svelte';
 import Stats from 'stats.js';
 import {createMediaPipeTracker} from './tracking/mediapipe';
 import {fitDevices} from './tracking/hidden-cameras';
 import { bootstrapDesktop } from './bootstrap';
 import { createEditorModel, type EditorModel, type EditorView } from './editor/model';
 import {createLiveTransform} from './editor/live-transform';
 import {createLiveEdit,type LiveEdit} from './editor/live-edit';
 import { createEditorPoll } from './editor-poll';
 import { createBlueprintSync, type BlueprintSync } from './blueprints/blueprint-sync';
 import { addLinkedGraph, linkSummary, type LinkDownload, type LinkImportState } from './blueprints/link-import';
import { createEditorMemory } from './blueprints/editor-memory';
 import { createDebugFeed, planToasts, type DebugFeed } from './blueprints/debug-feed';
 import { compileBlueprint } from '@opensekai/session';
 import {cycleCamera} from './editor/cameras';
 import {withLensDirt} from './editor/camera-effects';
 import {previewActive} from './editor/preview-gate';
 import {toolForKey} from './editor/scene-keys';
 import {collectWarnings} from './editor/warnings';
 import {screenVideo,type PlaybackState} from './editor/screen';
 import type {CaptureCommands} from './editor/capture';
 import type {FaceKitCommands} from './editor/facekit';
 import type { Draft, Tool } from './editor/ui-message';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {AssetRecordSchema,RecentShowSchema,ShowDocumentSchema,ShowTemplateSchema,type RecentShow,type ShowTemplate} from '@opensekai/contracts';
 import {makeAuthoringEntity,importFailure} from './editor/authoring';
 import {applyTrackingConfig} from './editor/tracking-activation';
 import {openShowDocument,showDirty,type ShowMark} from './editor/show-management';
 import {startScreenEnds,startScreenOpen} from './editor/start-screen';
 import type {AddKind} from './editor/live-fields';
 import type { AppApi, AppStatus, AssetDebug, AssetRecord, ShowDocument, TrackingConfig,Transform } from '@opensekai/contracts';
 import OpenSekaiMark from './components/OpenSekaiMark.svelte';
 import Hierarchy from './components/Hierarchy.svelte';
 import Inspector from './components/Inspector.svelte';
 import OutputControls from './components/OutputControls.svelte';
 import AssetList from './components/AssetList.svelte';
 import ResizeHandle from './components/ResizeHandle.svelte';
 import BlueprintPanel from './components/BlueprintPanel.svelte';
 import TrackingGuide from './components/TrackingGuide.svelte';
 import {currentPlatform,isMac} from './blueprints/keystroke-format';
 import SettingsPanel from './components/SettingsPanel.svelte';
 import ScenePane from './components/ScenePane.svelte';
 import StartScreen from './components/StartScreen.svelte';
 import HelpButton from './components/HelpButton.svelte';
 import BlueprintLinkDialog from './components/BlueprintLinkDialog.svelte';
 const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
 function panelIn(_node: Element) {
  return { duration: reduceMotion.current ? 0 : 200, easing: cubicOut, css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 6}px)` };
 }
 function panelOut(_node: Element) {
  return { duration: reduceMotion.current ? 0 : 140, easing: cubicIn, css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 4}px)` };
 }
 let model=$state.raw<EditorModel>(),view=$state<EditorView>({scene:null,selectedId:null,error:null,errorMessage:null,pending:false});
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
 // The start screen (start screen R1): shown until the show first changes, or an open, save, or dismiss ends it.
 let fixtureMode=$state(true),startMark=$state<ShowMark|null>(null),startEnded=$state(false),recent=$state<RecentShow[]>([]),templates=$state<ShowTemplate[]>([]);
 $effect(()=>{if(startScreenEnds({start:startMark,current:currentMark()}))startEnded=true;});
 const startOpen=$derived(panel==='assets'&&startScreenOpen({fixtureMode,ended:startEnded,start:startMark,current:currentMark()}));
 async function refreshRecent(){try{recent=RecentShowSchema.array().max(5).parse(await invoke<unknown>('recent_show_list'));}catch{recent=[];}}
 $effect(()=>{if(canEdit)void invoke('set_show_dirty',{dirty}).catch(()=>{});});
 let importError=$state<{entityId:string;message:string}|null>(null),trackingError=$state<string|null>(null);
 let importingId=$state<string|null>(null);const importing=$derived(importingId!==null);let loads=$state<AssetLoadStatus[]>([]),modelInfo=$state.raw<((assetId:string)=>AssetDebug|null)|null>(null);
 // The playing value of each video screen from the preview frames (B29 R19).
 let playback=$state.raw<PlaybackState>(new Map());
 // The editor-only capture commands (B31 R17, R18). The source list and the allow go only through this window.
 const captureCommands:CaptureCommands={list:()=>invoke<unknown>('capture_source_list'),allow:source=>invoke<void>('capture_source_allow',{source}),openSettings:()=>invoke<void>('open_capture_settings')};
 const faceKitCommands:FaceKitCommands={list:()=>invoke<unknown>('facekit_camera_list'),openSettings:()=>invoke<void>('open_camera_settings')};
 let devices=$state<{deviceId:string;label:string}[]>([]);
 // The avatar whose tracking guide replaces the Inspector.
 let guideFor=$state<string|null>(null);
 // A Blueprint from an opensekai:// link (B39 R9-R14). `app-link` only wakes the window; the window pulls the link when it is ready.
 let link=$state.raw<LinkImportState>({kind:'idle'}),linkWanted=$state(true),linkTaking=$state(false),linkAdding=$state(false),linkToken=0;
 let blueprintsLoaded=$state(false),graphCount=$state(0),linkArrival=$state.raw<{graphId:string;missing:string[]}|null>(null);
 const linkReady=$derived(canEdit&&available&&blueprintsLoaded&&!showBusy&&guideFor===null&&link.kind==='idle'&&!linkTaking);
 const linkContent=$derived(link.kind==='confirm'&&view.scene?linkSummary(link.text,link.host,view.scene,graphCount,()=>crypto.randomUUID()):null);
 $effect(()=>{if(linkWanted&&linkReady){linkWanted=false;void takeLink();}});
 $effect(()=>{if(panel!=='blueprints')linkArrival=null;});
 async function takeLink(){
  const token=++linkToken;linkTaking=true;
  const timer=setTimeout(()=>{if(token===linkToken)link={kind:'loading'};},300);
  try{const reply=await invoke<LinkDownload|null>('take_blueprint_link');if(token===linkToken)link=reply?{kind:'confirm',text:reply.text,host:reply.host}:{kind:'idle'};}
  catch(cause){if(token===linkToken)link={kind:'failed',message:showFailure(cause)};}
  finally{clearTimeout(timer);linkTaking=false;}
 }
 // While the session answers an Import, the dialog cannot close (R11).
 function closeLink(){if(link.kind==='idle'||linkAdding)return;linkToken++;link={kind:'idle'};void invoke('finish_blueprint_link').catch(()=>{});}
 async function importLink(){
  if(!sync||linkAdding||!available||!linkContent?.ok)return;
  const {graph,missing}=linkContent.data,token=linkToken;
  linkAdding=true;
  let reply;try{reply=await addLinkedGraph(sync,graph);}finally{linkAdding=false;}
  // The result of its own batch (R13); a newer link or a closed dialog keeps its state.
  if(token!==linkToken)return;
  if(!reply.ok){link={kind:'failed',message:reply.error.message};return;}
  closeLink();panel='blueprints';linkArrival={graphId:graph.id,missing};
 }
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
  if(event.defaultPrevented||link.kind!=='idle')return;
  const target=event.target instanceof Element?event.target:null;
  const next=toolForKey({key:event.key,modifier:event.ctrlKey||event.metaKey||event.altKey,editableTarget:!!target?.closest('input,textarea,select,[contenteditable="true"]')},{assetsShown:panel==='assets',editable:canEdit&&available});
  if(next){event.preventDefault();setTool(next);}else if(event.key==='Escape'&&startOpen){startEnded=true;}else if(event.key==='Escape'&&dragging){session?.editor?.cancel();dragging=false;}
 }
 const warnings=$derived(collectWarnings(status));
 const sessionLabel=$derived(showError??importError?.message??trackingError??transformError??error??view.error??(view.scene?'Session connected':'Starting…'));
 const sessionState=$derived(sessionLabel==='Session connected'?'connected':sessionLabel==='Starting…'?'starting':'error');
 function select(id:string|null){if(importError&&importError.entityId!==id)importError=null;liveTransform?.cancel();liveField?.cancel();transformError=null;draft=null;if(model&&model.read().selectedId!==id){if(id)model.select(id);else model.clearSelection();}}
 async function add(kind:AddKind,revision:number):Promise<string|undefined>{if(!model||!view.scene)return;const entity=makeAuthoringEntity(kind,crypto.randomUUID(),model.read().scene!.entities);const reply=await model.createEntity(entity,revision);if(!reply.ok)return;select(entity.id);return entity.id;}
 async function addCharacter(){if(!view.scene)return;startEnded=true;const id=await add('character',view.scene.revision);if(id)await chooseModel(id);}
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
 // A screen shows the image; a camera takes it as its lens dirt (B37 R27). The effects are read at the time of the change.
 function setImage(entityId:string,assetId:string){
  if(!model)return;const scene=model.read().scene;const entity=scene?.entities.find(item=>item.id===entityId);
  return entity?.kind==='camera'?model.setCameraEffects(entityId,withLensDirt(entity.effects,assetId),scene?.revision):model.setScreenImage(entityId,assetId,scene?.revision);
 }
 // The returned record goes only to the screen or the camera that asked for it (B28 R19, B37 R27).
 async function chooseImage(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  try{
   const result=await invoke<{record:AssetRecord;name:string}|null>('import_image');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   await setImage(entityId,record.id);
  }catch(cause){importError={entityId,message:importFailure(cause,'Could not import image')};}finally{importingId=null;}
 }
 async function chooseHdr(entityId:string){
  if(importingId||!model||!view.scene)return;importingId=entityId;importError=null;
  const entity=model.read().scene?.entities.find(item=>item.id===entityId);
  const skyKind=entity?.kind==='camera'?entity.sky?.kind:undefined;
  try{
   // Sky image uses the existing image importer; sky HDR uses the HDR importer.
   const isHdr=skyKind==='hdr';
   const result=await invoke<{record:AssetRecord;name:string}|null>(isHdr?'import_hdr':'import_image');if(!result)return;
   const record=AssetRecordSchema.parse(result.record);assets=[...assets.filter(asset=>asset.id!==record.id),record];
   if(entity?.kind==='camera'&&skyKind)await model.setCameraSky(entityId,{...entity.sky??{kind:skyKind},kind:skyKind,assetId:record.id},model.read().scene?.revision);
  }catch(cause){importError={entityId,message:importFailure(cause,`Could not import ${skyKind==='hdr'?'HDR':'image'}`)};}finally{importingId=null;}
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
   startEnded=true;void refreshRecent();
   showName=document.name;savedMark={name:document.name,revision:inspected.data.revision,blueprintRevision:blueprints.data.revision};
   toasts.push({variant:'success',message:`Saved ${path.split(/[\\/]/).pop()}`},3000);
   return true;
  }catch(cause){showError=showFailure(cause);return false;}
  finally{showBusy=false;if(showError)toasts.push({variant:'error',message:showError});}
 }
 // Open Show, a template, and a recent show load through the same path (start screen R4, R5, R7).
 async function openShowFrom(load:()=>Promise<unknown|null>):Promise<boolean>{
  if(!model||showBusy||view.pending||guideFor!==null||link.kind!=='idle'||linkTaking)return false;
  showBusy=true;showError=null;
  try{
   const raw=await load();if(raw===null)return false;
   liveTransform?.cancel();liveField?.cancel();
   const reply=await openShowDocument(raw,scene=>model!.replaceScene(scene),async document=>{
    panel='assets';await tick();
    showName=document.name;
    select(null);
    const broken=document.blueprints.map(graph=>({graph,result:compileBlueprint(graph)})).find(item=>!item.result.ok);
    if(broken&&!broken.result.ok)showError=`${broken.graph.name}: ${broken.result.error.message}`;
    if(sync){const applied=sync.edit([{kind:'replaceAll',graphs:document.blueprints}]);await sync.idle();if(applied.ok)memory.history.clear();if((!applied.ok||sync.issue())&&!showError)showError='Blueprints were not applied';}
   });
   if(reply.ok){await invoke('commit_show_open');savedMark={name:showName,revision:reply.data.revision,blueprintRevision:sync?.revision()};startEnded=true;}
   if(!reply.ok){showError=reply.error.message;return false;}
   return true;
  }catch(cause){showError=showFailure(cause);return false;}
  finally{showBusy=false;}
 }
 async function openShow(){if(await openShowFrom(()=>invoke<unknown|null>('open_show')))void refreshRecent();}
 function openTemplate(id:string){return openShowFrom(()=>invoke<unknown>('open_show_template',{id}));}
 async function openRecent(index:number){
  const opened=await openShowFrom(()=>invoke<unknown>('open_recent_show',{index}));
  if(!opened&&showError)toasts.push({variant:'error',message:showError});
  void refreshRecent();
 }
 const showCommands={open:()=>openShow(),save:()=>saveShow(),saveAs:()=>saveShow(true)};
 function runShowCommand(command:unknown){if(canEdit&&available&&typeof command==='string'&&Object.hasOwn(showCommands,command))void showCommands[command as keyof typeof showCommands]();}
 onMount(()=>{
  let disposed=false,off=()=>{},offMenu=()=>{},offLink=()=>{},offGraphs=()=>{},offLoads=()=>{},offPlayback=()=>{},offClock=()=>{},poll:ReturnType<typeof createEditorPoll>|undefined;
  let tracker:ReturnType<typeof createMediaPipeTracker>|undefined;
  const stats=new Stats();stats.showPanel(0);stats.dom.style.position='static';monitorHost!.appendChild(stats.dom);
  try{perfVisible=localStorage.getItem('opensekai.scene.perfMonitor')==='true';}catch{}
  const reconcileTracking=()=>{if(!session||session.tracking.now()===null)return;tracker?.reconcile(model?.read().scene?.entities.filter(entity=>entity.kind==='tracking')??[]);};
  // The scene pane keeps at least 320 px beside the 320 px Inspector (R3).
  const resize=new ResizeObserver(()=>{maxWidth=Math.max(160,Math.min(360,shell.clientWidth-320-320));width=Math.min(width,maxWidth);});resize.observe(shell);
  const timer=setInterval(()=>{void poll?.poll();void debugFeed?.poll();},500);
  void getCurrentWindow().listen<unknown>('show-command',event=>runShowCommand(event.payload)).then(stop=>{if(disposed)stop();else offMenu=stop;});
  void getCurrentWindow().listen<unknown>('app-link',()=>{linkWanted=true;}).then(stop=>{if(disposed)stop();else offLink=stop;});
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
   session=value;api=value.client.api;assets=value.assets;outputUrl=value.outputUrl;canEdit=value.canEdit;fixtureMode=value.fixtureMode;
   if(value.canEdit){void refreshRecent();void invoke<unknown>('show_template_list').then(list=>{templates=ShowTemplateSchema.array().max(16).parse(list);}).catch(()=>{});}
   offLoads=value.onLoadStatus(entries=>{loads=entries;});modelInfo=value.modelInfo;offPlayback=value.onPlayback(next=>{playback=next;});
   model=createEditorModel(value.client.api);sync=createBlueprintSync(value.client.api);debugFeed=createDebugFeed(value.client.api,showDebugToasts);liveTransform=createLiveTransform(model,code=>{transformError=code;},pending=>{livePending=pending;});liveField=createLiveEdit(model,()=>{},pending=>{fieldPending=pending;});
   tracker=createMediaPipeTracker({now:()=>value.tracking.now()??0,onSample:sample=>value.tracking.submit({samples:[sample],statuses:[]}),onStatus:status=>value.tracking.submit({samples:[],statuses:[status]}),onDevices:choices=>{devices=fitDevices(choices.map(device=>({deviceId:device.deviceId.slice(0,512),label:device.label.slice(0,128)})));}});
   offClock=value.tracking.onClock(reconcileTracking);
   offGraphs=sync.subscribe(next=>{graphCount=next.length;});void sync.load().then(()=>{graphCount=sync!.view().length;blueprintsLoaded=true;});
   off=model.subscribe(next=>{const previous=view;view=next;if(previous.scene?.revision!==next.scene?.revision)draft=null;syncViewport();reconcileTracking();});
   poll=createEditorPoll(value.client.api,model,next=>{status=next;available=next.revision!==null;error=null;if(!available)cancelDrag();if(!savedMark&&next.revision!==null){savedMark={name:showName,revision:next.revision,blueprintRevision:next.blueprintRevision};startMark=savedMark;}syncViewport();},code=>{available=false;error=code;cancelDrag();syncViewport();},sync,()=>panel==='blueprints');await poll.poll();syncViewport();
  }).catch(cause=>{if(!disposed)error=cause instanceof Error?cause.message:'Session startup failed';});
  return()=>{disposed=true;clearInterval(timer);offToasts();resize.disconnect();tracker?.shutdown();offClock();offLoads();offPlayback();liveTransform?.close();liveField?.close();poll?.close();off();offMenu();offLink();offGraphs();stats.dom.remove();void session?.stop().catch(()=>{});};
 });
</script>
<svelte:window onkeydown={key}/>
<main class="editor-window">
 <nav class="editor-rail" aria-label="Editor panels">
  <Button variant="ghost" class={panel==='assets'?'active-panel':''} tooltip="Assets" tooltipPlacement="right" onclick={()=>{panel='assets';}}><OpenSekaiMark/><span class="sr-only">Assets</span></Button>
  <Button variant="ghost" class={panel==='output'?'active-panel':''} tooltip="Output" tooltipPlacement="right" onclick={()=>{panel='output';}}><Radio size={20}/><span class="sr-only">Output</span></Button>
  <Button variant="ghost" class={panel==='blueprints'?'active-panel':''} tooltip="Blueprints" tooltipPlacement="right" onclick={()=>{panel='blueprints';}}><Workflow size={20}/><span class="sr-only">Blueprints</span></Button>
  <div class="spacer"></div>
  <Button variant="ghost" class={panel==='resources'?'active-panel':''} tooltip="Resources" tooltipPlacement="right" onclick={()=>{panel='resources';}}><PackageOpen size={20}/><span class="sr-only">Resources</span></Button>
  <Button variant="ghost" class={panel==='settings'?'active-panel':''} tooltip="Settings" tooltipPlacement="right" onclick={()=>{panel='settings';}}><Settings size={20}/><span class="sr-only">Settings</span></Button>
 </nav>
 <div class="editor-content">
  <div class="show-toolbar"><input aria-label="Show name" maxlength="128" bind:value={showName} disabled={!canEdit||showBusy}/><div class="spacer"></div><span class={['session-mark', sessionState]} role="status" title={sessionLabel}>{sessionState==='error'?sessionLabel:''}</span><Button variant="ghost" tooltip="Open show" tooltipPlacement="bottom-end" disabled={!canEdit||!available||showBusy||view.pending||guideFor!==null} onclick={openShow}><FolderOpen size={16}/></Button><Button variant="ghost" tooltip="Save show (⇧ Save As)" tooltipPlacement="bottom-end" disabled={!canEdit||!available||showBusy||view.pending} onclick={(event:MouseEvent)=>{void saveShow(event.shiftKey);}}><Save size={16}/></Button></div>
  <div bind:this={shell} class="editor-body">
   {#if panel==='assets'}<div class="assets-column" style:width="{width}px" in:panelIn out:panelOut>{#if model}<Hierarchy {model} {view} onselect={select} ontool={setTool} disabled={!canEdit||!available||importing||livePending||fieldPending} onadd={add} loading={new Set(loads.filter(load=>load.stage!=='failed').map(load=>load.entityId))} ontrackingtoggle={toggleTracking}/>{/if}<div class="asset-list-footer">{view.scene?.entities.length??0} assets</div></div>
    <ResizeHandle value={width} min={160} max={maxWidth} onchange={value=>{width=value;}}/>
   {/if}
   <!-- The pane stays mounted on every tab, so the renderer and its loaded assets stay (R5). -->
   <ScenePane bind:canvas bind:webBack bind:webFront bind:counterHost bind:monitorHost hidden={panel!=='assets'} {tool} {canEdit} {available} pending={view.pending} selectedName={selected?.name??''} selectedEditable={!!selected&&selected.kind!=='tracking'} {previewOn} {perfVisible} {loads} {names} ontool={setTool} onpreviewtoggle={()=>{previewOn=!previewOn;}} onperftoggle={togglePerf} ondismissload={id=>session?.dismissLoad(id)}>{#if startOpen}<StartScreen {recent} {templates} disabled={!canEdit||!available||showBusy||view.pending||importing} onaddcharacter={()=>{void addCharacter();}} onopen={()=>{void openShow();}} ontemplate={id=>{void openTemplate(id);}} onrecent={index=>{void openRecent(index);}} onclose={()=>{startEnded=true;}}/>{/if}</ScenePane>
   <!-- The guide stays mounted while another rail panel shows, so a panel switch keeps the run (R14a). -->
   {#if model&&api&&guideFor}<div class="properties-column" hidden={panel!=='assets'}><TrackingGuide avatarId={guideFor} {model} {view} {api} {sync} {assets} localAddresses={status?.localAddresses??[]} trackingStatus={status?.trackingStatus??[]} {devices} faceKit={canEdit?faceKitCommands:null} isMac={isMac(currentPlatform())} disabled={!canEdit||!available} onclose={()=>{guideFor=null;}}/></div>{/if}
   {#if panel==='assets'}{#if model&&!(api&&guideFor)}<div class="properties-column" in:panelIn out:panelOut><Inspector onguide={id=>{guideFor=id;}} {model} {view} onlivefield={request=>{liveField?.offer(request);}} onlivefieldend={()=>liveField?.end()} {assets} {loads} {modelInfo} {importingId} {importError} onchoosemodel={chooseModel} onchoosescene={chooseScene} onchooseimage={chooseImage} onchoosehdr={chooseHdr} onchoosevideo={chooseVideo} {playback} onpickimage={(id,assetId)=>{void model?.setScreenImage(id,assetId,model.read().scene?.revision);}} onpickscene={(id,assetId)=>{void setSceneModel(id,assetId);}} onrenderenvironment={(id,value,revision)=>model?.setCameraRenderEnvironment(id,value,revision)??Promise.resolve(undefined)} {expressionApi} onexpressionsettings={(id,name,settings,revision)=>model?.setAvatarExpression(id,name,settings,revision)??Promise.resolve(undefined)} onnavigation={(id,navigation,revision)=>model?.setCameraNavigation(id,navigation,revision)??Promise.resolve(undefined)} onscreenshot={id=>model?.cameraScreenshot(id)??Promise.resolve(undefined)} onopenscreenshots={()=>invoke<void>('open_screenshots_folder')} {draft} {transformError} {livePending} onlivetransform={transformLive} oncanceltransform={()=>liveTransform?.cancel()} onfinishtransform={()=>liveTransform?.end()} disabled={!canEdit||!available||importing} {devices} trackingStatus={status?.trackingStatus??[]} localAddresses={status?.localAddresses??[]} vmcSenders={status?.vmcSenders??[]} captureCommands={canEdit?captureCommands:null} faceKit={canEdit?faceKitCommands:null} captureStatus={status} onlens={async(id,lens,revision)=>{await model?.setCameraLens(id,lens,revision);}} onavataridle={async(id,idle,revision)=>{await model?.setAvatarIdle(id,idle,revision);}} onavatartracking={async(id,tracking,revision)=>{await model?.setAvatarTracking(id,tracking,revision);}} ontrackingsmoothing={async(id,smoothing,revision)=>{await model?.setTrackingSmoothing(id,smoothing,revision);}} ontrackingmapping={async(id,mapping,revision)=>{await model?.setTrackingMapping(id,mapping,revision);}} ontrackingcalibrate={(id,revision)=>model?.calibrateTracking(id,revision)??Promise.resolve(undefined)} ontrackingcalibrationreset={(id,revision)=>model?.resetTrackingCalibration(id,revision)??Promise.resolve(undefined)} ontrackingconfig={configureTracking} ontrackingtoggle={toggleTracking}/></div>{/if}
   {:else if panel==='output'}<section class="output-panel panel-swap" in:panelIn out:panelOut><div class="panel-heading"><h2>Output</h2><HelpButton topic="output"/></div>{#if model}<OutputControls {model} {view} {status} {outputUrl} disabled={!canEdit||!available||livePending||fieldPending}/>{/if}</section>
   {:else if panel==='blueprints'}<div class="panel-swap" in:panelIn out:panelOut>{#if sync}<BlueprintPanel {api} {sync} debug={debugFeed} {memory} {status} {assets} scene={view.scene} selectedEntityId={view.selectedId} disabled={!canEdit||!available||view.pending} onrun={()=>{void model?.load();}} arrival={linkArrival}/>{/if}</div>
   {:else if panel==='settings'}<div class="panel-swap" in:panelIn out:panelOut><SettingsPanel {api} youtube={status?.youtube} disabled={!canEdit} onchange={youtube=>{if(status)status={...status,youtube};}}/></div>
   {:else}<div class="panel-swap" in:panelIn out:panelOut><AssetList {assets} {warnings}/></div>{/if}
  </div>
 </div>
</main>
{#if link.kind!=='idle'}<BlueprintLinkDialog state={link} summary={linkContent} busy={linkAdding} canImport={available} onimport={()=>{void importLink();}} onclose={closeLink}/>{/if}
<ToastRegion/>
