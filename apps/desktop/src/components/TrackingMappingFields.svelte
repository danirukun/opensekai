<script lang="ts">
 import {untrack} from 'svelte';
 import {Button,Input} from '@oshi-connect/ui';
 import {ARKIT_NAMES,type TrackingMapping} from '@opensekai/contracts';
 import {mappingDraft,parseMappingDraft,reconcileDraft,type Commit,type RangeDraft} from '../editor/live-fields';
 let {entityId,mapping,revision,disabled=false,oncommit}:{entityId:string;mapping?:TrackingMapping;revision:number;disabled?:boolean;oncommit?:Commit<TrackingMapping>}=$props();
 const base=()=>mappingDraft(mapping);
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 const ranged=()=>new Set(Object.keys(mapping?.blendShapes??{}));
 // Each change commits one setTrackingMapping (B6 R11). A row commits a range only when it changes.
 function commit(ranges=ranged()){const parsed=parseMappingDraft(draft,ranges);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
 const without=(name:string)=>{const ranges=ranged();ranges.delete(name);return ranges;};
 const columns:[keyof RangeDraft,string][]=[['inputMin','Input min'],['inputMax','Input max'],['outputMin','Output min'],['outputMax','Output max']];
</script>
<fieldset class="face" disabled={disabled||!oncommit}>
 <legend>Face</legend>
 <div class="pair"><Input label="Head intensity" bind:value={draft.headIntensity} onchange={()=>commit()}/><Input label="Eye intensity" bind:value={draft.eyeIntensity} onchange={()=>commit()}/></div>
 <div class="offset">{#each ['X','Y','Z'] as axis,index}<Input label={`Head offset ${axis} (°)`} bind:value={draft.headOffset[index]!} onchange={()=>commit()}/>{/each}</div>
 <Input label="Sensitivity" bind:value={draft.blendShapeSensitivity} onchange={()=>commit()}/>
 <label class="option"><input type="checkbox" bind:checked={draft.linkedBlink} onchange={()=>commit()}/>Linked blink</label>
 <details>
  <summary>Blend shapes</summary>
  <div class="rows" role="table" aria-label="Blend shapes">
   <div class="row head" role="row">{#each columns as [,label]}<span role="columnheader">{label}</span>{/each}<span role="columnheader"></span></div>
   {#each ARKIT_NAMES as name}
    <div class="row" role="row"><span role="rowheader">{name}</span>{#each columns as [field,label]}<span role="cell"><label class="hidden" for={`${entityId}-${name}-${field}`}>{name} {label}</label><Input id={`${entityId}-${name}-${field}`} bind:value={draft.blendShapes[name]![field]} onchange={()=>commit(new Set([...ranged(),name]))}/></span>{/each}<span role="cell">{#if mapping?.blendShapes[name]}<Button type="button" variant="ghost" onclick={()=>commit(without(name))}>Reset</Button>{/if}</span></div>
   {/each}
  </div>
 </details>
 {#if invalid}<p role="alert">Use intensity 0–2, offset −90–90, sensitivity 0–3, and ranges in 0–1 with min below max.</p>{/if}
</fieldset>
<style>
 fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}
 legend{font-size:12px;margin-bottom:8px}
 .pair,.offset{display:grid;gap:8px}.pair{grid-template-columns:1fr 1fr}.offset{grid-template-columns:1fr 1fr 1fr}
 .pair :global(input),.offset :global(input),.row :global(input){min-width:0;width:100%}
 .option{display:flex;gap:8px;align-items:center;font-size:12px}
 summary{font-size:12px;color:#78717f;cursor:pointer;padding:4px 0}
 .rows{display:grid;gap:4px;padding-top:6px}
 .row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) 56px;gap:4px;align-items:center;font-size:11px}
 .row [role=rowheader]{grid-column:1/-1;color:#4f4a59;padding-top:4px}
 .row.head{color:#85818f}
 .row span{min-width:0}
 .hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
 p[role=alert]{margin:0;font-size:12px}
</style>
