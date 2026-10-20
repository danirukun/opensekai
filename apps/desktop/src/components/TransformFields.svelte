<script lang="ts">
 import {untrack,onDestroy} from 'svelte';
 import {Button,Input} from '@oshi-connect/ui';
 import {RotateCcw} from '@lucide/svelte';
 import type {Transform,Vec3} from '@opensekai/contracts';
 import {sameValue} from '../editor/property-defaults';
 import {quaternionToEuler,scrubValue,initialTransformFields,copyTransform,transformFromFields,type TransformRow} from '../editor/interaction';
 let {entityId,transform,revision,disabled=false,committing=false,cancelKey=null,defaultScale=[1,1,1],oncommit,oncancel,onfinish}: {entityId:string;transform:Transform;defaultScale?:Vec3;baseTransform?:Transform;revision:number;disabled?:boolean;committing?:boolean;cancelKey?:string|null;oncommit:(transform:Transform,revision:number)=>void;oncancel?:()=>void;onfinish?:()=>void;ondraft?:(transform:Transform|null)=>void}=$props();
 const rows:TransformRow[]=['position','rotation','scale'];
 let values=$state(untrack(()=>initialTransformFields(transform))),invalid=$state(false),focused=$state(false);
 let gesture=$state.raw<{id:number;x:number;row:TransformRow;axis:number;value:number;transform:Transform;moved:boolean}|null>(null);
 let sourceId=untrack(()=>entityId),errorKey=untrack(()=>cancelKey);
 function resetFields(){values=initialTransformFields(transform);invalid=false;}
 function cancel(){gesture=null;oncancel?.();resetFields();}
 $effect(()=>{
  const id=entityId,t=transform,r=revision,blocked=disabled,busy=committing,error=cancelKey;
  untrack(()=>{if(id!==sourceId||error!==errorKey&&error!==null||blocked){sourceId=id;errorKey=error;cancel();}else if(!gesture&&!focused&&!busy){void t;void r;resetFields();}errorKey=error;});
 });
 function submit(){const next=transformFromFields(values);invalid=next===null;if(next)oncommit(next,revision);}
 function input(event:Event&{currentTarget:HTMLInputElement},row:TransformRow,axis:number){values[row][axis]=event.currentTarget.value;submit();}
 function down(event:PointerEvent,row:TransformRow,axis:number){
  if(disabled||event.button!==0)return;event.preventDefault();const base=transformFromFields(values)??copyTransform(transform),number=Number(values[row][axis]);if(!Number.isFinite(number))return;
  gesture={id:event.pointerId,x:event.clientX,row,axis,value:number,transform:base,moved:false};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
 }
 function move(event:PointerEvent){const g=gesture;if(!g||g.id!==event.pointerId)return;g.moved ||=event.clientX!==g.x;const numbers=(g.row==='rotation'?quaternionToEuler(g.transform.rotation):[...g.transform[g.row]]) as Vec3;numbers[g.axis]=scrubValue(g.value,event.clientX-g.x,g.row);values[g.row]=numbers.map(value=>String(Math.round(value*1000)/1000));submit();}
 function up(){if(!gesture)return;gesture=null;submit();if(!focused)onfinish?.();}
 onDestroy(()=>onfinish?.());
 // A row shows its reset button only when it differs from zero, identity, or the default scale (B17 R8).
 const rowDefault=(row:TransformRow)=>row==='scale'?defaultScale:row==='rotation'?[0,0,0,1]:[0,0,0];
 const differs=(row:TransformRow)=>!sameValue([...transform[row]],rowDefault(row));
 const rowLabel=(row:TransformRow)=>row==='rotation'?'Rotation (°)':row[0]!.toUpperCase()+row.slice(1);
 function reset(row:TransformRow){values[row]=(row==='rotation'?[0,0,0]:rowDefault(row)).map(String);submit();}
</script>
<svelte:window onblur={()=>{if(gesture)cancel();}} onkeydown={event=>{if(event.key==='Escape'){event.preventDefault();cancel();}}}/>
<div class="transform-fields" role="group" aria-label="Transform" onfocusin={()=>{focused=true;}} onfocusout={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)){focused=false;onfinish?.();}}}>
 {#each rows as row}<form class="property-row" onsubmit={event=>{event.preventDefault();submit();}}><fieldset disabled={disabled}><legend>{rowLabel(row)}</legend><div class="transform-values">
  {#each ['X','Y','Z'] as axis,index}<div class="axis-field"><button class="scrub-label" type="button" aria-label="Scrub {row} {axis}" onpointerdown={event=>down(event,row,index)} onpointermove={move} onpointerup={up} onpointercancel={cancel} onlostpointercapture={()=>{if(gesture)cancel();}}>{axis}</button><Input label="{row} {axis}" bind:value={values[row][index]} inputClass="numeric-input" oninput={event=>input(event,row,index)}/></div>{/each}
  <Button type="button" variant="ghost" class={differs(row)?'row-reset':'row-reset at-default'} title="Reset {rowLabel(row)}" disabled={!differs(row)} onclick={()=>reset(row)}><RotateCcw size={14}/></Button>
 </div></fieldset></form>{/each}
 {#if invalid}<p role="alert">Use finite values and positive scale.</p>{/if}
</div>
<style>fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;margin-bottom:6px}.property-row{padding:12px 0;border-bottom:1px solid #e1dee6}.transform-values{display:flex;gap:5px;align-items:center}.axis-field{display:flex;align-items:center;min-width:0;flex:1}.scrub-label{border:0;background:none;padding:4px;cursor:ew-resize;touch-action:none;font-size:11px;color:#716c7d}.axis-field :global(input){width:100%;min-width:0}.axis-field :global(label){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.transform-values :global(.row-reset.at-default){visibility:hidden}.property-row:hover :global(.row-reset),.property-row:focus-within :global(.row-reset){opacity:1}</style>
