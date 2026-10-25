<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input,Select} from '@oshi-connect/ui';
 import type {Reply,SceneEntity,VmcSenderSettings,VmcSenderStatus} from '@opensekai/contracts';
 import {reconcileDraft} from '../editor/live-fields';
 import {parseVmcSender} from '../editor/vmc-sender';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 let {marks=NO_MARKS,entityId,settings,entities,revision,disabled=false,status,oncommit}:{marks?:ResetMarks;entityId:string;settings:VmcSenderSettings;entities:readonly SceneEntity[];revision:number;disabled?:boolean;status?:VmcSenderStatus;oncommit?:(id:string,settings:VmcSenderSettings,revision:number)=>Promise<Reply<unknown>|undefined>}=$props();
 const base=()=>({address:settings.address,port:String(settings.port)});
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 const characters=$derived([{value:'',label:'None'},...entities.filter(entity=>entity.kind==='avatar').map(entity=>({value:entity.id,label:entity.name}))]);
 const commit=(next:VmcSenderSettings)=>oncommit?.(entityId,next,revision);
 function apply(){const parsed=parseVmcSender(settings,draft);invalid=!parsed;if(parsed)void commit(parsed);}
 // A reset commits the scene settings with one field at its default and discards the unsaved text (B17 R7).
 const reset=(id:'address'|'port')=>{void commit({...settings,[id]:marks.defaults[id]});};
</script>
{#snippet mark(id:'address'|'port',label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
<form onsubmit={event=>{event.preventDefault();apply();}}><fieldset disabled={disabled||!oncommit}>
 <div class="resettable"><Input label="IP Address" bind:value={draft.address}/>{@render mark('address','IP Address')}</div>
 <div class="resettable"><Input label="Port" bind:value={draft.port}/>{@render mark('port','Port')}</div>
 <Button type="submit" variant="ghost">Apply</Button>
 <Select label="Character" value={settings.avatarId??''} options={characters} disabled={disabled||!oncommit} onchange={async event=>{const select=event.currentTarget;const reply=await commit({...settings,avatarId:select.value||null});if(!reply?.ok)select.value=settings.avatarId??'';}}/>
</fieldset></form>
<div class="runtime"><Button disabled={disabled||!oncommit} onclick={()=>{void commit({...settings,enabled:!settings.enabled});}}>{settings.enabled?'Stop':'Start'}</Button><span>{status?.state??(settings.enabled?'waiting':'stopped')}</span></div>
{#if invalid}<p role="alert">Use a valid address and port.</p>{/if}{#if status?.state==='error'&&status.error}<p role="alert">{status.error}</p>{/if}
<style>form{padding:0 0 16px}fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}.runtime{display:flex;gap:12px;align-items:center;font-size:12px;padding-bottom:20px}p[role=alert]{margin:0 0 16px;font-size:12px}</style>
