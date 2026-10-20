<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input} from '@oshi-connect/ui';
 import {parseLens,reconcileDraft,type CameraLens,type Commit} from '../editor/live-fields';
 import {SLIDERS} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,lens,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;lens:CameraLens;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:Commit<CameraLens>;onlive?:(id:string,lens:CameraLens)=>void;onliveend?:()=>void}=$props();
 // FOV is a live slider (B12 R15); the clip planes keep their Apply.
 const base=()=>({near:String(lens.near),far:String(lens.far)});
 let values=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>values),base());if(next.key!==key){values=next.values;invalid=false;}key=next.key;});
 // A reset sends the scene lens with one field at its default and discards the Near and Far text (B17 R7).
 const reset=(key:keyof CameraLens)=>{void oncommit?.(entityId,{...lens,[key]:Number(marks.defaults[key])},revision);};
 function apply(){const parsed=parseLens({fovDegrees:String(lens.fovDegrees),...values});invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
</script>
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={disabled||!oncommit}>{#snippet mark(key:keyof CameraLens,label:string)}{#if marks.changed.has(key)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(key)}/>{/if}{/snippet}<div class="resettable"><SliderField label="FOV (°)" value={lens.fovDegrees} range={SLIDERS.fov} disabled={disabled||!oncommit} onlive={fovDegrees=>onlive?.(entityId,{...lens,fovDegrees})} onend={onliveend} oncommit={fovDegrees=>{void oncommit?.(entityId,{...lens,fovDegrees},revision);}}/>{@render mark('fovDegrees','FOV (°)')}</div><div class="clips"><div class="resettable"><Input label="Near" bind:value={values.near}/>{@render mark('near','Near')}</div><div class="resettable"><Input label="Far" bind:value={values.far}/>{@render mark('far','Far')}</div></div><Button type="submit" variant="ghost">Apply</Button></fieldset>{#if invalid}<p role="alert">Use Near above 0 and Far above Near.</p>{/if}</form>
<style>form{padding:0}fieldset{border:0;padding:0;margin:0;min-width:0}.clips{display:flex;gap:8px;margin-top:8px}.clips>div{flex:1;min-width:0}.clips :global(input){min-width:0;width:100%}</style>
