<script lang="ts">
 import { clamp } from '../editor/interaction';
 let {value,min,max,orientation='vertical',onchange}: {value:number;min:number;max:number;orientation?:'vertical'|'horizontal';onchange:(value:number)=>void}=$props();
 let drag: {id:number;start:number;value:number}|null=null;
 function cancel(){if(drag) onchange(drag.value);drag=null;}
 function down(event:PointerEvent){if(event.button!==0)return;event.preventDefault();drag={id:event.pointerId,start:orientation==='vertical'?event.clientX:event.clientY,value};event.currentTarget instanceof HTMLElement && event.currentTarget.setPointerCapture(event.pointerId);}
 function move(event:PointerEvent){if(!drag||event.pointerId!==drag.id)return;onchange(clamp(drag.value+(orientation==='vertical'?event.clientX:event.clientY)-drag.start,min,max));}
 function key(event:KeyboardEvent){const delta=event.key==='ArrowLeft'||event.key==='ArrowUp'?-10:event.key==='ArrowRight'||event.key==='ArrowDown'?10:0;if(event.key==='Escape'){cancel();return;}if(delta||event.key==='Home'||event.key==='End'){event.preventDefault();onchange(event.key==='Home'?min:event.key==='End'?max:clamp(value+delta,min,max));}}
</script>
<svelte:window onblur={cancel} onkeydown={event=>{if(event.key==='Escape')cancel();}} />
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (A focusable separator implements the ARIA window splitter pattern.) -->
<div class="resize-handle" class:horizontal={orientation==='horizontal'} role="separator" tabindex="0" aria-label="Resize panel" aria-orientation={orientation} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} onpointerdown={down} onpointermove={move} onpointerup={()=>{drag=null;}} onpointercancel={cancel} onlostpointercapture={cancel} onkeydown={key}></div>
<style>.resize-handle{border:0;padding:0;background:transparent;width:5px;min-height:100%;cursor:col-resize;touch-action:none;flex:none}.horizontal{height:5px;width:100%;cursor:row-resize}.resize-handle:focus-visible{outline:2px solid #7965ae;outline-offset:-2px}</style>
