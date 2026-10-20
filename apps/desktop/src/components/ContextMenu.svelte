<script lang="ts">
 import { tick } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { Check } from '@lucide/svelte';
 import { menuPosition } from '../editor/interaction';
 // checked makes a check item; the menu still closes after a choice.
 export interface MenuAction {label:string;run:()=>void;disabled?:boolean;title?:string;checked?:boolean}
 // A press on anchor (the button that opened the menu) is not an outside press; the button itself closes the menu.
 let {x,y,actions,anchor,onclose}: {x:number;y:number;actions:MenuAction[];anchor?:HTMLElement;onclose:()=>void}=$props();
 let element:HTMLDivElement; let left=$state(0),top=$state(0);
 $effect(()=>{const previous=document.activeElement as HTMLElement|null;let active=true;void tick().then(()=>{if(!active)return;const box=element.getBoundingClientRect();const p=menuPosition(x,y,box.width,box.height,innerWidth,innerHeight);left=p.x;top=p.y;element.querySelectorAll('button').forEach((button,index)=>{const checked=actions[index]?.checked;button.setAttribute('role',checked===undefined?'menuitem':'menuitemcheckbox');if(checked!==undefined)button.setAttribute('aria-checked',String(checked));});element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();});return()=>{active=false;previous?.focus();};});
 function keys(event:KeyboardEvent){const buttons=[...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];let index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='Escape'){event.preventDefault();onclose();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();}}
</script>
<svelte:window onpointerdown={event=>{const target=event.target as Node;if(!element?.contains(target)&&!anchor?.contains(target))onclose();}} onblur={onclose} />
<div bind:this={element} class="context-menu" role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px" onkeydown={keys}>
 {#each actions as action}<Button variant="ghost" disabled={action.disabled} title={action.title} onclick={()=>{action.run();onclose();}}>{#if action.checked!==undefined}<span class="menu-check">{#if action.checked}<Check size={13}/>{/if}</span>{/if}{action.label}</Button>{/each}
</div>
<style>.context-menu{position:fixed;z-index:1000;min-width:180px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);overflow:auto;padding:4px;border:1px solid #cbc7d2;background:#fff;box-shadow:0 5px 18px #0002}.context-menu :global(button){display:block;width:100%;text-align:left;justify-content:flex-start}.menu-check{display:inline-flex;width:13px;margin-right:8px;vertical-align:-2px}</style>
