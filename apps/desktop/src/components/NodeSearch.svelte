<script lang="ts">
 import { onMount } from 'svelte';
 import { Input, nextDomId } from '@oshi-connect/ui';
 import type { DefaultRefs } from '@opensekai/contracts';
 import { searchNodes, type SearchEntry, type WireNeed } from '../blueprints/node-search';

 let { refs, need, focus = false, disabled = false, onpick }: { refs: DefaultRefs; need?: WireNeed; focus?: boolean; disabled?: boolean; onpick: (entry: SearchEntry) => void } = $props();
 const id = nextDomId('node-search');
 let query = $state(''), active = $state(0);
 const groups = $derived(searchNodes(query, refs, need));
 const flat = $derived(groups.flatMap(group => group.entries));
 $effect(() => { void query; active = 0; });
 onMount(() => { if (focus) (document.getElementById(id) as HTMLInputElement | null)?.focus(); });
 function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { active = Math.min(active + 1, flat.length - 1); event.preventDefault(); }
  else if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); event.preventDefault(); }
  else if (event.key === 'Enter' && flat[active]) { onpick(flat[active]); event.preventDefault(); }
 }
</script>

<div class="node-search">
 <Input {id} placeholder="Search nodes" autocomplete="off" {disabled} bind:value={query} onkeydown={keydown} />
 <ul class="node-search-results" role="listbox" aria-label="Nodes">
  {#each groups as group (group.category)}
   <li class="node-search-category" role="presentation">{group.category}</li>
   {#each group.entries as entry (entry.type)}
    <li role="option" aria-selected={flat[active] === entry} class:active={flat[active] === entry} onpointerdown={event => { event.preventDefault(); if (!disabled) onpick(entry); }}>{entry.label}</li>
   {/each}
  {/each}
 </ul>
</div>
