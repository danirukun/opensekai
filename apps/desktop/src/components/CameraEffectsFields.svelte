<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import type {AssetRecord,CameraEffects,Reply} from '@opensekai/contracts';
 import {SLIDERS,type SliderRange} from '../editor/slider';
 import {settleCheckbox} from '../editor/live-fields';
 import {sourceAction} from '../editor/environment';
 import {imageSourceOptions} from '../editor/screen';
 import {EFFECT_LABELS as L,effectValues,shownEffectFields,withEffect,withLensDirt,type EffectFieldId} from '../editor/camera-effects';
 import SliderField from './SliderField.svelte';
 import ColorField from './ColorField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,effects,revision,assets,importing=false,error=null,disabled=false,marks=NO_MARKS,oncommit,onlive,onliveend,onimport}:{entityId:string;effects?:CameraEffects;revision:number;assets:readonly AssetRecord[];importing?:boolean;error?:string|null;disabled?:boolean;marks?:ResetMarks;oncommit?:(id:string,effects:CameraEffects,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,effects:CameraEffects)=>void;onliveend?:()=>void;onimport?:()=>void}=$props();
 // A camera without the group shows the defaults; a first change writes the defaults of that effect (B37 R28).
 const values=$derived(effectValues(effects));
 const shown=$derived(new Set(shownEffectFields(effects)));
 const off=$derived(disabled||!oncommit);
 const dirt=$derived((values.lensDirt as string|null)??null);
 let dirtReset=$state(0);
 const commit=(id:EffectFieldId,value:unknown)=>oncommit?.(entityId,withEffect(effects,id,value),revision);
 const reset=(id:EffectFieldId)=>{void commit(id,marks.defaults[id]);};
 function chooseDirt(value:string){const action=sourceAction(value);dirtReset++;if(action.kind==='import')onimport?.();else void oncommit?.(entityId,withLensDirt(effects,action.assetId),revision);}
 type Row={kind:'slider';id:EffectFieldId;label:string;range:SliderRange}|{kind:'color';id:EffectFieldId;label:string};
 const toggles:{id:EffectFieldId;label:string;rows:Row[]}[]=[
  {id:'vignetting',label:L.vignetting,rows:[{kind:'color',id:'vignettingColor',label:L.color},{kind:'slider',id:'vignettingAlpha',label:L.alpha,range:SLIDERS.vignettingAlpha},{kind:'slider',id:'vignettingFadeOut',label:L.fadeOut,range:SLIDERS.vignettingFadeOut},{kind:'slider',id:'vignettingBlink',label:L.blink,range:SLIDERS.vignettingBlink}]},
  {id:'nightVision',label:L.nightVision,rows:[{kind:'color',id:'nightVisionColor',label:L.color},{kind:'slider',id:'nightVisionAlpha',label:L.alpha,range:SLIDERS.nightVisionAlpha}]},
  {id:'blur',label:L.blur,rows:[{kind:'slider',id:'blurIntensity',label:L.intensity,range:SLIDERS.blurIntensity}]},
  {id:'pixelate',label:L.pixelate,rows:[{kind:'slider',id:'pixelateIntensity',label:L.intensity,range:SLIDERS.pixelateIntensity}]},
 ];
 const dirtRows:Row[]=[{kind:'slider',id:'lensDirtIntensity',label:L.intensity,range:SLIDERS.lensDirtIntensity},{kind:'slider',id:'lensDirtThreshold',label:L.threshold,range:SLIDERS.lensDirtThreshold}];
</script>
{#snippet mark(id:EffectFieldId,label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
{#snippet row(group:string,item:Row)}
 {#if shown.has(item.id)}<div class="resettable">
  {#if item.kind==='slider'}<SliderField label={item.label} value={values[item.id] as number} range={item.range} disabled={off} onlive={value=>onlive?.(entityId,withEffect(effects,item.id,value))} onend={onliveend} oncommit={value=>{void commit(item.id,value);}}/>
  {:else}<ColorField label={item.label} value={values[item.id] as string} disabled={off} onlive={color=>onlive?.(entityId,withEffect(effects,item.id,color))} onend={onliveend} oncommit={color=>{void commit(item.id,color);}}/>{/if}
  {@render mark(item.id,`${group} ${item.label}`)}
 </div>{/if}
{/snippet}
<fieldset class="effects" disabled={off}>
 <div class="effect" role="group" aria-label={L.lensDirt}>
  <div class="resettable">{#key `${dirt}:${dirtReset}`}<Select label={L.lensDirt} value={dirt??''} options={imageSourceOptions(dirt,assets,L.none)} disabled={off||importing} onchange={event=>chooseDirt(event.currentTarget.value)}/>{/key}{#if marks.changed.has('lensDirt')}<ResetMark label={L.lensDirt} disabled={marks.disabled||importing} onreset={()=>reset('lensDirt')}/>{/if}</div>
  {#if error}<p class="failed" role="alert">{error}</p>{/if}
  {#each dirtRows as item (item.id)}{@render row(L.lensDirt,item)}{/each}
 </div>
 {#each toggles as effect (effect.id)}
  <div class="effect" role="group" aria-label={effect.label}>
   <div class="resettable"><label class="visibility-control"><input type="checkbox" checked={values[effect.id] as boolean} disabled={off} onchange={async event=>{const box=event.currentTarget;const reply=await commit(effect.id,box.checked);settleCheckbox(box,reply,values[effect.id] as boolean);}}/>{effect.label}</label>{@render mark(effect.id,effect.label)}</div>
   {#each effect.rows as item (item.id)}{@render row(effect.label,item)}{/each}
  </div>
 {/each}
</fieldset>
<style>
 .effects{border:0;padding:0;margin:0;min-width:0;display:grid;gap:14px}
 .effect{display:grid;gap:10px}
 .effect :global(.visibility-control){margin-bottom:0}
 .failed{margin:0;font-size:11px;color:var(--ds-color-error)}
</style>
