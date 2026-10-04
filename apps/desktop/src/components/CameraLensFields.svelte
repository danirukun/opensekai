<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input} from '@oshi-connect/ui';
 import {parseLens,reconcileDraft,type CameraLens,type Commit} from '../editor/live-fields';
 let {entityId,lens,revision,disabled=false,oncommit}:{entityId:string;lens:CameraLens;revision:number;disabled?:boolean;oncommit?:Commit<CameraLens>}=$props();
 const base=()=>({fovDegrees:String(lens.fovDegrees),near:String(lens.near),far:String(lens.far)});
 let values=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>values),base());if(next.key!==key){values=next.values;invalid=false;}key=next.key;});
 function apply(){const parsed=parseLens(values);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
</script>
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={disabled||!oncommit}><legend>Lens</legend><Input label="FOV (°)" bind:value={values.fovDegrees}/><div class="clips"><Input label="Near" bind:value={values.near}/><Input label="Far" bind:value={values.far}/></div><Button type="submit" variant="ghost">Apply</Button></fieldset>{#if invalid}<p role="alert">Use FOV 1–179°, Near above 0, and Far above Near.</p>{/if}</form>
<style>form{padding:12px 0;border-bottom:1px solid #e1dee6}fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;margin-bottom:6px}.clips{display:flex;gap:8px;margin-top:8px}.clips :global(input){min-width:0;width:100%}</style>
