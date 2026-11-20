<script lang="ts">
 import { tick, type Component } from 'svelte';
 import { cubicIn, cubicOut } from 'svelte/easing';
 import { MediaQuery } from 'svelte/reactivity';
 import { Button } from '@oshi-connect/ui';
 import { Check } from '@lucide/svelte';
 import { menuPosition, shouldRestoreMenuFocus } from '../editor/interaction';
 const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
 function menuIn(_node: Element) {
  return { duration: reduceMotion.current ? 0 : 180, easing: cubicOut, css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * 4}px) scale(${0.96 + t * 0.04})` };
 }
 function menuOut(_node: Element) {
  return { duration: reduceMotion.current ? 0 : 120, easing: cubicIn, css: (t: number) => `opacity:${t};transform:scale(${0.98 + t * 0.02})` };
 }
 // checked makes a check item; the menu still closes after a choice.
 export interface MenuAction {label:string;run:()=>void;disabled?:boolean;title?:string;checked?:boolean;group?:string;icon?:Component<{size?:number}>}
 // A press on anchor (the button that opened the menu) is not an outside press; the button itself closes the menu.
 let {x,y,actions,anchor,onclose}: {x:number;y:number;actions:MenuAction[];anchor?:HTMLElement;onclose:()=>void}=$props();
 let element:HTMLDivElement; let left=$state(0),top=$state(0);
 $effect.pre(()=>{left=x;top=y;});
 $effect(()=>{const previous=document.activeElement as HTMLElement|null;let active=true;void tick().then(()=>{if(!active)return;const box=element.getBoundingClientRect();const p=menuPosition(x,y,box.width,box.height,innerWidth,innerHeight);left=p.x;top=p.y;element.querySelectorAll('button').forEach((button,index)=>{const checked=actions[index]?.checked;button.setAttribute('role',checked===undefined?'menuitem':'menuitemcheckbox');if(checked!==undefined)button.setAttribute('aria-checked',String(checked));});element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();});return()=>{active=false;const current=document.activeElement;const restore=shouldRestoreMenuFocus({previousConnected:previous?.isConnected===true,activeInsideMenu:!!current&&!!element&&(current===element||element.contains(current)),activeIsDocument:current==null||current===document.body||current===document.documentElement});if(restore)previous?.focus();};});
 function keys(event:KeyboardEvent){const buttons=[...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];let index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='Escape'){event.preventDefault();onclose();return;}if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index]?.focus();}}
</script>
<svelte:window onpointerdown={event=>{const target=event.target as Node;if(!element?.contains(target)&&!anchor?.contains(target))onclose();}} onblur={onclose} />
<div bind:this={element} class="context-menu" role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px" in:menuIn out:menuOut onkeydown={keys}>
 {#each actions as action, index (index)}{#if index>0&&action.group!==undefined&&action.group!==actions[index-1]?.group}<div class="menu-split" role="separator"></div>{/if}<Button variant="ghost" disabled={action.disabled} title={action.title} onclick={()=>{action.run();onclose();}}>{#if action.checked!==undefined}<span class="menu-check">{#if action.checked}<Check size={13}/>{/if}</span>{/if}{#if action.icon}{@const Icon=action.icon}<span class="menu-icon"><Icon size={14}/></span>{/if}{action.label}</Button>{/each}
</div>
<style>.context-menu{position:fixed;z-index:1000;min-width:180px;max-width:calc(100vw - 8px);max-height:calc(100vh - 8px);overflow:auto;padding:6px;border:1px solid var(--ds-color-border);border-radius:8px;background:var(--ds-color-surface);box-shadow:0 8px 24px var(--ds-color-shadow);transform-origin:top left}.context-menu :global(button){display:flex;align-items:center;gap:8px;width:100%;border:0!important;box-shadow:none!important;background:transparent!important;border-radius:4px;text-align:left;justify-content:flex-start;color:var(--ds-color-text)!important}.context-menu :global(button:hover:not(:disabled)){background:var(--ds-color-hover)!important}.menu-split{height:1px;margin:4px 6px;background:var(--ds-color-border)}.menu-icon{display:inline-flex;flex:none;color:var(--ds-color-text-muted)}.menu-check{display:inline-flex;width:13px;flex:none}</style>
