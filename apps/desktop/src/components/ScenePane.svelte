<script lang="ts">
 import { onMount } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { Move, RotateCw, Scaling, Activity, Grid3x3, Eye, EyeOff } from '@lucide/svelte';
 import type {AssetLoadStatus} from '@opensekai/renderer';
 import { fitPreview, type Tool } from '../editor/ui-message';
 import LoadOverlay from './LoadOverlay.svelte';
 import ContextMenu, {type MenuAction} from './ContextMenu.svelte';
 import GuideOverlay from './GuideOverlay.svelte';
 import {GUIDE_STORAGE_KEY,NO_GUIDES,guidesOn,readGuides,toggleGuide,writeGuides,type Guide,type GuideSettings} from '../editor/guides';
 let {canvas=$bindable(),counterHost=$bindable(),monitorHost=$bindable(),tool,canEdit,available,pending,selectedName,selectedEditable,previewOn,perfVisible,loads,names,hidden=false,ontool,onpreviewtoggle,onperftoggle,ondismissload}:{
  canvas?:HTMLCanvasElement;counterHost?:HTMLDivElement;monitorHost?:HTMLDivElement;
  tool:Tool;canEdit:boolean;available:boolean;pending:boolean;selectedName:string;selectedEditable:boolean;previewOn:boolean;perfVisible:boolean;loads:AssetLoadStatus[];names:Record<string,string>;hidden?:boolean;
  ontool:(tool:Tool)=>void;onpreviewtoggle:()=>void;onperftoggle:()=>void;ondismissload:(entityId:string)=>void;
 }=$props();
 let stage:HTMLDivElement;
 let previewSize=$state({width:0,height:0});
 let menu=$state<{x:number;y:number;actions:MenuAction[];guides?:true;anchor?:HTMLElement}|null>(null);
 let guides=$state<GuideSettings>(NO_GUIDES);
 function toggle(guide:Guide){guides=toggleGuide(guides,guide);try{localStorage.setItem(GUIDE_STORAGE_KEY,writeGuides(guides));}catch{}}
 function guideMenu(event:MouseEvent&{currentTarget:HTMLButtonElement}){if(menu?.guides){menu=null;return;}const box=event.currentTarget.getBoundingClientRect();menu={x:box.left,y:box.bottom+4,guides:true,anchor:event.currentTarget,actions:[{label:'Center mark',checked:guides.center,run:()=>toggle('center')},{label:'Thirds',checked:guides.thirds,run:()=>toggle('thirds')}]};}
 function context(event:MouseEvent){event.preventDefault();if(!previewOn||!selectedEditable)return;menu={x:event.clientX,y:event.clientY,actions:[['Move','translate'],['Rotate','rotate'],['Scale','scale']].map(([label,value])=>({label,disabled:!canEdit||!available||pending,run:()=>ontool(value as Tool)}))};}
 onMount(()=>{
  try{guides=readGuides(localStorage.getItem(GUIDE_STORAGE_KEY));}catch{}
  // A hidden pane has a zero stage; keep the last size so the canvas and its pointer mapping stay valid (R7).
  const resize=new ResizeObserver(()=>{const next=fitPreview(stage.clientWidth,stage.clientHeight,24);if(next.width>0)previewSize=next;});resize.observe(stage);
  return()=>resize.disconnect();
 });
 $effect(()=>{if(hidden)menu=null;});
</script>
<section class="scene-pane" {hidden}>
 <header class="scene-toolbar"><span class="scene-title">Scene</span><div class="tool-group" role="toolbar" aria-label="Transform tools">
  <Button variant="ghost" class={tool==='translate'?'active-tool':''} title="Move (W)" disabled={!canEdit||!available} onclick={()=>ontool('translate')}><Move size={17}/><span class="sr-only">Move</span></Button>
  <Button variant="ghost" class={tool==='rotate'?'active-tool':''} title="Rotate (E)" disabled={!canEdit||!available} onclick={()=>ontool('rotate')}><RotateCw size={17}/><span class="sr-only">Rotate</span></Button>
  <Button variant="ghost" class={tool==='scale'?'active-tool':''} title="Scale (R)" disabled={!canEdit||!available} onclick={()=>ontool('scale')}><Scaling size={17}/><span class="sr-only">Scale</span></Button>
 </div><span class="selection-name">{selectedName}</span><div class="spacer"></div><Button variant="ghost" class={guidesOn(guides)?'active-tool':''} title="Guides" aria-haspopup="menu" aria-expanded={menu?.guides===true} onclick={guideMenu}><Grid3x3 size={17}/><span class="sr-only">Guides</span></Button><Button variant="ghost" class={perfVisible?'active-tool':''} title={perfVisible?'Hide performance monitor':'Show performance monitor'} onclick={onperftoggle}><Activity size={17}/><span class="sr-only">{perfVisible?'Hide performance monitor':'Show performance monitor'}</span></Button><Button variant="ghost" class={previewOn?'active-tool':''} title={previewOn?'Turn off preview':'Turn on preview'} onclick={onpreviewtoggle}>{#if previewOn}<Eye size={17}/>{:else}<EyeOff size={17}/>{/if}<span class="sr-only">{previewOn?'Turn off preview':'Turn on preview'}</span></Button></header>
 <div bind:this={stage} class="viewport" oncontextmenu={context} role="presentation"><div class="preview-surface" class:paused={!previewOn} inert={!previewOn} style:width={`${previewSize.width}px`} style:height={`${previewSize.height}px`}><canvas bind:this={canvas} id="preview" tabindex="0" aria-label="Scene preview"></canvas><GuideOverlay settings={guides}/><div bind:this={counterHost} class="fps-counter-host"></div><div class="camera-frame" aria-hidden="true"></div><LoadOverlay entries={loads} {names} ondismiss={ondismissload}/></div><div bind:this={monitorHost} class="perf-monitor" class:visible={perfVisible} aria-label="Scene preview performance"></div></div>
</section>
{#if menu}<ContextMenu x={menu.x} y={menu.y} actions={menu.actions} anchor={menu.anchor} onclose={()=>{menu=null;}}/>{/if}
