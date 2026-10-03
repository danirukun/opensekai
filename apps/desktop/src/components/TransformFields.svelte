<script lang="ts">
 import { Button, Input } from '@oshi-connect/ui';
 import { RotateCcw } from '@lucide/svelte';
 import type { Transform, Vec3 } from '@opensekai/contracts';
 import { eulerToQuaternion, quaternionToEuler, scrubValue, transformFromRow, type TransformRow } from '../editor/interaction';
 let {entityId,transform,revision,disabled=false,oncommit,ondraft}: {entityId:string;transform:Transform;revision:number;disabled?:boolean;oncommit:(transform:Transform,revision:number)=>void;ondraft?:(transform:Transform|null)=>void}=$props();
 const rows:TransformRow[]=['position','rotation','scale'];
 let values=$state<Record<TransformRow,string[]>>({position:[],rotation:[],scale:[]});let invalid=$state(false);
 let gesture:{id:number;x:number;row:TransformRow;axis:number;value:number;revision:number;entityId:string;transform:Transform;draft:Transform;moved:boolean}|null=null;
 function sync(){values={position:transform.position.map(String),rotation:quaternionToEuler(transform.rotation).map(v=>String(Math.round(v*1000)/1000)),scale:transform.scale.map(String)};invalid=false;}
 function cancel(){gesture=null;ondraft?.(null);sync();}
 $effect(()=>{const current=revision,id=entityId,t=transform,blocked=disabled;if(gesture&&(current!==gesture.revision||id!==gesture.entityId||blocked)){cancel();}else if(!gesture){void t;sync();}});
 function edited(row:TransformRow,numbers:Vec3,base=transform):Transform{return {...structuredClone(base),[row]:row==='rotation'?eulerToQuaternion(numbers):numbers};}
 function apply(row:TransformRow){const n=values[row].map(v=>v.trim()===''?NaN:Number(v)) as Vec3;const next=transformFromRow(transform,row,n);if(!next){invalid=true;return;}invalid=false;oncommit(next,revision);}
 function down(event:PointerEvent,row:TransformRow,axis:number){if(disabled||event.button!==0)return;event.preventDefault();const number=Number(values[row][axis]);if(!Number.isFinite(number))return;gesture={id:event.pointerId,x:event.clientX,row,axis,value:number,revision,entityId,transform:structuredClone(transform),draft:structuredClone(transform),moved:false};(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);}
 function move(event:PointerEvent){const g=gesture;if(!g||g.id!==event.pointerId)return;g.moved ||= event.clientX!==g.x;const numbers=(g.row==='rotation'?quaternionToEuler(g.transform.rotation):[...g.transform[g.row]]) as Vec3;numbers[g.axis]=scrubValue(g.value,event.clientX-g.x,g.row);g.draft=edited(g.row,numbers,g.transform);values[g.row]=numbers.map(v=>String(Math.round(v*1000)/1000));ondraft?.(g.draft);}
 function up(){const g=gesture;if(!g)return;gesture=null;ondraft?.(null);if(g.moved&&g.revision===revision&&g.entityId===entityId)oncommit(g.draft,g.revision);else sync();}
</script>
<svelte:window onblur={cancel} onkeydown={event=>{if(event.key==='Escape')cancel();}} />
<div class="transform-fields">
 {#each rows as row}<form class="property-row" onsubmit={event=>{event.preventDefault();apply(row);}}><fieldset disabled={disabled}><legend>{row==='rotation'?'Rotation (°)':row[0].toUpperCase()+row.slice(1)}</legend><div class="transform-values">
 {#each ['X','Y','Z'] as axis,index}<div class="axis-field"><button class="scrub-label" type="button" aria-label="Scrub {row} {axis}" onpointerdown={event=>down(event,row,index)} onpointermove={move} onpointerup={up} onpointercancel={cancel} onlostpointercapture={()=>{if(gesture)cancel();}}>{axis}</button><Input label="{row} {axis}" bind:value={values[row][index]} inputClass="numeric-input" /></div>{/each}
 <Button type="button" variant="ghost" class="row-reset" title="Reset {row}" onclick={()=>oncommit(edited(row,row==='scale'?[1,1,1]:[0,0,0]),revision)}><RotateCcw size={14}/></Button><Button type="submit" variant="ghost" class="row-apply">Apply</Button>
 </div></fieldset></form>{/each}
 {#if invalid}<p role="alert">Use finite values and positive scale.</p>{/if}
</div>
<style>fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:12px;margin-bottom:6px}.property-row{padding:12px 0;border-bottom:1px solid #e1dee6}.transform-values{display:flex;gap:5px;align-items:center}.axis-field{display:flex;align-items:center;min-width:0;flex:1}.scrub-label{border:0;background:none;padding:4px;cursor:ew-resize;touch-action:none;font-size:11px;color:#716c7d}.axis-field :global(input){width:100%;min-width:0}:global(.row-reset){opacity:0}.axis-field :global(label){position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}.property-row:hover :global(.row-reset),.property-row:focus-within :global(.row-reset){opacity:1}:global(.row-apply){font-size:11px}</style>
