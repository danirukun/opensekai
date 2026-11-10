<script lang="ts">
 import {CameraToneMappingSchema,DEFAULT_CAMERA_GRADING,type CameraGrading,type Reply} from '@opensekai/contracts';
 import {Select} from '@oshi-connect/ui';
 import {SLIDERS,type SliderRange} from '../editor/slider';
 import {toneMappingOptions} from '../editor/live-fields';
 import {gradingValues,withGradingValue,type GradingFieldId} from '../editor/grading';
 import SliderField from './SliderField.svelte';
 import ColorField from './ColorField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,grading,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend}:{entityId:string;grading?:CameraGrading;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,grading:CameraGrading,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,grading:CameraGrading)=>void;onliveend?:()=>void}=$props();
 // A camera without the group shows the defaults; the first change writes the full group (CAM-06 R15).
 const current=$derived(grading??DEFAULT_CAMERA_GRADING);
 const values=$derived(gradingValues(current));
 const off=$derived(disabled||!oncommit);
 const sliders:[Exclude<GradingFieldId,'toneMapping'|'tint'>,string,SliderRange][]=[['exposure','Exposure',SLIDERS.exposure],['brightness','Brightness',SLIDERS.grade],['contrast','Contrast',SLIDERS.grade],['vibrance','Vibrance',SLIDERS.grade]];
 const blooms:[Exclude<GradingFieldId,'toneMapping'|'tint'>,string,SliderRange][]=[['bloomIntensity','Bloom Intensity',SLIDERS.bloomIntensity],['bloomThreshold','Bloom Threshold',SLIDERS.bloomThreshold],['bloomRadius','Bloom Radius',SLIDERS.bloomRadius]];
 const commit=(id:GradingFieldId,value:unknown)=>oncommit?.(entityId,withGradingValue(current,id,value),revision);
 const reset=(id:GradingFieldId)=>{void commit(id,marks.defaults[id]);};
</script>
{#snippet slider(id:Exclude<GradingFieldId,'toneMapping'|'tint'>,label:string,range:SliderRange)}
 <div class="resettable"><SliderField {label} value={values[id]} {range} disabled={off} onlive={value=>onlive?.(entityId,withGradingValue(current,id,value))} onend={onliveend} oncommit={value=>{void commit(id,value);}}/>{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}</div>
{/snippet}
<fieldset class="grading" disabled={off}>
 <div class="resettable"><Select label="Tone Mapping" value={current.toneMapping} options={toneMappingOptions} disabled={off} onchange={async event=>{const select=event.currentTarget;const mode=CameraToneMappingSchema.safeParse(select.value);const reply=mode.success?await commit('toneMapping',mode.data):undefined;if(!reply?.ok)select.value=current.toneMapping;}}/>{#if marks.changed.has('toneMapping')}<ResetMark label="Tone Mapping" disabled={marks.disabled} onreset={()=>reset('toneMapping')}/>{/if}</div>
 {#each sliders as [id,label,range] (id)}{@render slider(id,label,range)}{/each}
 <div class="resettable"><ColorField label="Tint" value={current.tint} disabled={off} onlive={tint=>onlive?.(entityId,withGradingValue(current,'tint',tint))} onend={onliveend} oncommit={tint=>{void commit('tint',tint);}}/>{#if marks.changed.has('tint')}<ResetMark label="Tint" disabled={marks.disabled} onreset={()=>reset('tint')}/>{/if}</div>
 {#each blooms as [id,label,range] (id)}{@render slider(id,label,range)}{/each}
</fieldset>
<style>.grading{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}</style>
