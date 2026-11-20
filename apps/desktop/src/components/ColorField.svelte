<script lang="ts">
 import {untrack} from 'svelte';
 import {ColorPicker} from '@oshi-connect/ui';
 let {label,value,disabled=false,onlive,onend,oncommit}:{label:string;value:string;disabled?:boolean;onlive?:(value:string)=>void;onend?:()=>void;oncommit?:(value:string)=>void}=$props();
 // `picked` is the last live color of a gesture. After the end, the picker shows it for 500 ms or until the next scene update,
 // so a late scene update does not move it back (B12 R11).
 let picked=$state<string|null>(null),ended=false;
 let hold:ReturnType<typeof setTimeout>|undefined,check:ReturnType<typeof setTimeout>|undefined,resync:ReturnType<typeof setTimeout>|undefined;
 // A new key remounts the kit picker, so it shows the scene color after the host does not take a typed hex.
 let generation=$state(0);
 const shown=$derived(picked??value);
 const release=()=>{clearTimeout(hold);hold=undefined;picked=null;ended=false;};
 const finish=()=>{if(picked===null||ended)return;ended=true;onend?.();hold=setTimeout(release,500);};
 $effect(()=>{void value;untrack(()=>{clearTimeout(resync);if(ended)release();});});
 $effect(()=>()=>{clearTimeout(hold);clearTimeout(check);clearTimeout(resync);});
 // A live color after a pointer or key end cancels its pending check: the gesture goes on.
 function live(next:string){clearTimeout(hold);clearTimeout(check);hold=undefined;ended=false;picked=next;onlive?.(next);}
 // The kit calls onchange with the last live color at the end of a gesture, and with a typed hex.
 function change(next:string){
  if(picked!==null&&next===picked){finish();return;}
  release();oncommit?.(next);
  clearTimeout(resync);resync=setTimeout(()=>{if(untrack(()=>value)!==next)generation++;},1000);
 }
 // A gesture that ends on its start color calls no onchange: the end of the pointer or of the arrow key still ends the live edit.
 function settle(){clearTimeout(check);check=setTimeout(finish,0);}
 const settleKey=(event:KeyboardEvent)=>{if(event.key.startsWith('Arrow'))settle();};
</script>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="color-field" role="group" onpointerup={settle} onpointercancel={settle} onlostpointercapture={settle} onkeyup={settleKey}>
 {#key generation}<ColorPicker {label} value={shown} {disabled} oninput={live} onchange={change}/>{/key}
</div>
<style>.color-field{min-width:0}</style>
