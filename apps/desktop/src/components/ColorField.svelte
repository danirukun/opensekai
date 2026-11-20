<script lang="ts">
 import {untrack} from 'svelte';
 import {ColorPicker} from '@oshi-connect/ui';
 let {label,value,disabled=false,onlive,onend,oncommit}:{label:string;value:string;disabled?:boolean;onlive?:(value:string)=>void;onend?:()=>void;oncommit?:(value:string)=>void}=$props();
 // During a gesture, and for 500 ms after it, the picker shows the picked color, so a late scene update does not move it back (B12 R11).
 let picked=$state<string|null>(null);
 let timer:ReturnType<typeof setTimeout>|undefined,check:ReturnType<typeof setTimeout>|undefined;
 const shown=$derived(picked??value);
 const release=()=>{clearTimeout(timer);timer=undefined;picked=null;};
 const finish=()=>{onend?.();timer=setTimeout(release,500);};
 const gesture=()=>picked!==null&&timer===undefined;
 $effect(()=>{void value;untrack(()=>{if(timer!==undefined)release();});});
 $effect(()=>()=>{clearTimeout(timer);clearTimeout(check);});
 function live(next:string){clearTimeout(timer);timer=undefined;picked=next;onlive?.(next);}
 // The kit calls onchange for a typed hex and for the end of a gesture; only a gesture calls oninput first.
 function change(next:string){
  if(gesture()){finish();return;}
  release();oncommit?.(next);
 }
 // A gesture that ends on its start color calls no onchange, and it must still end the live edit.
 function settle(){clearTimeout(check);check=setTimeout(()=>{if(gesture())finish();},0);}
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="color-field" role="group" onpointerup={settle} onkeyup={settle}>
 <ColorPicker {label} value={shown} {disabled} oninput={live} onchange={change}/>
</div>
<style>.color-field{min-width:0}</style>
