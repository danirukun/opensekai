<script lang="ts">
 import {untrack} from 'svelte';
 import {ChevronRight} from '@lucide/svelte';
 import type {TrackingConfig,TrackingSmoothing,TrackingStatus} from '@opensekai/contracts';
 import TrackingSmoothingFields from './TrackingSmoothingFields.svelte';
 import {nextPacketRate,type PacketRate} from '../editor/tracking-diagnostics';
 import type {Commit} from '../editor/live-fields';
 let {entityId,kind,smoothing,generation,status,revision,disabled=false,oncommit,onlive,onliveend}:{entityId:string;kind:TrackingConfig['kind'];smoothing?:TrackingSmoothing;generation:number;status?:TrackingStatus;revision:number;disabled?:boolean;oncommit?:Commit<TrackingSmoothing>;onlive?:(id:string,smoothing:TrackingSmoothing)=>void;onliveend?:()=>void}=$props();
 let rate=$state<PacketRate|null>(null);
 $effect(()=>{const next=status;rate=next?nextPacketRate(untrack(()=>rate),next,performance.now()):null;});
 const unknown='—';
 const rows=$derived([
  ['State',status?.state??'stopped'],
  ['Generation',String(generation)],
  ['Packets',status?String(status.packets):unknown],
  ['Invalid packets',status?String(status.invalidPackets):unknown],
  ['Packet rate',rate?.perSecond!=null?`${rate.perSecond.toFixed(1)}/s`:unknown],
  ...(kind==='mediapipe'?[['Inference',status?.inferenceMs!==undefined?`${status.inferenceMs.toFixed(1)} ms`:unknown]]:[]),
 ]);
</script>
<details class="advanced">
 <summary><ChevronRight size={14}/>Advanced</summary>
 <div class="body">
  <TrackingSmoothingFields {entityId} {smoothing} {revision} {disabled} {oncommit} {onlive} {onliveend}/>
  <section aria-label="Diagnostics"><h4>Diagnostics</h4><dl>{#each rows as [term,value]}<dt>{term}</dt><dd>{value}</dd>{/each}</dl></section>
 </div>
</details>
<style>
 .advanced{border-top:1px solid #e1dee6}
 summary{display:flex;align-items:center;gap:6px;padding:14px 0;font-size:12px;color:#78717f;cursor:pointer;list-style:none;user-select:none}
 summary::-webkit-details-marker{display:none}
 summary:focus{outline:none}
 summary:focus-visible{outline:2px solid #8571ac;outline-offset:2px;border-radius:4px}
 summary :global(svg){transition:transform .15s}
 details[open] summary :global(svg){transform:rotate(90deg)}
 .body{display:grid;gap:24px;padding:6px 0 24px 20px}
 h4{font-size:12px;font-weight:400;color:#78717f;margin:0 0 10px}
 dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:12px}
 dt{color:#85818f}
 dd{margin:0;font-variant-numeric:tabular-nums;color:#4f4a59}
</style>
