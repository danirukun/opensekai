<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input,Select} from '@oshi-connect/ui';
 import type {Reply,TrackingConfig,TrackingStatus} from '@opensekai/contracts';
 import {parseTrackingConfig,reconcileDraft,matchingStatus,initialTrackingDraft,type Commit} from '../editor/live-fields';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {marks=NO_MARKS,entityId,config,generation,revision,disabled=false,oncommit,ontoggle,statuses=[],localAddresses=[],devices=[],calibrated=false,oncalibrate,onresetcalibration}:{marks?:ResetMarks;calibrated?:boolean;oncalibrate?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>;onresetcalibration?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>;entityId:string;config:TrackingConfig;generation:number;revision:number;disabled?:boolean;oncommit?:Commit<TrackingConfig>;ontoggle?:(id:string,enabled:boolean,revision:number)=>Promise<unknown>;statuses?:TrackingStatus[];localAddresses?:string[];devices?:{deviceId:string;label:string}[]}=$props();
 const base=()=>initialTrackingDraft(config);
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 const status=$derived(matchingStatus(statuses,entityId,generation));
 const deviceId=$derived(draft.config.kind==='mediapipe'?draft.config.deviceId:'');
 const options=$derived([{value:'',label:'Default camera'},...devices.filter(device=>device.deviceId!=='').map(device=>({value:device.deviceId,label:device.label||'Camera'})),...(deviceId&&!devices.some(device=>device.deviceId===deviceId)?[{value:deviceId,label:'Unavailable camera'}]:[])]);
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 // The VMC sender calibrates, so only phone and webcam sources show Calibrate (B6 R7).
 const calibrates=$derived(config.kind!=='vmc');
 let calibrationError=$state<{entityId:string;message:string}|null>(null);
 async function calibration(send?:(id:string,revision:number)=>Promise<Reply<unknown>|undefined>){calibrationError=null;const reply=await send?.(entityId,revision);if(reply&&!reply.ok)calibrationError={entityId,message:reply.error.message};}
 // A reset sends the scene config with one field at its default and discards the unsaved text of the form (B17 R7).
 function reset(id:string){
  const value=marks.defaults[id];
  const next=config.kind==='mediapipe'?{...config,[id]:value===true}:id==='address'?{...config,[config.kind==='vmc'?'senderAddress':'phoneAddress']:value}:{...config,[id]:value};
  void oncommit?.(entityId,next as TrackingConfig,revision);
 }
 function apply(){const parsed=parseTrackingConfig(draft.config,draft);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
</script>
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={disabled||!oncommit}>
 {#snippet mark(id:string,label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
 {#if draft.config.kind==='mediapipe'}<Select label="Camera" bind:value={draft.config.deviceId} {options}/>{#each [['face','Face'],['upperBody','Upper body'],['hands','Hands'],['mirror','Mirror']] as const as [option,label]}<div class="resettable"><label class="option"><input type="checkbox" checked={draft.config[option]} onchange={event=>{if(draft.config.kind==='mediapipe')draft.config[option]=event.currentTarget.checked;}}/>{label}</label>{@render mark(option,label)}</div>{/each}
 {:else}{@const addressLabel=draft.config.kind==='vmc'?'Sender address':'Phone address'}<div class="resettable"><Input label="Bind address" bind:value={draft.bindAddress}/>{@render mark('bindAddress','Bind address')}</div><div class="resettable"><Input label="Port" bind:value={draft.port}/>{@render mark('port','Port')}</div><div class="resettable"><Input label={addressLabel} bind:value={draft.address}/>{@render mark('address',addressLabel)}</div>{/if}<Button type="submit" variant="ghost">Apply</Button></fieldset></form>
 {#if config.kind==='ifacialmocap'&&localAddresses.length}<dl class="addresses"><dt>Computer address</dt><dd>{#each localAddresses as address}<span>{address}</span>{/each}</dd></dl>{/if}
 <div class="runtime"><Button disabled={disabled||!ontoggle} onclick={()=>{void ontoggle?.(entityId,!config.enabled,revision);}}>{config.enabled?'Stop':'Start'}</Button>{#if status}<span>{status.state}</span>{:else if !config.enabled}<span>stopped</span>{/if}{#if calibrates}<Button variant="secondary" disabled={disabled||!oncalibrate||status?.state!=='receiving'} onclick={()=>calibration(oncalibrate)}>Calibrate</Button>{#if calibrated}<Button variant="ghost" disabled={disabled||!onresetcalibration} onclick={()=>calibration(onresetcalibration)}>Reset</Button>{/if}{/if}</div>
 {#if invalid}<p role="alert">Use a valid address and port. Enable a tracking channel to start.</p>{/if}{#if status?.state==='error'&&status.error}<p role="alert">{status.error}</p>{/if}{#if calibrationError?.entityId===entityId}<p role="alert">{calibrationError.message}</p>{/if}
<style>form{padding:0 0 16px}fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}.option{display:flex;gap:8px;align-items:center;font-size:12px}.runtime{display:flex;gap:12px;align-items:center;font-size:12px;padding-bottom:20px}p[role=alert]{margin:0 0 16px;font-size:12px}.addresses{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0 0 16px;font-size:12px}.addresses dt{color:#85818f}.addresses dd{display:grid;gap:4px;margin:0;font-variant-numeric:tabular-nums;color:#4f4a59;user-select:text}</style>
