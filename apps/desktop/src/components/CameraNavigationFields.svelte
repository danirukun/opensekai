<script lang="ts">
 import {Input,Select} from '@oshi-connect/ui';
 import type {CameraNavigation,Reply,SceneEntity} from '@opensekai/contracts';
 import {controlModeOptions,focusOptions,navigationForMode,parseSensitivity,type ControlMode} from '../editor/cameras';
 let {entityId,navigation,entities,revision,disabled=false,oncommit}:{entityId:string;navigation:CameraNavigation|undefined;entities:readonly SceneEntity[];revision:number;disabled?:boolean;oncommit?:(id:string,navigation:CameraNavigation,revision:number)=>Promise<Reply<unknown>|undefined>}=$props();
 const current=$derived<CameraNavigation>(navigation??{mode:'none'});
 let sensitivity=$state('');
 $effect(()=>{sensitivity=current.mode==='none'?'':String(current.sensitivity);});
 // A rejected change leaves the scene value as it was; put it back in the control.
 async function commit(next:CameraNavigation,control?:HTMLSelectElement,previous?:string){const reply=await oncommit?.(entityId,next,revision);if(!reply?.ok&&control&&previous!==undefined)control.value=previous;}
 function applySensitivity(){if(current.mode==='none')return;const value=parseSensitivity(sensitivity);if(value===null||value===current.sensitivity){sensitivity=String(current.sensitivity);return;}void commit({...current,sensitivity:value});}
</script>
<fieldset class="navigation" disabled={disabled||!oncommit}>
 <Select label="Control Mode" value={current.mode} options={controlModeOptions} onchange={event=>{const select=event.currentTarget;void commit(navigationForMode(select.value as ControlMode,navigation,entities),select,current.mode);}}/>
 {#if current.mode==='orbitCharacter'}<Select label="Focus Character" value={current.targetId??''} options={focusOptions(entities)} onchange={event=>{const select=event.currentTarget;if(current.mode!=='orbitCharacter')return;void commit({...current,targetId:select.value||null},select,current.targetId??'');}}/>{/if}
 {#if current.mode!=='none'}<form onsubmit={event=>{event.preventDefault();applySensitivity();}}><Input label="Control Sensitivity" type="number" min={0.1} max={10} step={0.1} bind:value={sensitivity} onchange={applySensitivity}/></form>{/if}
</fieldset>
<style>.navigation{border:0;padding:12px 0 0;margin:0;min-width:0;display:grid;gap:8px}</style>
