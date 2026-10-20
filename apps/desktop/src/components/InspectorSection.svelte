<script lang="ts">
 import type {Snippet} from 'svelte';
 import {ChevronRight} from '@lucide/svelte';
 // A collapsed section keeps its fields mounted, so a live edit or a draft is not lost (B17 R10).
 let {id,label,collapsed,ontoggle,children}:{id:string;label:string;collapsed:boolean;ontoggle:()=>void;children:Snippet}=$props();
</script>
<section class="inspector-section" data-section={id} aria-labelledby="inspector-section-{id}">
 <h4><button type="button" id="inspector-section-{id}" class="section-heading" aria-expanded={!collapsed} aria-controls="inspector-section-body-{id}" onclick={ontoggle}><ChevronRight size={14}/>{label}</button></h4>
 <div id="inspector-section-body-{id}" class="section-body" hidden={collapsed}>{@render children()}</div>
</section>
