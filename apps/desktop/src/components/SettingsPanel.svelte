<script lang="ts">
 import {untrack} from 'svelte';
 import {Input} from '@oshi-connect/ui';
 import type {AppApi,YouTubeStatus} from '@opensekai/contracts';
 import {youtubeStatusText} from '../editor/youtube';
 let {api,youtube,disabled=false,onchange}:{api:AppApi|null;youtube?:YouTubeStatus;disabled?:boolean;onchange?:(status:YouTubeStatus)=>void}=$props();
 const stored=$derived(youtube?.link??'');
 let draft=$state(''),focused=$state(false),rejected=$state<string|null>(null),busy=$state(false);
 // The field follows changes of the stored link (an MCP client can change it) while the operator is not typing. A rejected text stays.
 $effect(()=>{const link=stored;untrack(()=>{if(!focused&&!busy)draft=link;});});
 async function commit(){
  if(!api||busy||draft.trim()===stored)return;
  busy=true;rejected=null;
  try{
   const reply=await api.integrationsSet({youtube:{link:draft.trim()||null}});
   if(reply.ok)onchange?.(reply.data);else rejected=reply.error.message;
  }catch{rejected='Network';}finally{busy=false;}
 }
</script>
<section class="settings-panel">
 <h2>Settings</h2>
 <h3>Integrations</h3>
 <form onsubmit={event=>{event.preventDefault();void commit();}} onfocusin={()=>{focused=true;}} onfocusout={()=>{focused=false;}}><fieldset disabled={disabled||!api}>
  <legend>YouTube</legend>
  <Input label="Stream link" bind:value={draft} onchange={()=>{void commit();}}/>
  <p class="status" role="status">{rejected===null?youtubeStatusText(youtube):`Error: ${rejected}`}</p>
 </fieldset></form>
</section>
<style>.settings-panel{padding:24px;flex:1;max-width:560px}.settings-panel h2{margin-bottom:24px}.settings-panel h3{font-size:11px;color:#9a93a5;margin-bottom:12px}fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;color:#78717f;margin-bottom:10px;padding:0}.status{margin:0;font-size:12px;color:#85818f}</style>
