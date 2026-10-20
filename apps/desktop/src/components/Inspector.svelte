<script lang="ts">
 import type { Transform, Reply, AssetRecord, ExpressionSettings } from '@opensekai/contracts';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {modelLabel} from '../editor/authoring';
 import AvatarModelField from './AvatarModelField.svelte';
 import AvatarExpressionFields,{type ExpressionApi} from './AvatarExpressionFields.svelte';
 import {hasTriggerableExpressions} from '../editor/expressions';
 import type { EditorPanelProps } from '../editor/model';
 import {antiAliasingOptions,matchingStatus,type LivePropertyCallbacks} from '../editor/live-fields';
 import { Select } from '@oshi-connect/ui';
 import { CameraAntiAliasingSchema } from '@opensekai/contracts';
 import CameraLensFields from './CameraLensFields.svelte';
 import CameraNavigationFields from './CameraNavigationFields.svelte';
 import { Button } from '@oshi-connect/ui';
 import type { CameraNavigation, CameraScreenshotResult } from '@opensekai/contracts';
 import EnvironmentFields from './EnvironmentFields.svelte';
 import LightFields from './LightFields.svelte';
 import HazeFields from './HazeFields.svelte';
 import {directionFromMainCamera} from '../editor/lights';
 import type {LiveRequest} from '../editor/live-edit';
 import AvatarSourceFields from './AvatarSourceFields.svelte';
 import TrackingDiagnostics from './TrackingDiagnostics.svelte';
 import TrackingSmoothingFields from './TrackingSmoothingFields.svelte';
 import TrackingMappingFields from './TrackingMappingFields.svelte';
 import InspectorSection from './InspectorSection.svelte';
 import InspectorIndex from './InspectorIndex.svelte';
 import ResetMark from './ResetMark.svelte';
 import {tick} from 'svelte';
 import {resetMarks} from '../editor/property-defaults';
 import {currentSection,isCollapsed,parseSectionState,sectionsFor,SECTION_STORAGE_KEY,toggleSection,setCollapsed,type SectionState} from '../editor/inspector-sections';
 import TrackingSourceFields from './TrackingSourceFields.svelte';
 import TransformFields from './TransformFields.svelte';
 type Props=LivePropertyCallbacks&Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};onlivefield?:(request:LiveRequest)=>void;onlivefieldend?:()=>void;draft?:{entityId:string;transform:Transform}|null;ondraft?:(draft:{entityId:string;transform:Transform}|null)=>void;disabled?:boolean;onlivetransform?:(id:string,transform:Transform)=>void;oncanceltransform?:()=>void;onfinishtransform?:()=>void;transformError?:string|null;livePending?:boolean;assets?:AssetRecord[];loads?:AssetLoadStatus[];importingId?:string|null;onchoosemodel?:(id:string)=>void;importError?:{entityId:string;message:string}|null;onchoosescene?:(id:string)=>void;onpickscene?:(id:string,assetId:string|null)=>void;onrenderenvironment?:(id:string,value:boolean,revision:number)=>Promise<Reply<unknown>|undefined>;expressionApi?:ExpressionApi|null;onexpressionsettings?:(id:string,name:string,settings:ExpressionSettings|null,revision:number)=>Promise<unknown>;onnavigation?:(id:string,navigation:CameraNavigation,revision:number)=>Promise<Reply<unknown>|undefined>;onscreenshot?:(id:string)=>Promise<Reply<CameraScreenshotResult>|undefined>;onopenscreenshots?:()=>Promise<void>};
 let {model,view,onlivefield,onlivefieldend,draft=null,ondraft,disabled=false,onlivetransform,oncanceltransform,onfinishtransform,transformError=null,livePending=false,assets=[],loads=[],importingId=null,importError=null,onchoosemodel,onchoosescene,onpickscene,onrenderenvironment,expressionApi=null,onexpressionsettings,onnavigation,onscreenshot,onopenscreenshots,onlens,onavatartracking,onavataridle,ontrackingconfig,ontrackingsmoothing,ontrackingmapping,ontrackingcalibrate,ontrackingcalibrationreset,ontrackingtoggle,trackingStatus=[],localAddresses=[],devices=[]}:Props=$props();
 const entity=$derived(view.scene?.entities.find(item=>item.id===view.selectedId));
 // A live slider or color edit keeps its fields enabled; any other pending edit disables them (B12 R14).
 const busy=$derived(view.pending&&!view.livePending);
 const live=(entityId:string,send:LiveRequest['send'])=>onlivefield?.({entityId,send});
 // A rejected change leaves the scene value as it was, so Svelte does not reset the box; put the scene value back.
 const settle=(box:HTMLInputElement,reply:Reply<unknown>|undefined,current:boolean|undefined)=>{if(!reply?.ok&&current!==undefined)box.checked=current;};
 let shooting=$state(false),shot=$state<{entityId:string;fileName:string}|null>(null),shotError=$state<string|null>(null);
 async function screenshot(id:string){shooting=true;shotError=null;try{const reply=await onscreenshot?.(id);if(reply?.ok)shot={entityId:id,fileName:reply.data.fileName};else if(reply)shotError=reply.error.code;}finally{shooting=false;}}
 async function openFolder(){shotError=null;try{await onopenscreenshots?.();}catch{shotError='Could not open folder';}}
 // Reset marks follow the scene value; any pending edit disables them (B17 R5–R9).
 const marks=$derived(entity?resetMarks(entity,view.pending||disabled||(view.livePending??false)):null);
 const expressions=$derived(entity?.kind==='avatar'&&expressionApi!==null&&onexpressionsettings!==undefined&&hasTriggerableExpressions(entity.assetId,assets));
 const sections=$derived(entity?sectionsFor(entity,{expressions}):[]);
 const storedExpressions=$derived(new Set(entity?.kind==='avatar'?Object.keys(entity.expressions??{}):[]));
 // The collapse state is per user in the Editor window storage, never in the show (R12).
 let sectionState=$state.raw<SectionState>(readSections());
 function readSections(){try{return parseSectionState(localStorage.getItem(SECTION_STORAGE_KEY));}catch{return parseSectionState(null);}}
 function saveSections(next:SectionState){sectionState=next;try{localStorage.setItem(SECTION_STORAGE_KEY,JSON.stringify(next));}catch{}}
 let panel=$state<HTMLElement>(),scroller=$state<HTMLElement|null>(null),wide=$state(false),current=$state(0);
 let jumping=false,jumpTimer:ReturnType<typeof setTimeout>|undefined;
 const indexed=$derived(wide&&sections.length>=2);
 const headings=()=>[...(panel?.querySelectorAll<HTMLElement>('.inspector-section')??[])];
 function follow(){
  if(!scroller||jumping)return;
  const top=scroller.getBoundingClientRect().top-scroller.scrollTop;
  current=Math.max(0,currentSection(headings().map(item=>item.getBoundingClientRect().top-top),scroller.scrollTop,scroller.clientHeight,scroller.scrollHeight));
 }
 // The index shows when the properties column is at least 520 px wide (R13); it follows scroll and resize (R14).
 $effect(()=>{
  const column=panel?.closest<HTMLElement>('.properties-column')??null;
  scroller=column;
  if(!column)return;
  const resize=new ResizeObserver(()=>{wide=column.clientWidth>=520;follow();});
  resize.observe(column);
  const scroll=()=>follow(),end=()=>{jumping=false;clearTimeout(jumpTimer);};
  column.addEventListener('scroll',scroll,{passive:true});
  column.addEventListener('scrollend',end);
  return()=>{resize.disconnect();column.removeEventListener('scroll',scroll);column.removeEventListener('scrollend',end);clearTimeout(jumpTimer);};
 });
 // A new selection starts at the top of the column (R17).
 let shownId:string|undefined;
 $effect(()=>{const id=entity?.id;if(id===shownId)return;shownId=id;if(scroller)scroller.scrollTop=0;jumping=false;void tick().then(follow);});
 // A section that a type change or an expressions load adds or removes moves the others without a scroll event.
 $effect(()=>{void sections.length;void tick().then(follow);});
 function toggle(id:string){if(!entity)return;saveSections(toggleSection(sectionState,entity.kind,id));void tick().then(follow);}
 async function jump(index:number){
  const section=sections[index];
  if(!entity||!section||!scroller)return;
  if(isCollapsed(sectionState,entity.kind,section.id))saveSections(setCollapsed(sectionState,entity.kind,section.id,false));
  await tick();
  const element=headings()[index],button=element?.querySelector<HTMLButtonElement>('.section-heading');
  if(!element||!button)return;
  const top=element.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The jumped section stays current after the scroll ends, also when the column cannot scroll that far (R16).
  jumping=true;current=index;clearTimeout(jumpTimer);jumpTimer=setTimeout(()=>{jumping=false;},1000);
  scroller.scrollTo({top,behavior:reduced?'instant':'smooth'});
  button.focus({preventScroll:true});
 }
