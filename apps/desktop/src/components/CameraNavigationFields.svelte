<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import type {CameraNavigation,Reply,SceneEntity} from '@opensekai/contracts';
 import {controlModeOptions,focusOptions,navigationForMode,type ControlMode} from '../editor/cameras';
 import {SLIDERS} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 let {entityId,navigation,entities,revision,disabled=false,oncommit,onlive,onliveend}:{entityId:string;navigation:CameraNavigation|undefined;entities:readonly SceneEntity[];revision:number;disabled?:boolean;oncommit?:(id:string,navigation:CameraNavigation,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,navigation:CameraNavigation)=>void;onliveend?:()=>void}=$props();
 const current=$derived<CameraNavigation>(navigation??{mode:'none'});
 const withSensitivity=(value:number):CameraNavigation|null=>current.mode==='none'?null:{...current,sensitivity:value};
 // A rejected change leaves the scene value as it was; put it back in the control.
 async function commit(next:CameraNavigation,control?:HTMLSelectElement,previous?:string){const reply=await oncommit?.(entityId,next,revision);if(!reply?.ok&&control&&previous!==undefined)control.value=previous;}
</script>
<fieldset class="navigation" disabled={disabled||!oncommit}>
 <Select label="Control Mode" value={current.mode} options={controlModeOptions} onchange={event=>{const select=event.currentTarget;void commit(navigationForMode(select.value as ControlMode,navigation,entities),select,current.mode);}}/>
 {#if current.mode==='orbitCharacter'}<Select label="Focus Character" value={current.targetId??''} options={focusOptions(entities)} onchange={event=>{const select=event.currentTarget;if(current.mode!=='orbitCharacter')return;void commit({...current,targetId:select.value||null},select,current.targetId??'');}}/>{/if}
 {#if current.mode!=='none'}<SliderField label="Control Sensitivity" value={current.sensitivity} range={SLIDERS.sensitivity} {disabled} onlive={value=>{const next=withSensitivity(value);if(next)onlive?.(entityId,next);}} onend={onliveend} oncommit={value=>{const next=withSensitivity(value);if(next)void commit(next);}}/>{/if}
</fieldset>
<style>.navigation{border:0;padding:12px 0 0;margin:0;min-width:0;display:grid;gap:8px}</style>
