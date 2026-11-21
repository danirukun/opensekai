<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import {MaterialColorSchema,withMaterialValue,type AssetMaterial,type MaterialParameter,type MaterialValues,type Reply} from '@opensekai/contracts';
 import {materialChoices,materialRows} from '../editor/materials';
 import ColorField from './ColorField.svelte';
 import SliderField from './SliderField.svelte';
 import ResetMark from './ResetMark.svelte';
 // B38 R29: the saved material values of a character or a prop. Each edit sends the whole group with `setMaterialValues`.
 type Group=Record<string,MaterialValues>;
 let {entityId,record,saved,revision,disabled=false,resetDisabled=disabled,oncommit,onlive,onliveend}:{entityId:string;record:readonly AssetMaterial[]|undefined;saved:Readonly<Group>|undefined;revision:number;disabled?:boolean;resetDisabled?:boolean;oncommit:(id:string,materials:Group,revision:number)=>Promise<Reply<unknown>|undefined>;onlive?:(id:string,materials:Group)=>void;onliveend?:()=>void}=$props();
 const choices=$derived(materialChoices(record,saved));
 let selected=$state<string|null>(null);
 const name=$derived(choices.some(choice=>choice.value===selected)?selected!:choices[0]?.value??null);
 const rows=$derived(name===null?[]:materialRows(record,saved,name));
 const group=(parameter:MaterialParameter,value:string|number|null)=>withMaterialValue(saved,name!,parameter,value);
 // The kit picker can give upper case; a saved color is #rrggbb in lower case.
 const color=(value:string)=>{const next=value.toLowerCase();return MaterialColorSchema.safeParse(next).success?next:null;};
 const commit=(parameter:MaterialParameter,value:string|number|null)=>{void oncommit(entityId,group(parameter,value),revision);};
 const live=(parameter:MaterialParameter,value:string|number)=>onlive?.(entityId,group(parameter,value));
</script>
<div class="materials">
 {#if choices.length>0}<Select label="Material" value={name??''} options={choices} {disabled} onchange={event=>{selected=event.currentTarget.value;}}/>{/if}
 {#each rows as row (`${name}\0${row.parameter}`)}
  <div class="resettable">
   {#if typeof row.value==='string'}
    <ColorField label={row.label} value={row.value} disabled={disabled||row.readOnly} onlive={value=>{const next=color(value);if(next)live(row.parameter,next);}} onend={onliveend} oncommit={value=>{const next=color(value);if(next)commit(row.parameter,next);}}/>
   {:else if row.range}
    <SliderField label={row.label} value={row.value} range={row.range} disabled={disabled||row.readOnly} onlive={value=>live(row.parameter,value)} onend={onliveend} oncommit={value=>commit(row.parameter,value)}/>
   {/if}
   {#if row.saved}<ResetMark label={row.label} disabled={resetDisabled} onreset={()=>commit(row.parameter,null)}/>{/if}
  </div>
 {/each}
</div>
<!-- The mark sits at the right of the label row, as in the paired fields: the left place is outside a narrow Inspector column. -->
<style>.materials{display:grid;gap:10px;min-width:0}.materials>.resettable>:global(.reset-mark){left:auto;right:0}</style>
