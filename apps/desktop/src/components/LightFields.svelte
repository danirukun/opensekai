<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {LightSettings,Reply} from '@opensekai/contracts';
 import {isLightType,lightForType,lightTypeOptions} from '../editor/lights';
 import {lightIntensitySlider,SLIDERS} from '../editor/slider';
 import ColorField from './ColorField.svelte';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {entityId,light,revision,disabled=false,part,marks=NO_MARKS,oncommit,onlive,onliveend,ondirection}:{entityId:string;light:LightSettings;part:'light'|'affect'|'shadow';marks?:ResetMarks;revision:number;disabled?:boolean;oncommit?:(id:string,light:LightSettings,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,light:LightSettings)=>void;onliveend?:()=>void;ondirection?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>}=$props();
 type Field='intensity'|'range'|'shadowIntensity'|'bias'|'normalBias'|'angleDegrees'|'penumbra';
 // Enter fires change and then submit; one commit at a time keeps the second from failing as BUSY.
 let committing=false;
 async function commit(next:LightSettings,control?:HTMLInputElement|HTMLSelectElement){
  if(committing)return;
  committing=true;
  let reply:Reply<unknown>|undefined;
  try{reply=await oncommit?.(entityId,next,revision);}finally{committing=false;}
  if(reply?.ok)return;
  if(control instanceof HTMLInputElement&&control.type==='checkbox')control.checked=checkedValue(control.name);
  else if(control instanceof HTMLSelectElement)control.value=light.type;
 }
 function checkedValue(name:string){return name==='shadow'?light.shadow.enabled:name==='soft'?light.shadow.soft:Boolean(light[name as 'affectCharacters'|'affectProps'|'affectEnvironment'|'volumetric']);}
 const withValue=(field:Field,value:number):LightSettings=>field==='intensity'||field==='range'?{...light,[field]:value}
  :field==='angleDegrees'||field==='penumbra'?{...light,cone:{...(light.cone??{angleDegrees:40,penumbra:0}),[field]:value}}
  :{...light,shadow:{...light.shadow,[field==='shadowIntensity'?'intensity':field]:value}};
 // Point and spot lights have a place and a range; spot lights have a cone; only they scatter in haze (B13 R12).
 const placed=$derived(light.type==='point'||light.type==='spot');
 const slider=(field:Field)=>({disabled:disabled||!oncommit,onlive:(value:number)=>onlive?.(entityId,withValue(field,value)),onend:onliveend,oncommit:(value:number)=>{void commit(withValue(field,value));}});
 function toggle(event:Event){
  const box=event.currentTarget as HTMLInputElement;
  const next=box.name==='shadow'||box.name==='soft'?{...light,shadow:{...light.shadow,[box.name==='shadow'?'enabled':'soft']:box.checked}}:{...light,[box.name]:box.checked};
  void commit(next,box);
 }
 // A reset commits the scene light with one field at its default (B17 R6).
 type Toggle='volumetric'|'affectCharacters'|'affectProps'|'affectEnvironment'|'shadow'|'soft';
 const toggled=(name:Toggle,value:boolean):LightSettings=>name==='shadow'||name==='soft'?{...light,shadow:{...light.shadow,[name==='shadow'?'enabled':'soft']:value}}:{...light,[name]:value};
 function reset(id:string){
  const value=marks.defaults[id];
  if(id==='color')void commit({...light,color:String(value)});
  else if(typeof value==='boolean')void commit(toggled(id as Toggle,value));
  else if(typeof value==='number')void commit(withValue(id as Field,value));
 }
</script>
{#snippet mark(id:string,label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
<fieldset class="light" disabled={disabled||!oncommit}>
 {#if part==='light'}
  <Select label="Type" value={light.type} options={lightTypeOptions} onchange={event=>{const select=event.currentTarget;if(isLightType(select.value))void commit(lightForType(select.value,light),select);}}/>
  <div class="resettable"><ColorField label="Color" value={light.color} disabled={disabled||!oncommit} onlive={color=>onlive?.(entityId,{...light,color})} onend={onliveend} oncommit={color=>{void commit({...light,color});}}/>{@render mark('color','Color')}</div>
  <div class="resettable"><SliderField label="Intensity" value={light.intensity} range={lightIntensitySlider(light.type)} {...slider('intensity')}/>{@render mark('intensity','Intensity')}</div>
  {#if placed}<div class="resettable"><SliderField label="Range (m)" value={light.range} range={SLIDERS.range} {...slider('range')}/>{@render mark('range','Range (m)')}</div>{/if}
  {#if light.type==='spot'}
   <div class="resettable"><SliderField label="Angle (°)" value={light.cone?.angleDegrees??40} range={SLIDERS.angle} {...slider('angleDegrees')}/>{@render mark('angleDegrees','Angle (°)')}</div>
   <div class="resettable"><SliderField label="Penumbra" value={light.cone?.penumbra??0} range={SLIDERS.penumbra} {...slider('penumbra')}/>{@render mark('penumbra','Penumbra')}</div>
  {/if}
  {#if placed}<div class="resettable"><label class="visibility-control"><input type="checkbox" name="volumetric" checked={light.volumetric===true} onchange={toggle}/>Volumetric</label>{@render mark('volumetric','Volumetric')}</div>{/if}
  {#if light.type==='directional'||light.type==='spot'}<div class="light-actions"><Button variant="secondary" disabled={disabled||!ondirection} onclick={()=>{void ondirection?.(entityId,revision);}}>Set Direction From Main Camera</Button></div>{/if}
 {:else if part==='affect'}
  {#each [['affectCharacters','Affect Characters'],['affectProps','Affect Props'],['affectEnvironment','Affect Environment']] as const as [name,label] (name)}
   <div class="resettable"><label class="visibility-control"><input type="checkbox" {name} checked={light[name]} onchange={toggle}/>{label}</label>{@render mark(name,label)}</div>
  {/each}
 {:else if light.type!=='ambient'}
  <div class="resettable"><label class="visibility-control"><input type="checkbox" name="shadow" checked={light.shadow.enabled} onchange={toggle}/>Shadow</label>{@render mark('shadow','Shadow')}</div>
  {#if light.shadow.enabled}
   <div class="resettable"><SliderField label="Shadow Intensity" value={light.shadow.intensity} range={SLIDERS.shadowIntensity} {...slider('shadowIntensity')}/>{@render mark('shadowIntensity','Shadow Intensity')}</div>
   <div class="resettable"><label class="visibility-control"><input type="checkbox" name="soft" checked={light.shadow.soft} onchange={toggle}/>Soft Shadows</label>{@render mark('soft','Soft Shadows')}</div>
   <div class="resettable"><SliderField label="Bias" value={light.shadow.bias} range={SLIDERS.bias} {...slider('bias')}/>{@render mark('bias','Bias')}</div>
   <div class="resettable"><SliderField label="Normal Bias" value={light.shadow.normalBias} range={SLIDERS.normalBias} {...slider('normalBias')}/>{@render mark('normalBias','Normal Bias')}</div>
  {/if}
 {/if}
</fieldset>
<style>.light{border:0;padding:0;margin:0;min-width:0;display:grid;gap:10px}.light-actions{padding-top:4px}</style>
