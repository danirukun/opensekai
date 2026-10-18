<script lang="ts">
 import {untrack} from 'svelte';
 import {Input} from '@oshi-connect/ui';
 import {parseLightColor} from '../editor/lights';
 let {label,value,disabled=false,onlive,onend,oncommit}:{label:string;value:string;disabled?:boolean;onlive?:(value:string)=>void;onend?:()=>void;oncommit?:(value:string)=>void}=$props();
 // The native swatch opens the system color picker; while it changes, the field shows the picked color (B12 R11).
 let picked=$state<string|null>(null),text=$state(untrack(()=>value));
 let typing=false,settling=false,timer:ReturnType<typeof setTimeout>|undefined;
 const shown=$derived(picked??value);
 const release=()=>{settling=false;clearTimeout(timer);picked=null;if(!typing)text=value;};
 $effect(()=>{const next=value;untrack(()=>{if(settling)release();else if(picked===null&&!typing)text=next;});});
 $effect(()=>()=>clearTimeout(timer));
 function pick(event:Event&{currentTarget:HTMLInputElement}){
  const next=parseLightColor(event.currentTarget.value);
  if(next===null||next===shown)return;
  settling=false;clearTimeout(timer);picked=next;text=next;onlive?.(next);
 }
 function end(){if(picked===null||settling)return;settling=true;onend?.();clearTimeout(timer);timer=setTimeout(release,500);}
 function commit(){const next=parseLightColor(text);if(next===null||next===value){text=value;return;}oncommit?.(next);}
</script>
<div class="color-field" role="group" onfocusin={event=>{if((event.target as HTMLInputElement).type==='text')typing=true;}} onfocusout={event=>{if((event.target as HTMLInputElement).type==='text'){typing=false;text=shown;}}}>
 <Input {label} {disabled} bind:value={text} class="color-text" onchange={commit} onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>
 <input class="color-swatch" type="color" aria-label={label} value={shown} {disabled} oninput={pick} onchange={end}/>
</div>
<style>
 .color-field{display:grid;grid-template-columns:36px minmax(0,1fr);column-gap:8px;row-gap:6px;align-items:center;min-width:0}
 .color-field :global(.color-text){display:contents}
 .color-field :global(.color-text label){grid-column:1/-1;grid-row:1}
 .color-field :global(.color-text input){grid-column:2;grid-row:2;padding:5px 8px;min-width:0;font-variant-numeric:tabular-nums}
 .color-swatch{grid-column:1;grid-row:2;width:36px;height:30px;padding:0;border:1px solid #dedbe5;border-radius:6px;background:none;cursor:pointer;-webkit-appearance:none;appearance:none}
 .color-swatch::-webkit-color-swatch-wrapper{padding:2px}
 .color-swatch::-webkit-color-swatch{border:0;border-radius:4px}
 .color-swatch:disabled{opacity:.5;cursor:default}
</style>
