<script lang="ts">
 import { tick } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { menuPosition } from '../editor/interaction';
 export interface MenuAction {label:string;run:()=>void;disabled?:boolean}
 let {x,y,actions,onclose}: {x:number;y:number;actions:MenuAction[];onclose:()=>void}=$props();
 let element:HTMLDivElement; let left=$state(0),top=$state(0);
 $effect(()=>{const previous=document.activeElement as HTMLElement|null;let active=true;void tick().then(()=>{if(!active)return;const box=element.getBoundingClientRect();const p=menuPosition(x,y,box.width,box.height,innerWidth,innerHeight);left=p.x;top=p.y;element.querySelectorAll('button').forEach(button=>button.setAttribute('role','menuitem'));element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();});return()=>{active=false;previous?.focus();};});
 function keys(event:KeyboardEvent){const buttons=[...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];let index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='Escape'){event.preventDefault();onclose();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();}}
</script>
<svelte:window onpointerdown={event=>{if(!element?.contains(event.target as Node))onclose();}} onblur={onclose} />
<div bind:this={element} class="context-menu" role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px" onkeydown={keys}>
 {#each actions as action}<Button variant="ghost" disabled={action.disabled} onclick={()=>{action.run();onclose();}}>{action.label}</Button>{/each}
</div>
<style>.context-menu{position:fixed;z-index:1000;min-width:180px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);overflow:auto;padding:4px;border:1px solid #cbc7d2;background:#fff;box-shadow:0 5px 18px #0002}.context-menu :global(button){display:block;width:100%;text-align:left;justify-content:flex-start}</style>
