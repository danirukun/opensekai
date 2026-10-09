<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 let {label,status=null,importing=false,disabled=false,onchoose}:{label:string;status?:AssetLoadStatus|null;importing?:boolean;disabled?:boolean;onchoose:()=>void}=$props();
</script>
<div class="model-field">
 <span class="model-label">Model</span>
 <Button variant="secondary" class="model-choice" disabled={disabled||importing} onclick={onchoose}>{label}</Button>
 {#if importing}<div class="model-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="model-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}<progress max="1" value={status.progress??undefined} aria-label={stageLabel(status)}></progress>{/if}</div>{/if}
</div>
<style>
 .model-field{display:grid;gap:6px;padding:12px 0;border-bottom:1px solid #e1dee6}.model-label{font-size:12px;color:#85818f}
 .model-field :global(.model-choice){justify-content:flex-start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .model-status{display:grid;gap:4px;font-size:11px;color:#85818f}.model-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
</style>
