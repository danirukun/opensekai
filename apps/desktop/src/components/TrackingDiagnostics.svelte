<script lang="ts">
 import {untrack} from 'svelte';
 import type {TrackingConfig,TrackingStatus} from '@opensekai/contracts';
 import {nextPacketRate,type PacketRate} from '../editor/tracking-diagnostics';
 let {kind,generation,status}:{kind:TrackingConfig['kind'];generation:number;status?:TrackingStatus}=$props();
 let rate=$state<PacketRate|null>(null);
 $effect(()=>{const next=status;rate=next?nextPacketRate(untrack(()=>rate),next,performance.now()):null;});
 const unknown='—';
 const rows=$derived([
  ['State',status?.state??'stopped'],
  ['Generation',String(generation)],
  ['Packets',status?String(status.packets):unknown],
  ['Invalid packets',status?String(status.invalidPackets):unknown],
  ...(status?.unmatchedPackets?[['Unmatched packets',String(status.unmatchedPackets)]]:[]),
  ['Packet rate',rate?.perSecond!=null?`${rate.perSecond.toFixed(1)}/s`:unknown],
  ...(kind==='mediapipe'?[['Inference',status?.inferenceMs!==undefined?`${status.inferenceMs.toFixed(1)} ms`:unknown]]:[]),
 ]);
</script>
<dl>{#each rows as [term,value]}<dt>{term}</dt><dd>{value}</dd>{/each}</dl>
<style>
 dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0;font-size:12px}
 dt{color:#85818f}
 dd{margin:0;font-variant-numeric:tabular-nums;color:#4f4a59}
</style>
