<script lang="ts">
 import {tick} from 'svelte';
 import { Button, Input, Spinner } from '@oshi-connect/ui';
 import { Camera, User, Box, Search, Radio, Eye, EyeOff, ChevronRight, ChevronDown, Video, Plus, Mountain, Sun, Lightbulb, Spotlight, SunDim, CloudFog, Gauge, Send } from '@lucide/svelte';
 import type { Transform, Reply } from '@opensekai/contracts';
 import type {AddKind} from '../editor/live-fields';
 import type { EditorPanelProps } from '../editor/model';
 import {groupEntities} from '../editor/asset-groups';
 import {cameraLimitReached} from '../editor/cameras';
 import {fpsCounterLimitReached,hazeLimitReached,lightLimitReached} from '../editor/lights';
 import {copyTransform} from '../editor/interaction';
 import {vmcSenderLimitReached} from '../editor/vmc-sender';
 import {addLimitReached} from '../editor/authoring';
 import ContextMenu, {type MenuAction} from './ContextMenu.svelte';
 type Tool='translate'|'rotate'|'scale';
 type Props=Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};onselect?:(id:string|null)=>void;ontool?:(tool:Tool)=>void;disabled?:boolean;onadd?:(kind:AddKind,revision:number)=>Promise<unknown>;loading?:ReadonlySet<string>;ontrackingtoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>};
 let {model,view,onselect,ontool,disabled=false,onadd,loading=new Set(),ontrackingtoggle}:Props=$props();let search=$state('');let menu=$state<{x:number;y:number;actions:MenuAction[]}|null>(null);
 let renaming=$state<{id:string;name:string;revision:number}|null>(null),renamePending=$state(false);
 let collapsed=$state<Record<string,boolean>>({});
 const groups=$derived(groupEntities(view.scene?.entities??[],search));
 const searching=$derived(search.trim().length>0);
 const activeCamera=$derived(view.scene?.outputs.find(output=>output.id==='output_main')?.cameraId);
 function select(id:string){model.select(id);onselect?.(id);}
 function navigate(event:KeyboardEvent){
  const target=event.target as HTMLElement;
  if(!target.closest('button[data-asset-id]'))return;
  const buttons=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[data-asset-id]'));
  const index=buttons.findIndex(button=>button===target.closest('button[data-asset-id]'));
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?Math.min(index+1,buttons.length-1):event.key==='ArrowUp'?Math.max(index-1,0):-1;
  if(next<0||!buttons[next])return;
  event.preventDefault();select(buttons[next].dataset.assetId!);buttons[next].focus();
 }
 function visibility(id:string){const scene=view.scene,entity=scene?.entities.find(item=>item.id===id);if(!scene||!entity||disabled||view.pending)return;void model.setVisibility(id,!entity.visible,scene.revision);}
 function activateCamera(id:string){if(!view.scene||disabled||view.pending)return;void model.selectCamera(id,view.scene.revision);}
 async function beginRename(id:string,revision:number){
  const entity=view.scene?.entities.find(item=>item.id===id);if(!entity)return;
  renaming={id,name:entity.name,revision};await tick();
  const input=document.querySelector<HTMLInputElement>('.asset-rename input');input?.focus();input?.select();
 }
 async function finishRename(){
  if(!renaming||renamePending||view.pending||disabled)return;
  const draft={...renaming};renamePending=true;
  try{const reply=await model.renameEntity(draft.id,draft.name,draft.revision);if(reply.ok)renaming=null;}finally{renamePending=false;}
 }
 function renameKeys(event:KeyboardEvent){event.stopPropagation();if(event.key==='Escape'){event.preventDefault();if(!renamePending)renaming=null;}else if(event.key==='Enter'){event.preventDefault();void finishRename();}}
 async function duplicate(id:string,revision:number){const reply=await model.duplicateEntity(id,crypto.randomUUID(),revision);if(reply.ok)onselect?.(model.read().selectedId);}
 async function remove(id:string,revision:number){const reply=await model.removeEntity(id,revision);if(reply.ok)onselect?.(model.read().selectedId);}
 function context(event:MouseEvent,id:string){
  event.preventDefault();select(id);const scene=view.scene,entity=scene?.entities.find(e=>e.id===id),revision=scene?.revision;
  if(!entity||revision===undefined)return;
  const current=()=>view.scene?.revision===revision&&!view.pending&&!disabled;
  const action=(label:string,run:()=>void):MenuAction=>({label,disabled:disabled||view.pending,run:()=>{if(current())run();}});
  const typeActions=entity.kind==='tracking'
   ?[ {...action(entity.config.enabled?'Stop':'Start',()=>{void ontrackingtoggle?.(id,!entity.config.enabled,revision);}),disabled:disabled||view.pending||!ontrackingtoggle} ]
   :entity.kind==='vmcSender'?[action(entity.vmcSender.enabled?'Stop':'Start',()=>{void model.setVmcSender(id,{...entity.vmcSender,enabled:!entity.vmcSender.enabled},revision);})]
   :[...(ontool?(['translate','rotate','scale'] as Tool[]).map((tool,i)=>action(['Move','Rotate','Scale'][i],()=>ontool?.(tool))):[]),action(entity.visible?'Hide':'Show',()=>{void model.setVisibility(id,!entity.visible,revision);}),...(['position','rotation','scale'] as const).map(row=>action(`Reset ${row}`,()=>{void model.setTransform?.(id,{...copyTransform(entity.transform),[row]:row==='rotation'?[0,0,0,1]:row==='scale'?[1,1,1]:[0,0,0]},revision);})),...(entity.kind==='camera'?[action('Use as output camera',()=>{void model.selectCamera(id,revision);})]:[])];
  const referenced=scene!.outputs.some(output=>output.cameraId===id);
  const budgetFull=scene!.entities.length>=64||(entity.kind==='avatar'&&scene!.entities.filter(item=>item.kind==='avatar').length>=2)||entity.kind==='environment'||(entity.kind==='camera'&&cameraLimitReached(scene!.entities))||(entity.kind==='light'&&(lightLimitReached(scene!.entities)||(entity.light.shadow.enabled&&scene!.entities.filter(item=>item.kind==='light'&&item.light.shadow.enabled).length>=2)))||(entity.kind==='tracking'&&scene!.entities.filter(item=>item.kind==='tracking').length>=4)||(entity.kind==='haze'&&hazeLimitReached(scene!.entities))||(entity.kind==='fpsCounter'&&fpsCounterLimitReached(scene!.entities))||(entity.kind==='vmcSender'&&vmcSenderLimitReached(scene!.entities));
  menu={x:event.clientX,y:event.clientY,actions:[...typeActions,action('Rename',()=>{void beginRename(id,revision);}),{...action('Duplicate',()=>{void duplicate(id,revision);}),disabled:disabled||view.pending||budgetFull,title:budgetFull?'Scene asset limit reached':undefined},{...action('Remove',()=>{void remove(id,revision);}),disabled:disabled||view.pending||referenced,title:referenced?'Choose another output camera before removal':undefined}]};
 }

