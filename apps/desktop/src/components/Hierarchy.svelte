<script lang="ts">
 import { Button, Input } from '@oshi-connect/ui';
 import { Camera, User, Box, Search } from '@lucide/svelte';
 import type { Transform, Reply } from '@opensekai/contracts';
 import type { EditorPanelProps } from '../editor/model';
 import ContextMenu, {type MenuAction} from './ContextMenu.svelte';
 type Tool='translate'|'rotate'|'scale';
 type Props=Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};onselect?:(id:string)=>void;ontool?:(tool:Tool)=>void;disabled?:boolean};
 let {model,view,onselect,ontool,disabled=false}:Props=$props();let search=$state('');let menu=$state<{x:number;y:number;actions:MenuAction[]}|null>(null);
 const entities=$derived((view.scene?.entities??[]).filter(entity=>entity.name.toLowerCase().includes(search.toLowerCase())));
 function select(id:string){model.select(id);onselect?.(id);}
 function navigate(event:KeyboardEvent){const index=entities.findIndex(e=>e.id===view.selectedId);const next=event.key==='Home'?0:event.key==='End'?entities.length-1:event.key==='ArrowDown'?Math.min(index+1,entities.length-1):event.key==='ArrowUp'?Math.max(index-1,0):-1;if(next<0||!entities[next])return;event.preventDefault();select(entities[next].id);(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[next]?.focus();}
 function context(event:MouseEvent,id:string){event.preventDefault();select(id);const entity=view.scene?.entities.find(e=>e.id===id),revision=view.scene?.revision;if(!entity||revision===undefined)return;const current=()=>view.scene?.revision===revision&&!view.pending&&!disabled;const action=(label:string,run:()=>void):MenuAction=>({label,disabled:disabled||view.pending,run:()=>{if(current())run();}});menu={x:event.clientX,y:event.clientY,actions:[...(ontool?(['translate','rotate','scale'] as Tool[]).map((tool,i)=>action(['Move','Rotate','Scale'][i],()=>ontool?.(tool))):[]),action(entity.visible?'Hide':'Show',()=>{void model.setVisibility(id,!entity.visible);}),...(['position','rotation','scale'] as const).map(row=>action(`Reset ${row}`,()=>{void model.setTransform?.(id,{...structuredClone(entity.transform),[row]:row==='rotation'?[0,0,0,1]:row==='scale'?[1,1,1]:[0,0,0]},revision);})),...(entity.kind==='camera'?[action('Use as output camera',()=>{void model.selectCamera(id);})]:[])]};}
</script>
<section class="editor-panel hierarchy" aria-labelledby="hierarchy-heading"><h2 id="hierarchy-heading">Assets</h2><div class="asset-search"><Search size={14}/><Input label="Search assets" placeholder="Search" bind:value={search}/></div>
 <div class="entity-list" role="toolbar" aria-label="Scene assets" tabindex="0" onkeydown={navigate}>{#each entities as entity (entity.id)}<div class="asset-row" oncontextmenu={event=>context(event,entity.id)} role="presentation"><Button class={view.selectedId===entity.id?'entity-row selected':'entity-row'} variant="ghost" onclick={()=>select(entity.id)} >{#if entity.kind==='camera'}<Camera size={15}/>{:else if entity.kind==='avatar'}<User size={15}/>{:else}<Box size={15}/>{/if}<span>{entity.name}</span></Button></div>{/each}</div>
</section>
{#if menu}<ContextMenu {...menu} onclose={()=>{menu=null;}}/>{/if}
<style>.asset-search{display:flex;gap:8px;align-items:center;padding-bottom:10px}.asset-search :global(input){min-width:0}.asset-row :global(svg){flex:none}.asset-search :global(label){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style>
