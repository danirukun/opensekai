<script lang="ts">
 import {untrack} from 'svelte';
 import {Input} from '@oshi-connect/ui';
 import {fromSlider,parseInRange,toSlider,type SliderRange} from '../editor/slider';
 let {label,value,range,disabled=false,onlive,onend,oncommit}:{label:string;value:number;range:SliderRange;disabled?:boolean;onlive?:(value:number)=>void;onend?:()=>void;oncommit?:(value:number)=>void}=$props();
 const STEPS=1000;
 // While the slider moves it shows its own value, not the scene value that the live replies bring back (B12 R12).
 // The kit types `text` as a string, but its number field binds a number (or null); parseInRange takes both.
 let dragged=$state<number|null>(null),text=$state(untrack(()=>String(value)));
 let typing=false,settling=false,timer:ReturnType<typeof setTimeout>|undefined;
 const shown=$derived(dragged??value);
 const release=()=>{settling=false;clearTimeout(timer);dragged=null;if(!typing)text=String(value);};
 $effect(()=>{const next=value;untrack(()=>{if(settling)release();else if(dragged===null&&!typing)text=String(next);});});
 $effect(()=>()=>clearTimeout(timer));
 function slide(event:Event&{currentTarget:HTMLInputElement}){
  const next=fromSlider(Number(event.currentTarget.value)/STEPS,range);
  if(next===shown)return;
  settling=false;clearTimeout(timer);dragged=next;text=String(next);onlive?.(next);
 }
 function end(){if(dragged===null||settling)return;settling=true;onend?.();clearTimeout(timer);timer=setTimeout(release,500);}
 function commit(){const next=parseInRange(text,range);if(next===null||next===value){text=String(value);return;}oncommit?.(next);}
</script>
<div class="slider-field" role="group" onfocusin={event=>{if((event.target as HTMLInputElement).type==='number')typing=true;}} onfocusout={event=>{if((event.target as HTMLInputElement).type==='number'){typing=false;text=String(shown);}}}>
 <Input {label} type="number" min={range.min} max={range.max} step={range.step} {disabled} bind:value={text} class="slider-number" onchange={commit} onkeydown={event=>{if(event.key==='Enter'){event.preventDefault();event.currentTarget.blur();}}}/>
 <input class="slider-track" type="range" aria-label={label} min="0" max={STEPS} step="1" value={Math.round(toSlider(shown,range)*STEPS)} {disabled} oninput={slide} onchange={end} onpointerup={end}/>
</div>
<style>
 .slider-field{display:grid;grid-template-columns:minmax(0,1fr) 78px;column-gap:10px;row-gap:6px;align-items:center;min-width:0}
 .slider-field :global(.slider-number){display:contents}
 .slider-field :global(.slider-number label){grid-column:1/-1;grid-row:1}
 .slider-field :global(.slider-number input){grid-column:2;grid-row:2;padding:5px 8px;min-width:0}
 .slider-track{grid-column:1;grid-row:2;width:100%;min-width:0;margin:0;accent-color:#8571ac}
 .slider-track:disabled{opacity:.5}
</style>
