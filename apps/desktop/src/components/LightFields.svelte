<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {LightSettings,Reply} from '@opensekai/contracts';
 import {isLightType,lightForType,lightTypeOptions} from '../editor/lights';
 import {lightIntensitySlider,SLIDERS} from '../editor/slider';
 import ColorField from './ColorField.svelte';
 import SliderField from './SliderField.svelte';
 let {entityId,light,revision,disabled=false,oncommit,onlive,onliveend,ondirection}:{entityId:string;light:LightSettings;revision:number;disabled?:boolean;oncommit?:(id:string,light:LightSettings,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,light:LightSettings)=>void;onliveend?:()=>void;ondirection?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>}=$props();
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
</script>
<fieldset class="light" disabled={disabled||!oncommit}>
 <Select label="Type" value={light.type} options={lightTypeOptions} onchange={event=>{const select=event.currentTarget;if(isLightType(select.value))void commit(lightForType(select.value,light),select);}}/>
 <ColorField label="Color" value={light.color} disabled={disabled||!oncommit} onlive={color=>onlive?.(entityId,{...light,color})} onend={onliveend} oncommit={color=>{void commit({...light,color});}}/>
 <SliderField label="Intensity" value={light.intensity} range={lightIntensitySlider(light.type)} {...slider('intensity')}/>
 {#if placed}<SliderField label="Range (m)" value={light.range} range={SLIDERS.range} {...slider('range')}/>{/if}
 {#if light.type==='spot'}
  <SliderField label="Angle (°)" value={light.cone?.angleDegrees??40} range={SLIDERS.angle} {...slider('angleDegrees')}/>
  <SliderField label="Penumbra" value={light.cone?.penumbra??0} range={SLIDERS.penumbra} {...slider('penumbra')}/>
 {/if}
 {#if placed}<label class="visibility-control"><input type="checkbox" name="volumetric" checked={light.volumetric===true} onchange={toggle}/>Volumetric</label>{/if}
 <label class="visibility-control"><input type="checkbox" name="affectCharacters" checked={light.affectCharacters} onchange={toggle}/>Affect Characters</label>
 <label class="visibility-control"><input type="checkbox" name="affectProps" checked={light.affectProps} onchange={toggle}/>Affect Props</label>
 <label class="visibility-control"><input type="checkbox" name="affectEnvironment" checked={light.affectEnvironment} onchange={toggle}/>Affect Environment</label>
 {#if light.type!=='ambient'}<label class="visibility-control"><input type="checkbox" name="shadow" checked={light.shadow.enabled} onchange={toggle}/>Shadow</label>{/if}
 {#if light.shadow.enabled&&light.type!=='ambient'}
  <SliderField label="Shadow Intensity" value={light.shadow.intensity} range={SLIDERS.shadowIntensity} {...slider('shadowIntensity')}/>
  <label class="visibility-control"><input type="checkbox" name="soft" checked={light.shadow.soft} onchange={toggle}/>Soft Shadows</label>
  <SliderField label="Bias" value={light.shadow.bias} range={SLIDERS.bias} {...slider('bias')}/>
  <SliderField label="Normal Bias" value={light.shadow.normalBias} range={SLIDERS.normalBias} {...slider('normalBias')}/>
 {/if}
 {#if light.type==='directional'||light.type==='spot'}<div class="light-actions"><Button variant="secondary" disabled={disabled||!ondirection} onclick={()=>{void ondirection?.(entityId,revision);}}>Set Direction From Main Camera</Button></div>{/if}
</fieldset>
<style>.light{border:0;padding:12px 0 0;margin:0;min-width:0;display:grid;gap:10px}.light-actions{padding-top:4px}</style>
