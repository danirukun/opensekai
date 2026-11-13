<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import type {AssetRecord} from '@opensekai/contracts';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {stageLabel} from '../editor/load-status';
 import {sourceAction} from '../editor/environment';
 import {imageSourceOptions} from '../editor/screen';
 let {marks=NO_MARKS,assetId,assets,status=null,importing=false,error=null,disabled=false,onselect,onimport}:{marks?:ResetMarks;assetId:string|null;assets:readonly AssetRecord[];status?:AssetLoadStatus|null;importing?:boolean;error?:string|null;disabled?:boolean;onselect:(assetId:string|null)=>void;onimport:()=>void}=$props();
 let reset=$state(0);
 function change(value:string){const action=sourceAction(value);reset++;if(action.kind==='import')onimport();else onselect(action.assetId);}
</script>
<div class="screen-image">
 <div class="resettable">{#key `${assetId}:${reset}`}<Select label="Image" value={assetId??''} options={imageSourceOptions(assetId,assets)} disabled={disabled||importing} onchange={event=>change(event.currentTarget.value)}/>{/key}{#if marks.changed.has('image')}<ResetMark label="Image" disabled={marks.disabled||disabled||importing} onreset={()=>onselect(null)}/>{/if}</div>
 {#if importing}<div class="source-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="source-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}{#if status.progress===null}<progress max="1" aria-label={stageLabel(status)}></progress>{:else}<progress max="1" value={status.progress} aria-label={stageLabel(status)}></progress>{/if}{/if}</div>{/if}
 {#if error}<p class="source-status failed" role="alert">{error}</p>{/if}
</div>
<style>
 .screen-image{display:grid;gap:8px}
 .source-status{display:grid;gap:4px;font-size:11px;color:var(--ds-color-text-muted);margin:0}.source-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
</style>
