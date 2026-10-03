<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input,Select} from '@oshi-connect/ui';
 import type {TrackingConfig,TrackingStatus} from '@opensekai/contracts';
 import {parseTrackingConfig,reconcileDraft,matchingStatus,type Commit} from '../editor/live-fields';
 let {entityId,config,generation,revision,disabled=false,oncommit,ontoggle,statuses=[],devices=[]}:{entityId:string;config:TrackingConfig;generation:number;revision:number;disabled?:boolean;oncommit?:Commit<TrackingConfig>;ontoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>;statuses?:TrackingStatus[];devices?:{deviceId:string;label:string}[]}=$props();
 const base=()=>({config:structuredClone(config),bindAddress:config.kind==='mediapipe'?'':config.bindAddress,port:config.kind==='mediapipe'?'':String(config.port),address:config.kind==='vmc'?config.senderAddress??'':config.kind==='ifacialmocap'?config.phoneAddress??'':''});
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 const status=$derived(matchingStatus(statuses,entityId,generation));
 const deviceId=$derived(draft.config.kind==='mediapipe'?draft.config.deviceId:'');
 const options=$derived([{value:'',label:'Default camera'},...devices.filter(device=>device.deviceId!=='').map(device=>({value:device.deviceId,label:device.label||'Camera'})),...(deviceId&&!devices.some(device=>device.deviceId===deviceId)?[{value:deviceId,label:'Unavailable camera'}]:[])]);
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 function apply(){const parsed=parseTrackingConfig(draft.config,draft);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
</script>
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={disabled||!oncommit}>
 {#if draft.config.kind==='mediapipe'}<Select label="Camera" bind:value={draft.config.deviceId} {options}/>{#each ['face','upperBody','hands','mirror'] as option}<label class="option"><input type="checkbox" checked={draft.config[option as 'face'|'upperBody'|'hands'|'mirror']} onchange={event=>{if(draft.config.kind==='mediapipe')draft.config[option as 'face'|'upperBody'|'hands'|'mirror']=event.currentTarget.checked;}}/>{({face:'Face',upperBody:'Upper body',hands:'Hands',mirror:'Mirror'})[option]}</label>{/each}
 {:else}<Input label="Bind address" bind:value={draft.bindAddress}/><Input label="Port" bind:value={draft.port}/><Input label={draft.config.kind==='vmc'?'Sender address':'Phone address'} bind:value={draft.address}/>{/if}<Button type="submit" variant="ghost">Apply</Button></fieldset></form>
 <div class="runtime"><Button disabled={disabled||!ontoggle} onclick={()=>{void ontoggle?.(entityId,!config.enabled,revision);}}>{config.enabled?'Stop':'Start'}</Button>{#if status}<span>{status.state}</span>{:else if !config.enabled}<span>stopped</span>{/if}</div>
 {#if invalid}<p role="alert">Use a valid address and port. Enable a tracking channel to start.</p>{/if}{#if status?.state==='error'&&status.error}<p role="alert">{status.error}</p>{/if}
<style>form{padding:12px 0}fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}.option{display:flex;gap:8px;align-items:center;font-size:12px}.runtime{display:flex;gap:10px;align-items:center;font-size:12px}</style>
