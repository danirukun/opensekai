<script lang="ts">
 import type { Transform, Reply, AssetDebug, AssetRecord, ExpressionSettings, VmcSenderStatus } from '@opensekai/contracts';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {modelLabel} from '../editor/authoring';
 import EmptyState from './EmptyState.svelte';
 import AvatarModelField from './AvatarModelField.svelte';
 import AvatarExpressionFields,{type ExpressionApi} from './AvatarExpressionFields.svelte';
 import AvatarMeshFields from './AvatarMeshFields.svelte';
import MaterialFields from './MaterialFields.svelte';
import {recordMaterials,savedMaterials,showsMaterials} from '../editor/materials';
 import AvatarDebugFields from './AvatarDebugFields.svelte';
 import {hasTriggerableExpressions} from '../editor/expressions';
 import type { EditorPanelProps } from '../editor/model';
 import {antiAliasingOptions,matchingStatus,settleCheckbox,sourceUsers,type LivePropertyCallbacks} from '../editor/live-fields';
 import { Select, Button } from '@oshi-connect/ui';
 import { CameraAntiAliasingSchema } from '@opensekai/contracts';
 import ColorField from './ColorField.svelte';
 import SliderField from './SliderField.svelte';
 const skyKindOptions=[{value:'none',label:'None'},{value:'color',label:'Color'},{value:'image',label:'Image'},{value:'hdr',label:'HDR'}];
 import CameraLensFields from './CameraLensFields.svelte';
 import {lensPresetOperations,type LensPresetResult} from '../editor/lens-presets';
 import CameraNavigationFields from './CameraNavigationFields.svelte';
 import type { CameraNavigation, CameraScreenshotResult } from '@opensekai/contracts';
 import SceneModelFields from './SceneModelFields.svelte';
 import ScreenImageFields from './ScreenImageFields.svelte';
 import ScreenVideoFields from './ScreenVideoFields.svelte';
 import ScreenWebFields from './ScreenWebFields.svelte';
 import ScreenContentField from './ScreenContentField.svelte';
 import ScreenCaptureFields from './ScreenCaptureFields.svelte';
 import type {AppStatus} from '@opensekai/contracts';
 import {captureMessage,captureState,previewWarnings,startCapture,type CaptureCommands} from '../editor/capture';
 import {DEFAULT_WEB_SCREEN,VIDEO_DEFAULTS,contentKind,contentOptions,playLabel,screenVideo,type PlaybackState} from '../editor/screen';
 import LightFields from './LightFields.svelte';
 import HazeFields from './HazeFields.svelte';
 import SnowFields from './SnowFields.svelte';
 import CameraGradingFields from './CameraGradingFields.svelte';
 import AvatarLightingFields from './AvatarLightingFields.svelte';
 import CameraEffectsFields from './CameraEffectsFields.svelte';
 import FpsCounterFields from './FpsCounterFields.svelte';
 import VmcSenderFields from './VmcSenderFields.svelte';
 import HelpButton from './HelpButton.svelte';
 import {topicForKind} from '../editor/help';
 import {senderStatus} from '../editor/vmc-sender';
 import {directionFromMainCamera} from '../editor/lights';
 import type {LiveRequest} from '../editor/live-edit';
 import AvatarSourceFields from './AvatarSourceFields.svelte';
 import AvatarAnimationFields from './AvatarAnimationFields.svelte';
 import TrackingDiagnostics from './TrackingDiagnostics.svelte';
 import TrackingSmoothingFields from './TrackingSmoothingFields.svelte';
 import TrackingMappingFields from './TrackingMappingFields.svelte';
 import InspectorSection from './InspectorSection.svelte';
 import InspectorIndex from './InspectorIndex.svelte';
 import ResetMark from './ResetMark.svelte';
 import {tick} from 'svelte';
 import {resetMarks} from '../editor/property-defaults';
 import {currentSection,indexShows,isCollapsed,parseSectionState,sectionsFor,SECTION_STORAGE_KEY,toggleSection,setCollapsed,type SectionState} from '../editor/inspector-sections';
 import TrackingSourceFields from './TrackingSourceFields.svelte';
 import type {FaceKitCommands} from '../editor/facekit';
 import TransformFields from './TransformFields.svelte';
 type Props=LivePropertyCallbacks&Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};onlivefield?:(request:LiveRequest)=>void;onlivefieldend?:()=>void;draft?:{entityId:string;transform:Transform}|null;ondraft?:(draft:{entityId:string;transform:Transform}|null)=>void;disabled?:boolean;onlivetransform?:(id:string,transform:Transform)=>void;oncanceltransform?:()=>void;onfinishtransform?:()=>void;transformError?:string|null;livePending?:boolean;assets?:AssetRecord[];loads?:AssetLoadStatus[];modelInfo?:((assetId:string)=>AssetDebug|null)|null;importingId?:string|null;onchoosemodel?:(id:string)=>void;importError?:{entityId:string;message:string}|null;onchoosescene?:(id:string)=>void;onpickscene?:(id:string,assetId:string|null)=>void;onchooseimage?:(id:string)=>void;onchoosehdr?:(id:string)=>void;onpickimage?:(id:string,assetId:string|null)=>void;onchoosevideo?:(id:string)=>void;playback?:PlaybackState;onrenderenvironment?:(id:string,value:boolean,revision:number)=>Promise<Reply<unknown>|undefined>;expressionApi?:ExpressionApi|null;onexpressionsettings?:(id:string,name:string,settings:ExpressionSettings|null,revision:number)=>Promise<unknown>;onnavigation?:(id:string,navigation:CameraNavigation,revision:number)=>Promise<Reply<unknown>|undefined>;onscreenshot?:(id:string)=>Promise<Reply<CameraScreenshotResult>|undefined>;onopenscreenshots?:()=>Promise<void>;onguide?:(avatarId:string)=>void;vmcSenders?:VmcSenderStatus[];captureCommands?:CaptureCommands|null;faceKit?:FaceKitCommands|null;captureStatus?:Pick<AppStatus,'captures'|'outputs'>|null;onchooseanimation?:(entityId:string)=>void};
 let {model,view,onlivefield,onlivefieldend,draft=null,ondraft,disabled=false,onlivetransform,oncanceltransform,onfinishtransform,transformError=null,livePending=false,assets=[],loads=[],modelInfo=null,importingId=null,importError=null,onchoosemodel,onchoosescene,onpickscene,onchooseimage,onchoosehdr,onpickimage,onchoosevideo,playback=new Map(),onrenderenvironment,expressionApi=null,onexpressionsettings,onnavigation,onscreenshot,onopenscreenshots,onlens,onavatartracking,onavataridle,ontrackingconfig,ontrackingsmoothing,ontrackingmapping,ontrackingcalibrate,ontrackingcalibrationreset,ontrackingtoggle,trackingStatus=[],localAddresses=[],devices=[],onguide,vmcSenders=[],captureCommands=null,faceKit=null,captureStatus=null,onchooseanimation}:Props=$props();
 const animationAssets=$derived(assets.filter(a=>(a.format==='vrma'||a.format==='fbx')&&a.id.startsWith('animation_')).map(a=>({id:a.id,name:a.name})));
 const entity=$derived(view.scene?.entities.find(item=>item.id===view.selectedId));
 // A live slider or color edit keeps its fields enabled; any other pending edit disables them (B12 R14).
 const busy=$derived(view.pending&&!view.livePending);
 const live=(entityId:string,send:LiveRequest['send'])=>onlivefield?.({entityId,send});
 let shooting=$state(false),shot=$state<{entityId:string;fileName:string}|null>(null),shotError=$state<string|null>(null);
 async function screenshot(id:string){shooting=true;shotError=null;try{const reply=await onscreenshot?.(id);if(reply?.ok)shot={entityId:id,fileName:reply.data.fileName};else if(reply)shotError=reply.error.code;}finally{shooting=false;}}
 async function openFolder(){shotError=null;try{await onopenscreenshots?.();}catch{shotError='Could not open folder';}}
 const applyLensPresetResult=(id:string,result:LensPresetResult,revision:number)=>model.applyOperations(lensPresetOperations(id,result),revision);
 // Reset marks follow the scene value; any pending edit disables them (B17 R5–R9).
 const marks=$derived(entity?resetMarks(entity,view.pending||disabled||(view.livePending??false)):null);
 const expressions=$derived(entity?.kind==='avatar'&&expressionApi!==null&&onexpressionsettings!==undefined&&hasTriggerableExpressions(entity.assetId,assets));
 // The mesh list of the avatar model; no section without one (B26 R12).
 const avatarMeshes=$derived(entity?.kind==='avatar'&&entity.assetId!==null?assets.find(asset=>asset.id===entity.assetId)?.meshes??[]:[]);
 // B38 R29: the record materials and the saved values of a character or a prop.
 const materialRecord=$derived(entity?recordMaterials(entity,assets):undefined);
 const materialValues=$derived(entity?savedMaterials(entity):undefined);
 const sections=$derived(entity?sectionsFor(entity,{expressions,meshes:avatarMeshes.length>0,materials:showsMaterials(materialRecord,materialValues),debug:entity.kind==='avatar'&&entity.assetId!==null}):[]);
 // Debug R3: read again when the load list changes, because a finished load leaves that list.
 const avatarDebug=$derived.by(()=>{void loads;return entity?.kind==='avatar'&&entity.assetId!==null?modelInfo?.(entity.assetId)??null:null;});
 const storedExpressions=$derived(new Set(entity?.kind==='avatar'?Object.keys(entity.expressions??{}):[]));
 // The collapse state is per user in the Editor window storage, never in the show (R12).
 let sectionState=$state.raw<SectionState>(readSections());
 function readSections(){try{return parseSectionState(localStorage.getItem(SECTION_STORAGE_KEY));}catch{return parseSectionState(null);}}
 function saveSections(next:SectionState){sectionState=next;try{localStorage.setItem(SECTION_STORAGE_KEY,JSON.stringify(next));}catch{}}
 let panel=$state<HTMLElement>(),scroller=$state<HTMLElement|null>(null),indexed=$state(false),current=$state(0);
 let jumping=false,jumpTimer:ReturnType<typeof setTimeout>|undefined;
 const headings=()=>[...(panel?.querySelectorAll<HTMLElement>('.inspector-section')??[])];
 // The sticky index covers the top of the scroll area, so section tops and jumps start below it (R14, R16).
 const indexHeight=()=>panel?.querySelector<HTMLElement>('.inspector-index')?.offsetHeight??0;
 function follow(){
  if(!scroller||jumping)return;
  const top=scroller.getBoundingClientRect().top-scroller.scrollTop+indexHeight();
  current=Math.max(0,currentSection(headings().map(item=>item.getBoundingClientRect().top-top),scroller.scrollTop,scroller.clientHeight,scroller.scrollHeight));
 }
 function measure(){if(scroller)indexed=indexShows(sections.length,scroller.scrollHeight,scroller.clientHeight,indexHeight());follow();}
 // The index shows when the sections do not fit in the column (R13); it follows scroll and resize (R14).
 $effect(()=>{
  const column=panel?.closest<HTMLElement>('.properties-column')??null;
  scroller=column;
  if(!column||!panel)return;
  const resize=new ResizeObserver(()=>measure());
  resize.observe(column);
  resize.observe(panel);
  const scroll=()=>follow(),end=()=>{jumping=false;clearTimeout(jumpTimer);};
  column.addEventListener('scroll',scroll,{passive:true});
  column.addEventListener('scrollend',end);
  return()=>{resize.disconnect();column.removeEventListener('scroll',scroll);column.removeEventListener('scrollend',end);clearTimeout(jumpTimer);};
 });
 // A new selection starts at the top of the column (R17).
 let shownId:string|undefined;
 $effect(()=>{const id=entity?.id;if(id===shownId)return;shownId=id;if(scroller)scroller.scrollTop=0;jumping=false;void tick().then(measure);});
 // A section that a type change or an expressions load adds or removes moves the others without a scroll event.
 $effect(()=>{void sections.length;void tick().then(measure);});
 function toggle(id:string){if(!entity)return;saveSections(toggleSection(sectionState,entity.kind,id));void tick().then(follow);}
 async function jump(index:number){
  const section=sections[index];
  if(!entity||!section||!scroller)return;
  if(isCollapsed(sectionState,entity.kind,section.id))saveSections(setCollapsed(sectionState,entity.kind,section.id,false));
  await tick();
  const element=headings()[index],button=element?.querySelector<HTMLButtonElement>('.section-heading');
  if(!element||!button)return;
  const top=element.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-indexHeight();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The jumped section stays current after the scroll ends, also when the column cannot scroll that far (R16).
  jumping=true;current=index;clearTimeout(jumpTimer);jumpTimer=setTimeout(()=>{jumping=false;},1000);
  scroller.scrollTo({top,behavior:reduced?'instant':'smooth'});
  button.focus({preventScroll:true});
 }
