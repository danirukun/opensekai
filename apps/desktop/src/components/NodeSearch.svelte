<script lang="ts">
 import { onMount } from 'svelte';
 import { Dropdown, Input, nextDomId } from '@oshi-connect/ui';
 import { ChevronRight, Ellipsis, Star } from '@lucide/svelte';
 import { NODE_CATEGORIES, type DefaultRefs } from '@opensekai/contracts';
 import { FAVORITES, paletteSections, sectionCount, type SearchEntry, type WireNeed } from '../blueprints/node-search';
 import type { PalettePrefs, PaletteState } from '../blueprints/palette-prefs';

 let { refs, need, focus = false, disabled = false, prefs, menu = false, onpick }: { refs: DefaultRefs; need?: WireNeed; focus?: boolean; disabled?: boolean; prefs: PalettePrefs; menu?: boolean; onpick: (entry: SearchEntry) => void } = $props();
 const id = nextDomId('node-search');
 let query = $state(''), active = $state(0), saved = $state.raw<PaletteState>({ favorites: [], collapsed: [] }), action = $state('');
 // The shared per-user state: a star or a collapse in one palette shows in the other one at once.
 $effect.pre(() => { saved = prefs.state(); return prefs.subscribe(next => { saved = next; }); });
 const view = $derived(paletteSections(query, refs, saved, need));
 // Only rows in open sections take part in arrow keys; a favorite has one row in Favorites and one in its category.
 const rows = $derived(view.sections.flatMap(section => section.open ? section.entries.map(entry => ({ key: `${section.key}:${entry.type}`, entry })) : []));
 const favorite = $derived(new Set(saved.favorites));
 $effect(() => { void query; active = 0; });
 onMount(() => {
  if (focus) (document.getElementById(id) as HTMLInputElement | null)?.focus();
 });
 function pickEntry(entry: SearchEntry) { onpick(entry); query = ''; }
 function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { active = Math.min(active + 1, rows.length - 1); event.preventDefault(); }
  else if (event.key === 'ArrowUp') { active = Math.max(active - 1, 0); event.preventDefault(); }
  else if (event.key === 'Enter' && rows[active]) { pickEntry(rows[active].entry); event.preventDefault(); }
 }
 // During a search every section with a match is open, so a header changes the saved state only without a query.
 function setOpen(key: string, open: boolean) {
  if (view.searching || saved.collapsed.includes(key) !== open) return;
  prefs.setCollapsed(open ? saved.collapsed.filter(item => item !== key) : [...saved.collapsed, key]);
 }
 function headerKey(event: KeyboardEvent, key: string) {
  if (event.key === 'ArrowLeft') { setOpen(key, false); event.preventDefault(); }
  else if (event.key === 'ArrowRight') { setOpen(key, true); event.preventDefault(); }
 }
 const actions = [{ value: 'expand', label: 'Expand all' }, { value: 'collapse', label: 'Collapse all' }];
 function all(value: string) { action = ''; prefs.setCollapsed(value === 'collapse' ? [FAVORITES, ...NODE_CATEGORIES] : []); }
</script>

<div class="node-search">
 <div class="node-search-bar">
  <Input {id} placeholder="Search nodes" autocomplete="off" {disabled} bind:value={query} onkeydown={keydown} />
  {#if menu}<Dropdown bind:value={action} items={actions} triggerLabel="Palette" align="end" class="node-search-menu" onselect={all}>{#snippet trigger()}<Ellipsis size={14} />{/snippet}</Dropdown>{/if}
 </div>
 <ul class="node-search-results" role="listbox" aria-label="Nodes">
  {#each view.sections as section (section.key)}
   <li class="node-search-category" role="presentation">
    <button type="button" class="node-search-section" aria-expanded={section.open} onclick={() => setOpen(section.key, !section.open)} onkeydown={event => headerKey(event, section.key)}><ChevronRight size={12} class="node-search-chevron" />{section.key}<span class="node-search-count">({sectionCount(section, view.searching)})</span></button>
   </li>
   {#if section.open}
    {#each section.entries as entry (entry.type)}
     {@const row = rows.findIndex(item => item.key === `${section.key}:${entry.type}`)}
     {@const on = favorite.has(entry.type)}
     <li role="option" aria-selected={row === active} class:active={row === active} onpointerdown={event => { if ((event.target as Element).closest('.node-search-star')) return; event.preventDefault(); if (!disabled) pickEntry(entry); }}>
      <span>{entry.label}</span>
      <button type="button" class="node-search-star" class:on aria-pressed={on} aria-label={on ? 'Remove from favorites' : 'Add to favorites'} onpointerdown={event => event.preventDefault()} onclick={event => { event.stopPropagation(); prefs.toggleFavorite(entry.type); }}><Star size={12} /></button>
     </li>
    {/each}
   {/if}
  {/each}
 </ul>
</div>
