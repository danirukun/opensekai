<script lang="ts">
 import type {HazeSettings,Reply} from '@opensekai/contracts';
 import {SLIDERS,type SliderRange} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,haze,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;haze:HazeSettings;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,haze:HazeSettings,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,haze:HazeSettings)=>void;onliveend?:()=>void}=$props();
 // Live sliders for the haze volume (B13 R12).
 const fields:[keyof HazeSettings,string,SliderRange][]=[['density','Density',SLIDERS.hazeDensity],['smoke','Smoke',SLIDERS.smoke],['intensity','Intensity',SLIDERS.hazeIntensity],['drift','Drift (m/s)',SLIDERS.drift]];
</script>
<fieldset class="haze" disabled={disabled||!oncommit}>
 {#each fields as [key,label,range] (key)}
  <div class="resettable"><SliderField {label} value={haze[key]} {range} disabled={disabled||!oncommit} onlive={value=>onlive?.(entityId,{...haze,[key]:value})} onend={onliveend} oncommit={value=>{void oncommit?.(entityId,{...haze,[key]:value},revision);}}/>{#if marks.changed.has(key)}<ResetMark {label} disabled={marks.disabled} onreset={()=>{void oncommit?.(entityId,{...haze,[key]:Number(marks.defaults[key])},revision);}}/>{/if}</div>
 {/each}
</fieldset>
<style>.haze{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}</style>
