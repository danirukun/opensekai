<script lang="ts">
 import type {InspectorSection} from '../editor/inspector-sections';
 // The section list beside the Inspector; the current entry follows the scroll position (B17 R13–R16).
 let {sections,current,onjump}:{sections:readonly InspectorSection[];current:number;onjump:(index:number)=>void}=$props();
</script>
<nav class="inspector-index" aria-label="Sections">
 {#each sections as section,index (section.id)}<button type="button" aria-current={index===current?'true':undefined} onclick={()=>onjump(index)}>{section.label}</button>{/each}
</nav>