</script>
<section class="editor-panel inspector" aria-labelledby="inspector-heading" bind:this={panel}>
 <h2 id="inspector-heading">Properties</h2>
 {#if entity && view.scene && marks}<h3>{entity.name}</h3>{#if entity.kind!=='tracking'}<div class="resettable"><label class="visibility-control"><input type="checkbox" checked={entity.visible} disabled={view.pending||disabled} onchange={async event=>{const box=event.currentTarget;const reply=await model.setVisibility(entity.id,box.checked,view.scene?.revision);settle(box,reply,entity?.visible);}}/>Visible</label>{#if marks.changed.has('visible')}<ResetMark label="Visible" disabled={marks.disabled} onreset={()=>{void model.setVisibility(entity!.id,true,view.scene?.revision);}}/>{/if}</div>{/if}
 {@const scene=view.scene}
 {#snippet body(id:string)}
  {#if entity}{#if id==='transform'&&entity.kind!=='tracking'}<TransformFields entityId={entity.id} baseTransform={entity.transform} transform={draft?.entityId===entity.id?draft.transform:entity.transform} defaultScale={marks!.defaults.scale as [number,number,number]} revision={scene.revision} disabled={disabled||(view.pending&&!view.livePending)} committing={livePending||(view.livePending??false)} cancelKey={transformError??view.error} oncommit={(transform,revision)=>{if(onlivetransform)onlivetransform(entity!.id,transform);else void model.setTransform?.(entity!.id,transform,revision);}} oncancel={oncanceltransform} onfinish={onfinishtransform}/>
  {:else if entity.kind==='camera'}
   {#if id==='rendering'}<div class="field-stack"><div class="resettable"><label class="visibility-control"><input type="checkbox" checked={entity.renderEnvironment!==false} disabled={view.pending||disabled||!onrenderenvironment} onchange={async event=>{const box=event.currentTarget;const reply=await onrenderenvironment?.(entity!.id,box.checked,scene.revision);settle(box,reply,entity?.kind==='camera'?entity.renderEnvironment!==false:undefined);}}/>Render Environment</label>{#if marks!.changed.has('renderEnvironment')}<ResetMark label="Render Environment" disabled={marks!.disabled||!onrenderenvironment} onreset={()=>{void onrenderenvironment?.(entity!.id,true,scene.revision);}}/>{/if}</div><div class="resettable"><Select label="Anti-aliasing" value={entity.antiAliasing??'none'} options={antiAliasingOptions} disabled={view.pending||disabled} onchange={async event=>{const select=event.currentTarget;const mode=CameraAntiAliasingSchema.safeParse(select.value);const reply=mode.success?await model.setCameraAntiAliasing(entity!.id,mode.data,view.scene?.revision):undefined;if(!reply?.ok&&entity?.kind==='camera')select.value=entity.antiAliasing??'none';}}/>{#if marks!.changed.has('antiAliasing')}<ResetMark label="Anti-aliasing" disabled={marks!.disabled} onreset={()=>{void model.setCameraAntiAliasing(entity!.id,'none',view.scene?.revision);}}/>{/if}</div></div>
   {:else if id==='lens'}<CameraLensFields entityId={entity.id} lens={entity.lens} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={onlens} onlive={(id,lens)=>live(id,revision=>model.setCameraLens(id,lens,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='control'}<CameraNavigationFields entityId={entity.id} navigation={entity.navigation} entities={scene.entities} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={onnavigation} onlive={(id,navigation)=>live(id,revision=>model.setCameraNavigation(id,navigation,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='screenshot'}<div class="screenshot-actions"><Button variant="secondary" disabled={shooting||disabled||!onscreenshot} onclick={()=>screenshot(entity!.id)}>Take Screenshot</Button><Button variant="ghost" disabled={!onopenscreenshots} onclick={openFolder}>Open Screenshots Folder</Button></div>{#if shot?.entityId===entity.id}<p class="screenshot-file">{shot.fileName}</p>{/if}{#if shotError}<p role="alert">{shotError}</p>{/if}{/if}
  {:else if entity.kind==='light'}<LightFields part={id==='affect'?'affect':id==='shadow'?'shadow':'light'} entityId={entity.id} light={entity.light} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,light,revision)=>model.setLight(id,light,revision)} onlive={(id,light)=>live(id,revision=>model.setLight(id,light,revision,true))} onliveend={onlivefieldend} ondirection={async (id,revision)=>{const transform=view.scene?directionFromMainCamera(view.scene,id):null;return transform?model.setTransform?.(id,transform,revision):undefined;}}/>
  {:else if entity.kind==='haze'}<HazeFields entityId={entity.id} haze={entity.haze} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={(id,haze,revision)=>model.setHaze(id,haze,revision)} onlive={(id,haze)=>live(id,revision=>model.setHaze(id,haze,revision,true))} onliveend={onlivefieldend}/>
  {:else if entity.kind==='environment'}<EnvironmentFields marks={marks!} assetId={entity.assetId} reflectionsIntensity={entity.reflectionsIntensity??1} reflectionsDisabled={busy||disabled} onreflections={value=>model.setEnvironmentReflections(entity!.id,value,view.scene?.revision)} onreflectionslive={value=>{const id=entity!.id;live(id,revision=>model.setEnvironmentReflections(id,value,revision,true));}} onliveend={onlivefieldend} {assets} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} error={importError?.entityId===entity.id?importError.message:null} disabled={view.pending||livePending||disabled||!onchoosescene} onselect={assetId=>onpickscene?.(entity!.id,assetId)} onimport={()=>onchoosescene?.(entity!.id)}/>
  {:else if entity.kind==='avatar'}
   {#if id==='model'}<AvatarModelField label={modelLabel(entity.assetId,assets)} status={loads.find(load=>load.entityId===entity!.id)??null} importing={importingId===entity.id} disabled={view.pending||livePending||disabled||!onchoosemodel} onchoose={()=>onchoosemodel?.(entity!.id)}/>
   {:else if id==='expressions'&&expressionApi&&onexpressionsettings}<AvatarExpressionFields avatarId={entity.id} revision={scene.revision} api={expressionApi} stored={storedExpressions} disabled={busy||livePending||disabled} onsettings={onexpressionsettings} onsettingslive={(id,name,settings)=>live(id,revision=>model.setAvatarExpression(id,name,settings,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='tracking'}<AvatarSourceFields marks={marks!} entityId={entity.id} tracking={entity.tracking} idleAnimation={entity.idleAnimation} onidle={onavataridle} entities={scene.entities} revision={scene.revision} disabled={view.pending||livePending||disabled} oncommit={onavatartracking}/>{/if}
  {:else if entity.kind==='tracking'}
   {#if id==='receiver'}<TrackingSourceFields marks={marks!} entityId={entity.id} config={entity.config} generation={entity.generation} revision={scene.revision} disabled={view.pending||disabled} oncommit={ontrackingconfig} ontoggle={ontrackingtoggle} statuses={trackingStatus} {localAddresses} {devices} calibrated={entity.calibration!==undefined} oncalibrate={ontrackingcalibrate} onresetcalibration={ontrackingcalibrationreset}/>
   {:else if id==='smoothing'}<TrackingSmoothingFields entityId={entity.id} smoothing={entity.smoothing} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={ontrackingsmoothing} onlive={(id,smoothing)=>live(id,revision=>model.setTrackingSmoothing(id,smoothing,revision,true))} onliveend={onlivefieldend}/>
   {:else if id==='face'}<TrackingMappingFields entityId={entity.id} mapping={entity.mapping} revision={scene.revision} marks={marks!} disabled={busy||disabled} oncommit={ontrackingmapping}/>
   {:else if id==='diagnostics'}<TrackingDiagnostics kind={entity.config.kind} generation={entity.generation} status={matchingStatus(trackingStatus,entity.id,entity.generation)}/>{/if}
  {/if}{/if}
 {/snippet}
 <div class="inspector-layout" class:indexed>
  {#if indexed}<InspectorIndex {sections} {current} onjump={jump}/>{/if}
  <div class="inspector-sections">{#each sections as section (section.id)}<InspectorSection id={section.id} label={section.label} collapsed={isCollapsed(sectionState,entity.kind,section.id)} ontoggle={()=>toggle(section.id)}>{@render body(section.id)}</InspectorSection>{/each}</div>
 </div>
 {/if}
 {#if view.error}<p role="alert">{view.error==='CONFLICT'?'Scene changed. Review values and retry.':view.error}</p>{/if}
</section>
<style>.screenshot-actions{display:flex;flex-wrap:wrap;gap:8px}.screenshot-file{margin:6px 0 0;font-size:12px;color:#6b6575;overflow-wrap:anywhere}.field-stack{display:grid;gap:10px}</style>
