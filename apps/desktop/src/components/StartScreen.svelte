<script lang="ts">
 import {onMount} from 'svelte';
 import {cubicOut} from 'svelte/easing';
 import {MediaQuery} from 'svelte/reactivity';
 import {Button} from '@oshi-connect/ui';
 import {X} from '@lucide/svelte';
 import type {RecentShow,ShowTemplate} from '@opensekai/contracts';
 import logo from '../assets/opensekai-logo.svg';
 let {recent,templates,disabled,onaddcharacter,onopen,ontemplate,onrecent,onclose}:{
  recent:RecentShow[];templates:ShowTemplate[];disabled:boolean;
  onaddcharacter:()=>void;onopen:()=>void;ontemplate:(id:string)=>void;onrecent:(index:number)=>void;onclose:()=>void;
 }=$props();
 const reduceMotion=new MediaQuery('(prefers-reduced-motion: reduce)');
 function fadeIn(_node:Element){return {duration:reduceMotion.current?0:220,easing:cubicOut,css:(t:number)=>`opacity:${t}`};}
 let column:HTMLDivElement;
 onMount(()=>{column.querySelector<HTMLButtonElement>('.start-primary')?.focus();});
</script>
<section class="start-screen" aria-label="Start" in:fadeIn>
 <div class="start-close"><Button variant="ghost" title="Close" onclick={onclose}><X size={16}/><span class="sr-only">Close</span></Button></div>
 <div class="start-column" bind:this={column}>
  <img class="start-logo" src={logo} alt="OpenSekai"/>
  <Button class="start-primary" {disabled} onclick={onaddcharacter}>Add character</Button>
  <Button variant="ghost" class="start-row" {disabled} onclick={onopen}><span>Open show…</span><kbd>⌘O</kbd></Button>
  {#if templates.length>0}<h2>Templates</h2>{#each templates as template (template.id)}<Button variant="ghost" class="start-row" {disabled} onclick={()=>ontemplate(template.id)}><span>{template.name}</span></Button>{/each}{/if}
  {#if recent.length>0}<h2>Recent</h2>{#each recent as show, index (index)}<Button variant="ghost" class="start-row" {disabled} onclick={()=>onrecent(index)}><span>{show.name}</span><span class="start-folder">{show.folder}</span></Button>{/each}{/if}
 </div>
</section>
<style>
 .start-screen{position:absolute;inset:0;z-index:4;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--ds-color-surface)}
 .start-close{position:absolute;top:10px;right:10px}
 .start-column{width:min(320px,100% - 48px);display:flex;flex-direction:column;align-items:stretch;gap:2px;padding:24px 0}
 .start-logo{width:96px;height:auto;align-self:center;margin-bottom:28px}
 h2{margin:20px 0 4px;padding:0 10px;font-size:11px;font-weight:600;color:var(--ds-color-text-muted)}
 .start-column :global(.start-primary){margin-bottom:10px}
 .start-screen :global(.start-row),.start-close :global(button){border:0!important;background:transparent!important;color:var(--ds-color-text)!important;box-shadow:none!important}
 .start-screen :global(.start-row){justify-content:space-between;gap:12px;padding:7px 10px!important;border-radius:5px;font-weight:500;text-align:left}
 .start-screen :global(.start-row:hover),.start-screen :global(.start-row:focus-visible),.start-close :global(button:hover){background:var(--ds-color-hover)!important}
 .start-screen :global(.start-row span){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .start-folder,kbd{flex:none;font:inherit;font-size:12px;font-weight:400;color:var(--ds-color-text-muted)}
 .start-close :global(button){padding:6px!important;color:var(--ds-color-rail-icon)!important}
</style>
