<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input} from '@oshi-connect/ui';
 import {DEFAULT_TRACKING_SMOOTHING,type TrackingSmoothing} from '@opensekai/contracts';
 import {parseTrackingSmoothing,reconcileDraft,type Commit} from '../editor/live-fields';
 let {entityId,smoothing,revision,disabled=false,oncommit}:{entityId:string;smoothing?:TrackingSmoothing;revision:number;disabled?:boolean;oncommit?:Commit<TrackingSmoothing>}=$props();
 const effective=$derived(smoothing??DEFAULT_TRACKING_SMOOTHING);
 const base=()=>({minCutoff:String(effective.minCutoff),beta:String(effective.beta),derivativeCutoff:String(effective.derivativeCutoff)});
 let values=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>values),base());if(next.key!==key){values=next.values;invalid=false;}key=next.key;});
 function apply(){const parsed=parseTrackingSmoothing(effective.enabled,values);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
</script>
<form onsubmit={event=>{event.preventDefault();apply();}}>
 <fieldset disabled={disabled||!oncommit}>
  <legend>Smoothing</legend>
  <label class="option"><input type="checkbox" checked={effective.enabled} onchange={event=>{void oncommit?.(entityId,{...effective,enabled:event.currentTarget.checked},revision);}}/>Enabled</label>
  <fieldset class="parameters" disabled={!effective.enabled}>
   <div title="Higher cutoff allows more motion with less smoothing."><Input label="Min cutoff (Hz)" type="number" min={.01} max={120} step="any" bind:value={values.minCutoff}/></div>
   <div title="Higher beta responds faster to rapid motion."><Input label="Beta" type="number" min={0} max={100} step="any" bind:value={values.beta}/></div>
   <div title="Derivative cutoff controls velocity smoothing."><Input label="Derivative cutoff (Hz)" type="number" min={.01} max={120} step="any" bind:value={values.derivativeCutoff}/></div>
   <Button type="submit" variant="ghost">Apply</Button>
  </fieldset>
  <Button type="button" variant="ghost" onclick={()=>{void oncommit?.(entityId,{...DEFAULT_TRACKING_SMOOTHING},revision);}}>Reset</Button>
 </fieldset>
 {#if invalid}<p role="alert">Use cutoff 0.01–120 Hz and beta 0–100.</p>{/if}
</form>
<style>form{padding:0}fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;margin-bottom:8px}.option{display:flex;gap:8px;align-items:center;font-size:12px}</style>
