<script lang="ts">
 import {Button,Input,Select} from '@oshi-connect/ui';
 import type {LightSettings,Reply} from '@opensekai/contracts';
 import {lightForType,lightTypeOptions,parseBounded,parseLightColor} from '../editor/lights';
 let {entityId,light,revision,disabled=false,oncommit,ondirection}:{entityId:string;light:LightSettings;revision:number;disabled?:boolean;oncommit?:(id:string,light:LightSettings,revision:number)=>Promise<Reply<unknown>|undefined>;ondirection?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>}=$props();
 type Field='color'|'intensity'|'range'|'shadowIntensity'|'bias'|'normalBias';
 const text=(l:LightSettings):Record<Field,string>=>({color:l.color,intensity:String(l.intensity),range:String(l.range),shadowIntensity:String(l.shadow.intensity),bias:String(l.shadow.bias),normalBias:String(l.shadow.normalBias)});
 let values=$state<Record<Field,string>>(text(light));
 // A scene change, an accepted change, or a rejected change shows the scene value again (R13).
 $effect(()=>{values=text(light);});
 const reset=()=>{values=text(light);};
 async function commit(next:LightSettings,control?:HTMLInputElement|HTMLSelectElement){
  const reply=await oncommit?.(entityId,next,revision);
  if(reply?.ok)return;
  reset();
  if(control instanceof HTMLInputElement&&control.type==='checkbox')control.checked=checkedValue(control.name);
  else if(control instanceof HTMLSelectElement)control.value=light.type;
 }
 function checkedValue(name:string){return name==='shadow'?light.shadow.enabled:name==='soft'?light.shadow.soft:Boolean(light[name as 'affectCharacters'|'affectProps'|'affectEnvironment']);}
 const ranges:Record<Exclude<Field,'color'>,[number,number]>={intensity:[0,1000],range:[0,1000],shadowIntensity:[0,1],bias:[-0.01,0.01],normalBias:[0,1]};
 function apply(field:Field){
  if(field==='color'){const color=parseLightColor(values.color);if(color===null||color===light.color){reset();return;}void commit({...light,color});return;}
  const value=parseBounded(values[field],...ranges[field]);
  const current=field==='intensity'||field==='range'?light[field]:light.shadow[field==='shadowIntensity'?'intensity':field];
  if(value===null||value===current){reset();return;}
  if(field==='intensity'||field==='range')void commit({...light,[field]:value});
  else void commit({...light,shadow:{...light.shadow,[field==='shadowIntensity'?'intensity':field]:value}});
 }
 function toggle(event:Event){
  const box=event.currentTarget as HTMLInputElement;
  const next=box.name==='shadow'||box.name==='soft'?{...light,shadow:{...light.shadow,[box.name==='shadow'?'enabled':'soft']:box.checked}}:{...light,[box.name]:box.checked};
  void commit(next,box);
 }
</script>
<fieldset class="light" disabled={disabled||!oncommit}>
 <Select label="Type" value={light.type} options={lightTypeOptions} onchange={event=>{const select=event.currentTarget;void commit(lightForType(select.value==='point'?'point':'directional',light),select);}}/>
 <form onsubmit={event=>{event.preventDefault();apply('color');}}><Input label="Color" bind:value={values.color} onchange={()=>apply('color')}/></form>
 <form onsubmit={event=>{event.preventDefault();apply('intensity');}}><Input label="Intensity" type="number" min={0} max={1000} step={0.1} bind:value={values.intensity} onchange={()=>apply('intensity')}/></form>
 {#if light.type==='point'}<form onsubmit={event=>{event.preventDefault();apply('range');}}><Input label="Range (m)" type="number" min={0} max={1000} step={0.5} bind:value={values.range} onchange={()=>apply('range')}/></form>{/if}
 <label class="visibility-control"><input type="checkbox" name="affectCharacters" checked={light.affectCharacters} onchange={toggle}/>Affect Characters</label>
 <label class="visibility-control"><input type="checkbox" name="affectProps" checked={light.affectProps} onchange={toggle}/>Affect Props</label>
 <label class="visibility-control"><input type="checkbox" name="affectEnvironment" checked={light.affectEnvironment} onchange={toggle}/>Affect Environment</label>
 <label class="visibility-control"><input type="checkbox" name="shadow" checked={light.shadow.enabled} onchange={toggle}/>Shadow</label>
 {#if light.shadow.enabled}
  <form onsubmit={event=>{event.preventDefault();apply('shadowIntensity');}}><Input label="Shadow Intensity" type="number" min={0} max={1} step={0.05} bind:value={values.shadowIntensity} onchange={()=>apply('shadowIntensity')}/></form>
  <label class="visibility-control"><input type="checkbox" name="soft" checked={light.shadow.soft} onchange={toggle}/>Soft Shadows</label>
  <form onsubmit={event=>{event.preventDefault();apply('bias');}}><Input label="Bias" type="number" min={-0.01} max={0.01} step={0.0001} bind:value={values.bias} onchange={()=>apply('bias')}/></form>
  <form onsubmit={event=>{event.preventDefault();apply('normalBias');}}><Input label="Normal Bias" type="number" min={0} max={1} step={0.01} bind:value={values.normalBias} onchange={()=>apply('normalBias')}/></form>
 {/if}
 {#if light.type==='directional'}<div class="light-actions"><Button variant="secondary" disabled={disabled||!ondirection} onclick={()=>{void ondirection?.(entityId,revision);}}>Set Direction From Main Camera</Button></div>{/if}
</fieldset>
<style>.light{border:0;padding:12px 0 0;margin:0;min-width:0;display:grid;gap:8px}.light-actions{padding-top:4px}</style>
