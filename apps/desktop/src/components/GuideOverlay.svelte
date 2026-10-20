<script lang="ts">
 import { guideLines, type GuideSettings } from '../editor/guides';
 let {settings}: {settings:GuideSettings}=$props();
 let host:HTMLDivElement;
 let box=$state({width:0,height:0}),dpr=$state(1);
 // Measure the frame itself with fractional sizes, so the guides follow any frame size.
 $effect(()=>{const observer=new ResizeObserver(([entry])=>{if(entry)box={width:entry.contentRect.width,height:entry.contentRect.height};});observer.observe(host);return()=>observer.disconnect();});
 // A move to a display with another pixel ratio can keep the CSS size, so watch the ratio too.
 $effect(()=>{let query:MediaQueryList|undefined;const watch=()=>{query?.removeEventListener('change',watch);const ratio=devicePixelRatio||1;dpr=ratio;query=matchMedia(`(resolution: ${ratio}dppx)`);query.addEventListener('change',watch);};watch();return()=>query?.removeEventListener('change',watch);});
 const lines=$derived(guideLines(box.width,box.height,dpr,settings));
</script>
<div bind:this={host} class="preview-guides" aria-hidden="true">{#if lines.length}<svg width={box.width} height={box.height} viewBox="0 0 {box.width} {box.height}" focusable="false">
 <g stroke="#000" stroke-opacity=".45" stroke-width={3/dpr}>{#each lines as l}<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}/>{/each}</g>
 <g stroke="#fff" stroke-opacity=".7" stroke-width={1/dpr}>{#each lines as l}<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}/>{/each}</g>
</svg>{/if}</div>
<style>.preview-guides{position:absolute;inset:0;overflow:hidden;pointer-events:none}.preview-guides svg{display:block}</style>