</script>
<section class="editor-panel hierarchy" aria-labelledby="hierarchy-heading"><div class="asset-heading"><h2 id="hierarchy-heading">Assets</h2><div class="asset-actions"><Button variant="ghost" disabled={disabled||view.pending||!view.scene||!onadd} onclick={event=>{const revision=view.scene?.revision;if(revision===undefined)return;menu={x:event.currentTarget.getBoundingClientRect().left,y:event.currentTarget.getBoundingClientRect().bottom,actions:([['camera','Camera'],['character','Character'],['environment','Environment'],['prop','Prop'],['directionalLight','Directional Light'],['pointLight','Point Light'],['spotLight','Spot Light'],['ambientLight','Ambient Light'],['haze','Haze'],['fpsCounter','FPS Counter'],['vmc','VMC Receiver'],['vmcSender','VMC Sender'],['ifacialmocap','iFacialMocap Receiver'],['openseeface','OpenSeeFace Receiver'],['mediapipe','MediaPipe Tracker']] as [AddKind,string][]).map(([kind,label])=>{const full=addLimitReached(kind,view.scene?.entities??[]);return {label,disabled:full,title:full?'Scene asset limit reached':undefined,run:()=>{if(view.scene?.revision===revision&&!view.pending&&!disabled)void onadd?.(kind,revision);}};})};}} title="Add asset"><Plus size={14}/></Button></div></div><div class="asset-search"><Search size={14}/><Input label="Search assets" placeholder="Search" bind:value={search}/></div>
 <div class="entity-list" role="toolbar" aria-label="Scene assets" tabindex="0" onkeydown={navigate}>
  {#each groups as group (group.key)}
   <div class="asset-group">
    <button type="button" class="group-heading" aria-expanded={searching||!collapsed[group.key]} onclick={()=>{collapsed={...collapsed,[group.key]:!collapsed[group.key]};}}>
     {#if searching||!collapsed[group.key]}<ChevronDown size={13}/>{:else}<ChevronRight size={13}/>{/if}<span>{group.label}</span>
    </button>
    {#if searching||!collapsed[group.key]}
     {#each group.entities as entity (entity.id)}
      <div class="asset-row" oncontextmenu={event=>context(event,entity.id)} role="presentation">
       {#if renaming?.id===entity.id}
        <div class="asset-rename" onfocusout={()=>{if(!renamePending)renaming=null;}}><Input label="Asset name" onkeydown={renameKeys} bind:value={renaming.name} disabled={renamePending||disabled||view.pending}/></div>
       {:else}<button type="button" data-asset-id={entity.id} class={`entity-row${view.selectedId===entity.id?' selected':''}${entity.visible?'':' hidden-asset'}`} onclick={()=>select(entity.id)}>
        {#if loading.has(entity.id)}<Spinner size="sm" variant="muted" aria-hidden="true"/>{:else if entity.kind==='camera'}<Camera size={15}/>{:else if entity.kind==='avatar'}<User size={15}/>{:else if entity.kind==='tracking'}<Radio size={15}/>{:else if entity.kind==='environment'}<Mountain size={15}/>{:else if entity.kind==='light'}{#if entity.light.type==='point'}<Lightbulb size={15}/>{:else if entity.light.type==='spot'}<Spotlight size={15}/>{:else if entity.light.type==='ambient'}<SunDim size={15}/>{:else}<Sun size={15}/>{/if}{:else if entity.kind==='haze'}<CloudFog size={15}/>{:else if entity.kind==='fpsCounter'}<Gauge size={15}/>{:else if entity.kind==='vmcSender'}<Send size={15}/>{:else}<Box size={15}/>{/if}<span>{entity.name}</span>
       </button>{/if}
       <div class="row-actions">
        {#if entity.kind==='camera'}<button type="button" class={`row-action${activeCamera===entity.id?' active-camera':''}`} aria-label={`Use ${entity.name} as output camera`} aria-pressed={activeCamera===entity.id} disabled={disabled||view.pending} onclick={()=>activateCamera(entity.id)}><Video size={14}/></button>{/if}
        <button type="button" class="row-action" aria-label={`${entity.visible?'Hide':'Show'} ${entity.name}`} aria-pressed={!entity.visible} disabled={disabled||view.pending} onclick={()=>visibility(entity.id)}>{#if entity.visible}<Eye size={14}/>{:else}<EyeOff size={14}/>{/if}</button>
       </div>
      </div>
     {/each}
    {/if}
   </div>
  {/each}
 </div>
</section>
{#if menu}<ContextMenu {...menu} onclose={()=>{menu=null;}}/>{/if}
<style>
 .asset-rename{flex:1;min-width:0;padding:3px 0}.asset-rename :global(label){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.asset-rename :global(input){width:100%;min-width:0}
 .asset-group{margin-bottom:8px}.asset-row{display:flex;align-items:center;gap:2px}.asset-row .entity-row{flex:1;min-width:0;padding:8px 6px;gap:7px}.asset-row .hidden-asset{color:#aaa3b5}.row-actions{display:flex;flex:none}.row-action{display:flex;align-items:center;justify-content:center;border:0;border-radius:4px;background:transparent;cursor:pointer}.row-action:hover{background:#e9e4f2}.row-action:disabled{opacity:.5;cursor:default}.row-action:focus-visible,.entity-row:focus-visible{outline:2px solid #8571ac;outline-offset:-2px}.row-actions .row-action{padding:5px;width:25px;height:28px;color:#9b95aa}.row-actions .active-camera{color:#6e5c94;background:#e9e4f2}.asset-group .group-heading{border:0;background:transparent;cursor:pointer;display:flex;width:100%;justify-content:flex-start;gap:5px;padding:5px 6px;color:#85818f;font-size:11px;font-weight:500}
.asset-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.asset-heading h2{margin:0}.asset-actions{display:flex;gap:2px}.asset-actions :global(button){font-size:12px;padding:4px 7px}.asset-search{display:flex;gap:8px;align-items:center;padding-bottom:10px}.asset-search :global(input){min-width:0}.asset-row :global(svg){flex:none}.asset-search :global(label){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style>
