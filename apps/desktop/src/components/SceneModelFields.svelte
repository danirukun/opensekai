<script lang="ts">
 import {Button,Select} from '@oshi-connect/ui';
 import type {AssetRecord,Reply} from '@opensekai/contracts';
 import {SLIDERS} from '../editor/slider';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import {stageLabel} from '../editor/load-status';
 import {creditLine,sceneSourceOptions,sourceAction} from '../editor/environment';
 let {marks=NO_MARKS,assetId,assets,status=null,importing=false,error=null,disabled=false,onselect,onimport,reflectionsIntensity=1,reflectionsDisabled=false,onreflections,onreflectionslive,onliveend}:{marks?:ResetMarks;assetId:string|null;assets:readonly AssetRecord[];status?:AssetLoadStatus|null;importing?:boolean;error?:string|null;disabled?:boolean;onselect:(assetId:string|null)=>void;onimport:()=>void;reflectionsIntensity?:number;reflectionsDisabled?:boolean;onreflections?:(value:number)=>Promise<Reply<unknown>>;onreflectionslive?:(value:number)=>void;onliveend?:()=>void}=$props();
 const credits=$derived(assets.find(asset=>asset.id===assetId)?.credits);
 const line=$derived(credits?creditLine(credits):null);
 let reset=$state(0),copied=$state(false);
 $effect(()=>{void assetId;copied=false;});
 function change(value:string){const action=sourceAction(value);reset++;if(action.kind==='import')onimport();else onselect(action.assetId);}
 async function copy(){if(!line)return;try{await navigator.clipboard.writeText(line);copied=true;}catch{copied=false;}}
</script>
<div class="scene-model-source">
 {#key `${assetId}:${reset}`}<Select label="Source" value={assetId??''} options={sceneSourceOptions(assetId,assets)} disabled={disabled||importing} onchange={event=>change(event.currentTarget.value)}/>{/key}
 {#if importing}<div class="source-status"><span>Importing…</span><progress max="1" aria-label="Importing…"></progress></div>
 {:else if status}<div class="source-status" class:failed={status.stage==='failed'}><span>{stageLabel(status)}</span>{#if status.stage!=='failed'}{#if status.progress===null}<progress max="1" aria-label={stageLabel(status)}></progress>{:else}<progress max="1" value={status.progress} aria-label={stageLabel(status)}></progress>{/if}{/if}</div>{/if}
 {#if error}<p class="source-status failed" role="alert">{error}</p>{/if}
 {#if onreflections}<div class="resettable"><SliderField label="Reflections Intensity" value={reflectionsIntensity} range={SLIDERS.reflections} disabled={reflectionsDisabled} onlive={onreflectionslive} onend={onliveend} oncommit={value=>{void onreflections?.(value);}}/>{#if marks.changed.has('reflectionsIntensity')}<ResetMark label="Reflections Intensity" disabled={marks.disabled||reflectionsDisabled} onreset={()=>{void onreflections?.(Number(marks.defaults.reflectionsIntensity));}}/>{/if}</div>{/if}
 {#if credits&&line}<dl class="credits">{#if credits.title}<dt>Title</dt><dd>{credits.title}</dd>{/if}{#if credits.author}<dt>Author</dt><dd>{credits.author}</dd>{/if}{#if credits.license}<dt>License</dt><dd>{credits.license}</dd>{/if}</dl><Button variant="ghost" onclick={copy}>{copied?'Copied':'Copy credit'}</Button>{/if}
</div>
<style>
 .scene-model-source{display:grid;gap:8px}
 .source-status{display:grid;gap:4px;font-size:11px;color:#85818f;margin:0}.source-status.failed{color:#b14050}progress{width:100%;height:5px;accent-color:#8571ac}
 .credits{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px}.credits dt{color:#85818f}.credits dd{margin:0;overflow-wrap:anywhere}
</style>
