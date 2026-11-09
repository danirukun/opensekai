<script lang="ts">
 import {untrack} from 'svelte';
 import {Input} from '@oshi-connect/ui';
 import type {Reply,WebScreen} from '@opensekai/contracts';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {reconcileDraft} from '../editor/live-fields';
 import {clampWebSize,parseWebUrl} from '../editor/screen';
 // The Web page fields of a screen (B30 R13). Each commit sends setScreenWeb with the other values unchanged.
 let {marks=NO_MARKS,entityId,web,revision,disabled=false,oncommit}:{marks?:ResetMarks;entityId:string;web:WebScreen;revision:number;disabled?:boolean;oncommit:(next:WebScreen)=>Promise<Reply<unknown>|undefined>}=$props();
 const base=()=>({url:web.url??'',width:String(web.width),height:String(web.height)});
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 function commitUrl(){const parsed=parseWebUrl(draft.url);invalid=!parsed.ok;if(parsed.ok&&parsed.url!==web.url)void oncommit({...web,url:parsed.url});}
 function commitSize(axis:'width'|'height'){const value=clampWebSize(axis,draft[axis],web[axis]);draft[axis]=String(value);if(value!==web[axis])void oncommit({...web,[axis]:value});}
 const reset=(id:'url'|'width'|'height'|'onTop')=>{invalid=false;void oncommit({...web,[id]:marks.defaults[id]});};
</script>
{#snippet mark(id:'url'|'width'|'height'|'onTop',label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled||disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
<fieldset class="screen-web" {disabled}>
 <div class="resettable"><Input label="URL" bind:value={draft.url} state={invalid?'error':'default'} helperText={invalid?'Enter an https URL':undefined} onchange={commitUrl} onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>{@render mark('url','URL')}</div>
 <div class="pair">
  <div class="resettable"><Input label="Width" type="number" min={64} max={3840} step={1} bind:value={draft.width} onchange={()=>commitSize('width')} onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>{@render mark('width','Width')}</div>
  <div class="resettable"><Input label="Height" type="number" min={64} max={2160} step={1} bind:value={draft.height} onchange={()=>commitSize('height')} onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>{@render mark('height','Height')}</div>
 </div>
 <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={web.onTop} onchange={async event=>{const box=event.currentTarget;const reply=await oncommit({...web,onTop:box.checked});if(!reply?.ok)box.checked=web.onTop;}}/>On top</label>{@render mark('onTop','On top')}</div>
</fieldset>
<style>
 .screen-web{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}
 .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
</style>
