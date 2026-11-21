<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input,Select} from '@oshi-connect/ui';
 import {SENSOR_PRESETS,lensWithFocalLength,lensWithSensorPreset,type CameraEffects,type CameraLens,type CameraNavigation,type Reply,type SensorPresetId} from '@opensekai/contracts';
 import {parseLens,reconcileDraft,settleCheckbox,type Commit} from '../editor/live-fields';
 import {SLIDERS} from '../editor/slider';
 import {hasFocusTarget} from '../editor/cameras';
 import {LENS_PRESETS,applyLensPreset,type LensPresetId,type LensPresetResult} from '../editor/lens-presets';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,lens,effects,navigation,revision,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend,onpreset}:{entityId:string;lens:CameraLens;effects?:CameraEffects;navigation?:CameraNavigation;marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:Commit<CameraLens>;onlive?:(id:string,lens:CameraLens)=>void;onliveend?:()=>void;onpreset?:(id:string,result:LensPresetResult,revision:number)=>Promise<unknown>}=$props();
 // Near and Far stay free-text drafts behind Apply (B12 R15); every other field commits live.
 const base=()=>({near:String(lens.near),far:String(lens.far)});
 let values=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>values),base());if(next.key!==key){values=next.values;invalid=false;}key=next.key;});
 const off=$derived(disabled||!oncommit);
 const sensorOptions=Object.entries(SENSOR_PRESETS).map(([value,preset])=>({value,label:preset.label}));
 // Autofocus tracks the Focus Character head; without one it is a no-op, so it stays disabled without extra copy (constitution).
 const autofocusOff=$derived(off||!hasFocusTarget(navigation));
 type LensFieldId='focalLengthMm'|'fStop'|'focusDistance'|'autofocus'|'sensorPreset'|'near'|'far';
 function reset(id:LensFieldId){
  const value=marks.defaults[id];
  const next=id==='focalLengthMm'?lensWithFocalLength(lens,value as number):id==='sensorPreset'?lensWithSensorPreset(lens,value as SensorPresetId):{...lens,[id]:value};
  void oncommit?.(entityId,next,revision);
 }
 function apply(){const parsed=parseLens(lens,values);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
 async function choosePreset(id:LensPresetId){await onpreset?.(entityId,applyLensPreset(id,lens,effects),revision);}
</script>
<div class="presets" role="group" aria-label="Preset">{#each LENS_PRESETS as preset (preset.id)}<Button type="button" variant="ghost" size="sm" disabled={off} onclick={()=>choosePreset(preset.id)}>{preset.label}</Button>{/each}</div>
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={off}>{#snippet mark(id:LensFieldId,label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
 <div class="resettable"><SliderField label="Focal Length (mm)" value={lens.focalLengthMm} range={SLIDERS.focalLength} disabled={off} onlive={value=>onlive?.(entityId,lensWithFocalLength(lens,value))} onend={onliveend} oncommit={value=>{void oncommit?.(entityId,lensWithFocalLength(lens,value),revision);}}/>{@render mark('focalLengthMm','Focal Length (mm)')}</div>
 <div class="resettable"><SliderField label="Aperture (f-stop)" value={lens.fStop} range={SLIDERS.fStop} disabled={off} onlive={value=>onlive?.(entityId,{...lens,fStop:value})} onend={onliveend} oncommit={value=>{void oncommit?.(entityId,{...lens,fStop:value},revision);}}/>{@render mark('fStop','Aperture (f-stop)')}</div>
 <div class="resettable"><SliderField label="Focus Distance" value={lens.focusDistance} range={SLIDERS.focusDistance} disabled={off} onlive={value=>onlive?.(entityId,{...lens,focusDistance:value})} onend={onliveend} oncommit={value=>{void oncommit?.(entityId,{...lens,focusDistance:value},revision);}}/>{@render mark('focusDistance','Focus Distance')}</div>
 <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={lens.autofocus} disabled={autofocusOff} onchange={async event=>{const box=event.currentTarget;const reply=await oncommit?.(entityId,{...lens,autofocus:box.checked},revision) as Reply<unknown>|undefined;settleCheckbox(box,reply,lens.autofocus);}}/>Autofocus</label>{@render mark('autofocus','Autofocus')}</div>
 <div class="resettable"><Select label="Sensor" value={lens.sensorPreset} options={sensorOptions} disabled={off} onchange={event=>{void oncommit?.(entityId,lensWithSensorPreset(lens,event.currentTarget.value as SensorPresetId),revision);}}/>{@render mark('sensorPreset','Sensor')}</div>
 <Input label="FOV (°)" value={lens.fovDegrees.toFixed(1)} disabled/>
 <div class="clips"><div class="resettable"><Input label="Near" bind:value={values.near}/>{@render mark('near','Near')}</div><div class="resettable"><Input label="Far" bind:value={values.far}/>{@render mark('far','Far')}</div></div>
 <Button type="submit" variant="ghost">Apply</Button>
</fieldset>{#if invalid}<p role="alert">Use Near above 0 and Far above Near.</p>{/if}</form>
<style>
 form{padding:0}
 fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}
 .presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
 .clips{display:flex;gap:8px}
 .clips>div{flex:1;min-width:0}
 .clips :global(input){min-width:0;width:100%}
</style>
