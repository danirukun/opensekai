<script lang="ts">
 import {DEFAULT_AVATAR_LIGHTING,type AvatarLighting,type Reply} from '@opensekai/contracts';
 import {SLIDERS,type SliderRange} from '../editor/slider';
 import {lightingValues,withLightingValue,type LightingFieldId} from '../editor/avatar-lighting';
 import SliderField from './SliderField.svelte';
 import ColorField from './ColorField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,lighting,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;lighting?:AvatarLighting;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,lighting:AvatarLighting,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,lighting:AvatarLighting)=>void;onliveend?:()=>void}=$props();
 // A character without the group shows the defaults; the first change writes the full group.
 const current=$derived(lighting??DEFAULT_AVATAR_LIGHTING);
 const values=$derived(lightingValues(current));
 const off=$derived(disabled||!oncommit);
 type SliderId=Exclude<LightingFieldId,'rimTint'>;
 const rims:[SliderId,string,SliderRange][]=[['rimStrength','Rim Strength',SLIDERS.rimStrength],['rimWidth','Rim Width',SLIDERS.rimWidth]];
 const shades:[SliderId,string,SliderRange][]=[['shadowStrength','Shadow Strength',SLIDERS.shadowStrength],['environmentFill','Environment Fill',SLIDERS.environmentFill]];
 const commit=(id:LightingFieldId,value:unknown)=>oncommit?.(entityId,withLightingValue(current,id,value),revision);
 const reset=(id:LightingFieldId)=>{void commit(id,marks.defaults[id]);};
</script>
{#snippet slider(id:SliderId,label:string,range:SliderRange)}
 <div class="resettable"><SliderField {label} value={values[id]} {range} disabled={off} onlive={value=>onlive?.(entityId,withLightingValue(current,id,value))} onend={onliveend} oncommit={value=>{void commit(id,value);}}/>{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}</div>
{/snippet}
<fieldset class="lighting" disabled={off}>
 {#each rims as [id,label,range] (id)}{@render slider(id,label,range)}{/each}
 <div class="resettable"><ColorField label="Rim Tint" value={current.rimTint} disabled={off} onlive={tint=>onlive?.(entityId,withLightingValue(current,'rimTint',tint))} onend={onliveend} oncommit={tint=>{void commit('rimTint',tint);}}/>{#if marks.changed.has('rimTint')}<ResetMark label="Rim Tint" disabled={marks.disabled} onreset={()=>reset('rimTint')}/>{/if}</div>
 {#each shades as [id,label,range] (id)}{@render slider(id,label,range)}{/each}
</fieldset>
<style>.lighting{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}</style>
