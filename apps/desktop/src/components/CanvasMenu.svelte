<script lang="ts">
 import { onMount, type Snippet } from 'svelte';

 let { x, y, items = [], onpick, onclose, children }: { x: number; y: number; items?: { value: string; label: string }[]; onpick?: (value: string) => void; onclose: () => void; children?: Snippet } = $props();
 let root: HTMLDivElement;
 let height = $state(320);
 const left = $derived(Math.max(8, Math.min(x, window.innerWidth - 248)));
 const top = $derived(Math.max(8, Math.min(y, window.innerHeight - height - 8)));
 onMount(() => {
  const away = (event: PointerEvent) => { if (!root.contains(event.target as Node)) onclose(); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onclose(); } };
  window.addEventListener('pointerdown', away, true); window.addEventListener('keydown', key, true);
  return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
 });
</script>

<div bind:this={root} bind:offsetHeight={height} class="canvas-menu" role="menu" tabindex="-1" style:left="{left}px" style:top="{top}px">
 {@render children?.()}
 {#each items as item (item.value)}
  <button type="button" role="menuitem" onclick={() => onpick?.(item.value)}>{item.label}</button>
 {/each}
</div>
