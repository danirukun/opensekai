<script lang="ts">
 import {untrack} from 'svelte';
 import {Input} from '@oshi-connect/ui';
 import {ARKIT_NAMES,DEFAULT_TRACKING_MAPPING,type TrackingMapping} from '@opensekai/contracts';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {mappingDraft,parseMappingDraft,reconcileDraft,type Commit,type RangeDraft} from '../editor/live-fields';
 let {entityId,mapping,revision,disabled=false,marks=NO_MARKS,oncommit}:{marks?:ResetMarks;entityId:string;mapping?:TrackingMapping;revision:number;disabled?:boolean;oncommit?:Commit<TrackingMapping>}=$props();
 const base=()=>mappingDraft(mapping);
 let draft=$state(untrack(base)),invalid=$state(false);let key:string|null=null;
 $effect(()=>{const next=reconcileDraft(key,{entityId,revision},untrack(()=>draft),base());if(next.key!==key){draft=next.values;invalid=false;}key=next.key;});
 const ranged=()=>new Set(Object.keys(mapping?.blendShapes??{}));
 // Each change commits one setTrackingMapping (B6 R11). A row commits a range only when it changes.
 function commit(ranges=ranged()){const parsed=parseMappingDraft(draft,ranges);invalid=!parsed;if(parsed)void oncommit?.(entityId,parsed,revision);}
 // A reset sends the scene mapping with one field at its default and discards the unsaved text of the group (B17 R7).
 const scene=()=>structuredClone($state.snapshot(mapping)??DEFAULT_TRACKING_MAPPING) as TrackingMapping;
 function reset(id:string){
  const next=scene(),value=marks.defaults[id];
  if(id.startsWith('headOffset'))next.headOffset['XYZ'.indexOf(id.at(-1)!)]=Number(value);
  else if(id==='linkedBlink')next.linkedBlink=value===true;
  else (next as unknown as Record<string,number>)[id]=Number(value);
  void oncommit?.(entityId,next,revision);
 }
 function resetRange(name:string){const next=scene();delete next.blendShapes[name as keyof TrackingMapping['blendShapes']];void oncommit?.(entityId,next,revision);}
 const columns:[keyof RangeDraft,string][]=[['inputMin','Input min'],['inputMax','Input max'],['outputMin','Output min'],['outputMax','Output max']];
</script>
<fieldset class="face" disabled={disabled||!oncommit}>
 {#snippet mark(id:string,label:string)}{#if marks.changed.has(id)}<ResetMark {label} disabled={marks.disabled} onreset={()=>reset(id)}/>{/if}{/snippet}
 <div class="pair"><div class="resettable"><Input label="Head intensity" bind:value={draft.headIntensity} onchange={()=>commit()}/>{@render mark('headIntensity','Head intensity')}</div><div class="resettable"><Input label="Eye intensity" bind:value={draft.eyeIntensity} onchange={()=>commit()}/>{@render mark('eyeIntensity','Eye intensity')}</div></div>
 <div class="offset">{#each ['X','Y','Z'] as axis,index}<div class="resettable"><Input label={`Head offset ${axis} (°)`} bind:value={draft.headOffset[index]!} onchange={()=>commit()}/>{@render mark(`headOffset${axis}`,`Head offset ${axis} (°)`)}</div>{/each}</div>
 <div class="resettable"><Input label="Sensitivity" bind:value={draft.blendShapeSensitivity} onchange={()=>commit()}/>{@render mark('blendShapeSensitivity','Sensitivity')}</div>
 <div class="resettable"><label class="option"><input type="checkbox" bind:checked={draft.linkedBlink} onchange={()=>commit()}/>Linked blink</label>{@render mark('linkedBlink','Linked blink')}</div>
 <label class="option"><input type="checkbox" bind:checked={draft.useEyeBones} onchange={()=>commit()}/>Use bones for eye movement</label>
 <details>
  <summary>Blend shapes</summary>
  <div class="rows" role="table" aria-label="Blend shapes">
   <div class="row head" role="row">{#each columns as [,label]}<span role="columnheader">{label}</span>{/each}<span role="columnheader"></span></div>
   {#each ARKIT_NAMES as name}
    <div class="row" role="row"><span role="rowheader">{name}</span>{#each columns as [field,label]}<span role="cell"><label class="hidden" for={`${entityId}-${name}-${field}`}>{name} {label}</label><Input id={`${entityId}-${name}-${field}`} bind:value={draft.blendShapes[name]![field]} onchange={()=>commit(new Set([...ranged(),name]))}/></span>{/each}<span role="cell">{#if mapping?.blendShapes[name]}<ResetMark label={name} disabled={marks.disabled} onreset={()=>resetRange(name)}/>{/if}</span></div>
   {/each}
  </div>
 </details>
 {#if invalid}<p role="alert">Use intensity 0–2, offset −90–90, sensitivity 0–3, and ranges in 0–1 with min below max.</p>{/if}
</fieldset>
<style>
 fieldset{display:grid;gap:10px;border:0;padding:0;margin:0;min-width:0}
 .pair,.offset{display:grid;gap:8px}.pair{grid-template-columns:1fr 1fr}.offset{grid-template-columns:1fr 1fr 1fr}
 .pair :global(input),.offset :global(input),.row :global(input){min-width:0;width:100%}
 .option{display:flex;gap:8px;align-items:center;font-size:12px}
 summary{font-size:12px;color:#78717f;cursor:pointer;padding:4px 0}
 .rows{display:grid;gap:4px;padding-top:6px}
 .row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) 28px;gap:4px;align-items:center;font-size:11px}
 .row [role=rowheader]{grid-column:1/-1;color:#4f4a59;padding-top:4px}
 .row.head{color:#85818f}
 .row span{min-width:0}
 .hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
 p[role=alert]{margin:0;font-size:12px}
</style>