</script>
<section class="editor-panel inspector" aria-labelledby="inspector-heading" bind:this={panel}>
 <div class="panel-heading"><h2 id="inspector-heading">Properties</h2><HelpButton topic={topicForKind(entity?.kind??null)}/></div>
 {#if entity && view.scene && marks}<h3>{entity.name}</h3>{#if entity.kind!=='tracking'&&entity.kind!=='vmcSender'}<div class="resettable"><label class="visibility-control"><input type="checkbox" checked={entity.visible} disabled={view.pending||disabled} onchange={async event=>{const box=event.currentTarget;const reply=await model.setVisibility(entity.id,box.checked,view.scene?.revision);settleCheckbox(box,reply,entity?.visible);}}/>Visible</label>{#if marks.changed.has('visible')}<ResetMark label="Visible" disabled={marks.disabled} onreset={()=>{void model.setVisibility(entity!.id,true,view.scene?.revision);}}/>{/if}</div>{/if}
 {@const scene=view.scene}
 {#snippet body(id:string)}
  {#if entity}{#if id==='transform'&&entity.kind!=='tracking'}<TransformFields entityId={entity.id} baseTransform={entity.transform} transform={draft?.entityId===entity.id?draft.transform:entity.transform} defaultScale={marks!.defaults.scale as [number,number,number]} revision={scene.revision} disabled={disabled||(view.pending&&!view.livePending)} committing={livePending||(view.livePending??false)} cancelKey={transformError??view.error} oncommit={(transform,revision)=>{if(onlivetransform)onlivetransform(entity!.id,transform);else void model.setTransform?.(entity!.id,transform,revision);}} oncancel={oncanceltransform} onfinish={onfinishtransform}/>
  {:else if entity.kind==='camera'}
   {#if id==='rendering'}{@const sky=entity.sky}<div class="field-stack"><div class="resettable"><label class="visibility-control"><input type="checkbox" checked={entity.renderEnvironment!==false} disabled={view.pending||disabled||!onrenderenvironment} onchange={async event=>{const box=event.currentTarget;const reply=await onrenderenvironment?.(entity!.id,box.checked,scene.revision);settleCheckbox(box,reply,entity?.kind==='camera'?entity.renderEnvironment!==false:undefined);}}/>Render Environment</label>{#if marks!.changed.has('renderEnvironment')}<ResetMark label="Render Environment" disabled={marks!.disabled||!onrenderenvironment} onreset={()=>{void onrenderenvironment?.(entity!.id,true,scene.revision);}}/>{/if}</div><div class="resettable"><Select label="Anti-aliasing" value={entity.antiAliasing??'none'} options={antiAliasingOptions} disabled={view.pending||disabled} onchange={async event=>{const select=event.currentTarget;const mode=CameraAntiAliasingSchema.safeParse(select.value);const reply=mode.success?await model.setCameraAntiAliasing(entity!.id,mode.data,view.scene?.revision):undefined;if(!reply?.ok&&entity?.kind==='camera')select.value=entity.antiAliasing??'none';}}/>{#if marks!.changed.has('antiAliasing')}<ResetMark label="Anti-aliasing" disabled={marks!.disabled} onreset={()=>{void model.setCameraAntiAliasing(entity!.id,'none',view.scene?.revision);}}/>{/if}</div><Select label="Sky" value={sky?.kind??'none'} options={skyKindOptions} disabled={view.pending||disabled} onchange={event=>{const kind=event.currentTarget.value;if(kind==='none'){void model.setCameraSky(entity!.id,{kind:'none'},view.scene?.revision);}else if(kind==='color'){void model.setCameraSky(entity!.id,{kind:'color',color:'#87ceeb'},view.scene?.revision);}else{void model.setCameraSky(entity!.id,{kind:kind as 'image'|'hdr',assetId:sky?.assetId??null},view.scene?.revision);}}}/>{#if sky&&sky.kind==='color'}<ColorField label="Sky Color" value={sky.color??'#87ceeb'} disabled={view.pending||disabled} oncommit={color=>{void model.setCameraSky(entity!.id,{...sky,color},view.scene?.revision);}} onlive={color=>{const id=entity!.id;live(id,revision=>model.setCameraSky(id,{...sky,color},revision));}} onliveend={onlivefieldend}/>{/if}{#if sky&&(sky.kind==='image'||sky.kind==='hdr')}<Button variant="secondary" disabled={view.pending||disabled} onclick={()=>onchoosehdr?.(entity!.id)}>{sky.assetId?'Change':'Choose'} {sky.kind==='hdr'?'HDR':'Image'}</Button>{/if}{#if sky&&sky.kind!=='none'}<SliderField label="Intensity" value={sky.intensity??1} range={{min:0,max:2,step:0.01}} disabled={view.pending||disabled} oncommit={v=>{void model.setCameraSky(entity!.id,{...sky,intensity:v},view.scene?.revision);}} onlive={v=>{const id=entity!.id;live(id,revision=>model.setCameraSky(id,{...sky,intensity:v},revision));}} onend={onlivefieldend}/>{/if}{#if sky&&(sky.kind==='image'||sky.kind==='hdr')}<SliderField label="Blurriness" value={sky.blurriness??0} range={{min:0,max:1,step:0.01}} disabled={view.pending||disabled} oncommit={v=>{void model.setCameraSky(entity!.id,{...sky,blurriness:v},view.scene?.revision);}} onlive={v=>{const id=entity!.id;live(id,revision=>model.setCameraSky(id,{...sky,blurriness:v},revision));}} onend={onlivefieldend}/>{/if}{#if sky&&sky.kind!=='none'}<label class="visibility-control"><input type="checkbox" checked={sky.ibl===true} disabled={view.pending||disabled} onchange={event=>{void model.setCameraSky(entity!.id,{...sky,ibl:event.currentTarget.checked},view.scene?.revision);}}/>IBL</label>{/if}</div>
   {:else if id==='grading'}<CameraGradingFields entityId={entity.id} grading={entity.grading} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,grading,revision)=>model.setCameraGrading(id,grading,revision)} onlive={(id,grading)=>live(id,revision=>model.setCameraGrading(id,grading,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='effects'}<CameraEffectsFields entityId={entity.id} effects={entity.effects} revision={scene.revision} marks={marks!} {assets} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={busy||livePending||disabled} oncommit={(id,effects,revision)=>model.setCameraEffects(id,effects,revision)} onlive={(id,effects)=>live(id,revision=>model.setCameraEffects(id,effects,revision,true))} onliveend={onlivefieldend} onimport={onchooseimage?()=>onchooseimage?.(entity!.id):undefined}/>
   {:else if id==='lens'}<CameraLensFields entityId={entity.id} lens={entity.lens} effects={entity.effects} navigation={entity.navigation} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={onlens} onlive={(id,lens)=>live(id,revision=>model.setCameraLens(id,lens,revision,true))} onliveend={onlivefieldend} onpreset={applyLensPresetResult}/>
   {:else if id==='control'}<CameraNavigationFields entityId={entity.id} navigation={entity.navigation} entities={scene.entities} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={onnavigation} onlive={(id,navigation)=>live(id,revision=>model.setCameraNavigation(id,navigation,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='screenshot'}<div class="screenshot-actions"><Button variant="secondary" disabled={shooting||disabled||!onscreenshot} onclick={()=>screenshot(entity!.id)}>Take Screenshot</Button><Button variant="ghost" disabled={!onopenscreenshots} onclick={openFolder}>Open Screenshots Folder</Button></div>{#if shot?.entityId===entity.id}<p class="screenshot-file">{shot.fileName}</p>{/if}{#if shotError}<p role="alert">{shotError}</p>{/if}{/if}
  {:else if entity.kind==='light'}<LightFields part={id==='affect'?'affect':id==='shadow'?'shadow':'light'} entityId={entity.id} light={entity.light} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,light,revision)=>model.setLight(id,light,revision)} onlive={(id,light)=>live(id,revision=>model.setLight(id,light,revision,true))} onliveend={onlivefieldend} ondirection={async (id,revision)=>{const transform=view.scene?directionFromMainCamera(view.scene,id):null;return transform?model.setTransform?.(id,transform,revision):undefined;}}/>
  {:else if entity.kind==='haze'}<HazeFields entityId={entity.id} haze={entity.haze} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,haze,revision)=>model.setHaze(id,haze,revision)} onlive={(id,haze)=>live(id,revision=>model.setHaze(id,haze,revision,true))} onliveend={onlivefieldend}/>
  {:else if entity.kind==='snow'}<SnowFields entityId={entity.id} snow={entity.snow} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,snow,revision)=>model.setSnow(id,snow,revision)} onlive={(id,snow)=>live(id,revision=>model.setSnow(id,snow,revision,true))} onliveend={onlivefieldend}/>
  {:else if entity.kind==='fpsCounter'}<FpsCounterFields entityId={entity.id} fpsCounter={entity.fpsCounter} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,fpsCounter,revision)=>model.setFpsCounter(id,fpsCounter,revision)} onlive={(id,fpsCounter)=>live(id,revision=>model.setFpsCounter(id,fpsCounter,revision,true))} onliveend={onlivefieldend}/>
  {:else if entity.kind==='vmcSender'}<VmcSenderFields marks={marks!} entityId={entity.id} settings={entity.vmcSender} entities={scene.entities} revision={scene.revision} disabled={view.pending||disabled} status={senderStatus(vmcSenders,entity.id)} oncommit={(id,settings,revision)=>model.setVmcSender(id,settings,revision)}/>
  {:else if entity.kind==='environment'}<SceneModelFields marks={marks!} assetId={entity.assetId} reflectionsIntensity={entity.reflectionsIntensity??1} reflectionsDisabled={busy||disabled} onreflections={value=>model.setEnvironmentReflections(entity!.id,value,view.scene?.revision)} onreflectionslive={value=>{const id=entity!.id;live(id,revision=>model.setEnvironmentReflections(id,value,revision,true));}} onliveend={onlivefieldend} allowLightsToAffectCharacters={entity.allowLightsToAffectCharacters===true} onlighting={value=>{void model.setEnvironmentLighting(entity!.id,value,view.scene?.revision);}} {assets} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={view.pending||livePending||disabled||!onchoosescene} onselect={assetId=>onpickscene?.(entity!.id,assetId)} onimport={()=>onchoosescene?.(entity!.id)}/>
  {:else if entity.kind==='mesh'&&entity.source.kind==='asset'}{#if id==='materials'}{@render materials(entity.id)}{:else}<SceneModelFields marks={marks!} assetId={entity.source.assetId} {assets} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={view.pending||livePending||disabled||!onchoosescene} onselect={assetId=>onpickscene?.(entity!.id,assetId)} onimport={()=>onchoosescene?.(entity!.id)}/>{/if}
  {:else if entity.kind==='screen'}<div class="field-stack"><ScreenContentField marks={marks!} content={contentKind(entity.content)} options={contentOptions(contentKind(entity.content),scene.entities).map(option=>option.value==='display'||option.value==='window'?{...option,disabled:option.disabled||!captureCommands}:option)} disabled={view.pending||livePending||disabled} onchange={content=>{const id=entity!.id;if(content==='video')void model.setScreenVideo(id,{...VIDEO_DEFAULTS},view.scene?.revision);else if(content==='web')void model.setScreenWeb(id,DEFAULT_WEB_SCREEN,view.scene?.revision);else if(content==='display'||content==='window')void model.setScreenCapture(id,startCapture(content),view.scene?.revision);else void model.setScreenImage(id,null,view.scene?.revision);}}/>
   {#if entity.content.kind==='video'}<ScreenVideoFields marks={marks!} video={screenVideo(entity)} {assets} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={busy||livePending||disabled} sourceDisabled={view.pending||!onchoosevideo} playLabel={playLabel(playback,entity.id)} onchange={video=>model.setScreenVideo(entity!.id,video,view.scene?.revision)} onlive={video=>{const id=entity!.id;live(id,revision=>model.setScreenVideo(id,video,revision,true));}} onliveend={onlivefieldend} oncontrol={action=>{void model.controlScreenVideo(entity!.id,action);}} onimport={()=>onchoosevideo?.(entity!.id)}/>
   {:else if entity.content.kind==='capture'}{#if captureCommands}<ScreenCaptureFields marks={marks!} capture={{target:entity.content.target,source:entity.content.source,cursor:entity.content.cursor}} hostState={captureState(entity.id,captureStatus)} message={captureMessage(entity.id,previewWarnings(captureStatus))} commands={captureCommands} disabled={view.pending||livePending||disabled} oncommit={next=>model.setScreenCapture(entity!.id,next,view.scene?.revision)}/>{/if}
   {:else if entity.content.kind==='web'}<ScreenWebFields marks={marks!} entityId={entity.id} web={entity.content} revision={scene.revision} disabled={view.pending||livePending||disabled} oncommit={next=>model.setScreenWeb(entity!.id,{url:next.url,width:next.width,height:next.height,onTop:next.onTop},view.scene?.revision)}/>
   {:else}<ScreenImageFields marks={marks!} assetId={entity.content.assetId} {assets} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={view.pending||livePending||disabled||!onchooseimage} onselect={assetId=>onpickimage?.(entity!.id,assetId)} onimport={()=>onchooseimage?.(entity!.id)}/>{/if}</div>
  {:else if entity.kind==='avatar'}
   {#if id==='model'}<AvatarModelField label={modelLabel(entity.assetId,assets)} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} disabled={view.pending||livePending||disabled||!onchoosemodel} onchoose={()=>onchoosemodel?.(entity!.id)}/>
   {:else if id==='expressions'&&expressionApi&&onexpressionsettings}<AvatarExpressionFields avatarId={entity.id} revision={scene.revision} api={expressionApi} stored={storedExpressions} disabled={busy||livePending||disabled} onsettings={onexpressionsettings} onsettingslive={(id,name,settings)=>live(id,revision=>model.setAvatarExpression(id,name,settings,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='materials'}{@render materials(entity.id)}
   {:else if id==='meshes'}<AvatarMeshFields meshes={avatarMeshes} hidden={entity.hiddenMeshes} disabled={view.pending||livePending||disabled} oncommit={hidden=>model.setHiddenMeshes(entity!.id,hidden,view.scene?.revision)}/>
   {:else if id==='lighting'}<AvatarLightingFields entityId={entity.id} lighting={entity.lighting} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,lighting,revision)=>model.setAvatarLighting(id,lighting,revision)} onlive={(id,lighting)=>live(id,revision=>model.setAvatarLighting(id,lighting,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='debug'}<AvatarDebugFields debug={avatarDebug} record={assets.find(asset=>asset.id===entity!.assetId)??null}/>
   {:else if id==='animation'}<AvatarAnimationFields entityId={entity.id} animation={entity.animation} revision={scene.revision} animations={animationAssets} disabled={view.pending||livePending||disabled} oncommit={(id,next,revision)=>model.setAvatarAnimation(id,next,revision)}/>
   {:else if id==='tracking'}<AvatarSourceFields marks={marks!} entityId={entity.id} tracking={entity.tracking} idleAnimation={entity.idleAnimation} onidle={onavataridle} entities={scene.entities} revision={scene.revision} disabled={view.pending||livePending||disabled} oncommit={onavatartracking} {onguide} animations={animationAssets} {onchooseanimation}/>{/if}
  {:else if entity.kind==='tracking'}
   {#if id==='receiver'}<TrackingSourceFields marks={marks!} entityId={entity.id} config={entity.config} generation={entity.generation} revision={scene.revision} disabled={view.pending||disabled} oncommit={ontrackingconfig} ontoggle={ontrackingtoggle} statuses={trackingStatus} {localAddresses} {devices} calibrated={entity.calibration!==undefined} oncalibrate={ontrackingcalibrate} onresetcalibration={ontrackingcalibrationreset} {faceKit} unused={sourceUsers(scene,entity.id).length===0}/>
   {:else if id==='smoothing'}<TrackingSmoothingFields entityId={entity.id} smoothing={entity.smoothing} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={ontrackingsmoothing} onlive={(id,smoothing)=>live(id,revision=>model.setTrackingSmoothing(id,smoothing,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='face'}<TrackingMappingFields entityId={entity.id} mapping={entity.mapping} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={ontrackingmapping}/>
   {:else if id==='diagnostics'}<TrackingDiagnostics kind={entity.config.kind} generation={entity.generation} status={matchingStatus(trackingStatus,entity.id,entity.generation)}/>{/if}
  {/if}{/if}
 {/snippet}
 {#snippet materials(entityId:string)}{#key entityId}<MaterialFields {entityId} record={materialRecord} saved={materialValues} revision={scene.revision} disabled={busy||disabled} resetDisabled={marks!.disabled} oncommit={(id,materials,revision)=>model.setMaterialValues(id,materials,revision)} onlive={(id,materials)=>live(id,revision=>model.setMaterialValues(id,materials,revision,true))} onliveend={onlivefieldend}/>{/key}{/snippet}
 <div class="inspector-layout">
  {#if indexed}<InspectorIndex {sections} {current} onjump={jump}/>{/if}
  <div class="inspector-sections">{#each sections as section (section.id)}<InspectorSection id={section.id} label={section.label} collapsed={isCollapsed(sectionState,entity.kind,section.id)} ontoggle={()=>toggle(section.id)}>{@render body(section.id)}</InspectorSection>{/each}</div>
 </div>
 {:else}
  <EmptyState message="Select an asset from Assets to view or edit its properties."/>
 {/if}
 {#if view.error}<p role="alert">{view.errorMessage??(view.error==='CONFLICT'?'Scene changed. Review values and retry.':view.error)}</p>{/if}
</section>
<style>.screenshot-actions{display:flex;flex-wrap:wrap;gap:8px}.screenshot-file{margin:6px 0 0;font-size:12px;color:var(--ds-color-text-muted);overflow-wrap:anywhere}.field-stack{display:grid;gap:10px}</style>
