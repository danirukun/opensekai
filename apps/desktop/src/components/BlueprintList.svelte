<script lang="ts">
 import { Button, Input } from '@oshi-connect/ui';
 import { Eye, EyeOff, Plus, Trash2 } from '@lucide/svelte';
 import type { BlueprintGraph, BlueprintOp } from '@opensekai/contracts';

 let { graphs, selectedId, disabled, onselect, onops, oncreate }: {
  graphs: BlueprintGraph[]; selectedId: string | null; disabled: boolean;
  onselect: (id: string) => void; onops: (ops: BlueprintOp[]) => void; oncreate: () => void;
 } = $props();
 let renaming = $state<string | null>(null), draft = $state('');
 function commit(graph: BlueprintGraph) {
  const name = draft.trim();
  renaming = null;
  if (name && name !== graph.name) onops([{ kind: 'updateGraph', graphId: graph.id, name }]);
 }
 function start(graph: BlueprintGraph) { if (disabled) return; draft = graph.name; renaming = graph.id; }
 function focus(node: HTMLElement) { const input = node.querySelector('input'); input?.focus(); input?.select(); node.addEventListener('focusout', () => { if (renaming) { const graph = graphs.find(item => item.id === renaming); if (graph) commit(graph); } }); }
</script>

<aside class="blueprint-list" aria-label="Blueprints">
 <header><h3>Blueprints</h3><Button variant="ghost" title="New blueprint" disabled={disabled || graphs.length >= 8} onclick={oncreate}><Plus size={14} /></Button></header>
 <ul>
  {#each graphs as graph (graph.id)}
   <li class:selected={graph.id === selectedId} class:off={!graph.enabled}>
    {#if renaming === graph.id}
     <div class="rename" use:focus><Input label="Blueprint name" bind:value={draft} onkeydown={event => { if (event.key === 'Enter') commit(graph); else if (event.key === 'Escape') renaming = null; }} /></div>
    {:else}
     <button type="button" class="blueprint-name" aria-current={graph.id === selectedId} onclick={() => onselect(graph.id)} ondblclick={() => start(graph)}>{graph.name}</button>
    {/if}
    <button type="button" title={graph.enabled ? 'Disable' : 'Enable'} aria-label="Enabled" aria-pressed={graph.enabled} {disabled} onclick={() => onops([{ kind: 'updateGraph', graphId: graph.id, enabled: !graph.enabled }])}>{#if graph.enabled}<Eye size={14} />{:else}<EyeOff size={14} />{/if}</button>
    <Button variant="ghost" title="Delete blueprint" {disabled} onclick={() => onops([{ kind: 'removeGraph', graphId: graph.id }])}><Trash2 size={14} /></Button>
   </li>
  {/each}
 </ul>
</aside>
