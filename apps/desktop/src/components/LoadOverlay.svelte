<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 let {entries,names,ondismiss}:{entries:AssetLoadStatus[];names:Record<string,string>;ondismiss:(entityId:string)=>void}=$props();
</script>
{#if entries.length}
 <div class="load-overlay" role="status" aria-live="polite">
  <div class="load-card">
   {#each entries as entry (entry.entityId)}
    <div class="load-row">
     <div class="load-title">{names[entry.entityId]?`Loading ${names[entry.entityId]}`:'Loading'}</div>
     <div class="load-stage" class:failed={entry.stage==='failed'}>{stageLabel(entry)}</div>
     {#if entry.stage==='failed'}<Button variant="ghost" onclick={()=>ondismiss(entry.entityId)}>Dismiss</Button>
     {:else if entry.progress===null}<progress max="1" aria-label={stageLabel(entry)}></progress>
     {:else}<progress max="1" value={entry.progress} aria-label={stageLabel(entry)}></progress>{/if}
    </div>
   {/each}
  </div>
 </div>
{/if}
<style>
 .load-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:3}
 .load-card{pointer-events:auto;min-width:260px;max-width:min(360px,80%);display:grid;gap:14px;padding:16px 18px;background:#fafafd;border:1px solid #e3e1e9;border-radius:8px;box-shadow:0 6px 24px #0005}
 .load-row{display:grid;gap:6px}.load-title{font-size:13px;font-weight:600;color:#2b2833}.load-stage{font-size:12px;color:#85818f}.load-stage.failed{color:#b14050}
 progress{width:100%;height:6px;accent-color:#8571ac}
</style>
