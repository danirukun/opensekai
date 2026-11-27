<script lang="ts">
 import type {Reply,SnowSettings} from '@opensekai/contracts';
 import {SNOW_FIELDS} from '../editor/snow-fields';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,snow,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;snow:SnowSettings;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,snow:SnowSettings,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,snow:SnowSettings)=>void;onliveend?:()=>void}=$props();
 const SETTLE='Settle On Characters';
 // The checkbox has no live path: the change compiles the character materials (snow Inspector R4).
 const settle=(value:boolean)=>{void oncommit?.(entityId,{...snow,settleOnCharacters:value},revision);};
</script>
<fieldset class="snow" disabled={disabled||!oncommit}>
 {#each SNOW_FIELDS as [key,label,range] (key)}
  <div class="resettable"><SliderField {label} value={snow[key]} {range} disabled={disabled||!oncommit} onlive={value=>onlive?.(entityId,{...snow,[key]:value})} onend={onliveend} oncommit={value=>{void oncommit?.(entityId,{...snow,[key]:value},revision);}}/>{#if marks.changed.has(key)}<ResetMark {label} disabled={marks.disabled} onreset={()=>{void oncommit?.(entityId,{...snow,[key]:Number(marks.defaults[key])},revision);}}/>{/if}</div>
 {/each}
 <div class="resettable"><label class="visibility-control"><input type="checkbox" name="settleOnCharacters" checked={snow.settleOnCharacters} onchange={event=>settle(event.currentTarget.checked)}/>{SETTLE}</label>{#if marks.changed.has('settleOnCharacters')}<ResetMark label={SETTLE} disabled={marks.disabled} onreset={()=>settle(marks.defaults.settleOnCharacters===true)}/>{/if}</div>
</fieldset>
<style>.snow{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}</style>
