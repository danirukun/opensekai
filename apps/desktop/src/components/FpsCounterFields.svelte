<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import {FpsCounterCornerSchema,type FpsCounterSettings,type Reply} from '@opensekai/contracts';
 import {fpsCounterCornerOptions} from '../editor/lights';
 import {SLIDERS} from '../editor/slider';
 import ColorField from './ColorField.svelte';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,fpsCounter,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;fpsCounter:FpsCounterSettings;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,fpsCounter:FpsCounterSettings,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,fpsCounter:FpsCounterSettings)=>void;onliveend?:()=>void}=$props();
 const commit=(next:FpsCounterSettings)=>oncommit?.(entityId,next,revision);
 // A reset commits the counter with one field at its default (B19 R5).
 const reset=(key:keyof FpsCounterSettings)=>{void commit({...fpsCounter,[key]:marks.defaults[key]});};
</script>
{#snippet mark(key:keyof FpsCounterSettings,label:string)}{#if marks.changed.has(key)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(key)}/>{/if}{/snippet}
<fieldset class="fps-counter" disabled={disabled||!oncommit}>
 <div class="resettable"><Select label="Corner" value={fpsCounter.corner} options={fpsCounterCornerOptions} disabled={disabled||!oncommit} onchange={async event=>{const select=event.currentTarget;const corner=FpsCounterCornerSchema.safeParse(select.value);const reply=corner.success?await commit({...fpsCounter,corner:corner.data}):undefined;if(!reply?.ok)select.value=fpsCounter.corner;}}/>{@render mark('corner','Corner')}</div>
 <div class="resettable"><SliderField label="Size" value={fpsCounter.size} range={SLIDERS.fpsCounterSize} disabled={disabled||!oncommit} onlive={size=>onlive?.(entityId,{...fpsCounter,size})} onend={onliveend} oncommit={size=>{void commit({...fpsCounter,size});}}/>{@render mark('size','Size')}</div>
 <div class="resettable"><ColorField label="Color" value={fpsCounter.color} disabled={disabled||!oncommit} onlive={color=>onlive?.(entityId,{...fpsCounter,color})} onend={onliveend} oncommit={color=>{void commit({...fpsCounter,color});}}/>{@render mark('color','Color')}</div>
</fieldset>
<style>.fps-counter{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}</style>
