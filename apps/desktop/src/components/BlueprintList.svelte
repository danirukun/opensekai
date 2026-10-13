<script lang="ts">
 import { Button, Input } from '@oshi-connect/ui';
 import { Eye, EyeOff, FileInput, FileOutput, Plus, Trash2 } from '@lucide/svelte';
 import type { BlueprintGraph, BlueprintOp } from '@opensekai/contracts';

 let { graphs, selectedId, disabled, creatable, onselect, onops, oncreate, onimport, onexport }: {
  graphs: BlueprintGraph[]; selectedId: string | null; disabled: boolean; creatable: boolean;
  onselect: (id: string) => void; onops: (ops: BlueprintOp[]) => void; oncreate: () => void; onimport: () => void; onexport: (id: string) => void;
 } = $props();
 let renaming = $state<string | null>(null), draft = $state('');
 function commit(graph: BlueprintGraph) {
  const name = draft.trim();
  renaming = null;
  if (name && name !== graph.name) onops([{ kind: 'updateGraph', graphId: graph.id, name }]);
 }
 function start(graph: BlueprintGraph) { if (disabled) return; draft = graph.name; renaming = graph.id; }
 // The kit Button takes no ARIA state of its own, so the state goes onto its button element.
 function aria(node: HTMLElement, attributes: Record<string, string>) {
  const apply = (next: Record<string, string>) => { const button = node.querySelector('button'); for (const [name, value] of Object.entries(next)) button?.setAttribute(name, value); };
  apply(attributes);
  return { update: apply };
 }
 function focus(node: HTMLElement) { const input = node.querySelector('input'); input?.focus(); input?.select(); node.addEventListener('focusout', () => { if (renaming) { const graph = graphs.find(item => item.id === renaming); if (graph) commit(graph); } }); }
</script>

<aside class="blueprint-list" aria-label="Blueprints">
 <header><button type="button" class="blueprint-icon-button" title="New blueprint" aria-label="New blueprint" disabled={disabled || !creatable || graphs.length >= 8} onclick={oncreate}><Plus size={14} /></button><button type="button" class="blueprint-icon-button" title="Import blueprint" aria-label="Import blueprint" disabled={disabled || !creatable || graphs.length >= 8} onclick={onimport}><FileInput size={14} /></button></header>
 <ul>
  {#each graphs as graph (graph.id)}
   <li class:selected={graph.id === selectedId} class:off={!graph.enabled}>
    {#if renaming === graph.id}
     <div class="rename" use:focus><Input label="Blueprint name" bind:value={draft} onkeydown={event => { if (event.key === 'Enter') commit(graph); else if (event.key === 'Escape') renaming = null; }} /></div>
    {:else}
     <span class="blueprint-name" role="presentation" ondblclick={() => start(graph)} use:aria={{ 'aria-current': String(graph.id === selectedId) }}><Button variant="ghost" onclick={() => onselect(graph.id)}>{graph.name}</Button></span>
    {/if}
    <button type="button" class="blueprint-icon-button row-action" title="Export blueprint" aria-label="Export blueprint" {disabled} onclick={() => onexport(graph.id)}><FileOutput size={14} /></button>
    <button type="button" class="blueprint-icon-button row-action" title="Delete blueprint" aria-label="Delete blueprint" {disabled} onclick={() => onops([{ kind: 'removeGraph', graphId: graph.id }])}><Trash2 size={14} /></button>
    <button type="button" class="blueprint-icon-button" title={graph.enabled ? 'Disable' : 'Enable'} aria-label="Enabled" aria-pressed={graph.enabled} {disabled} onclick={() => onops([{ kind: 'updateGraph', graphId: graph.id, enabled: !graph.enabled }])}>{#if graph.enabled}<Eye size={14} />{:else}<EyeOff size={14} />{/if}</button>
   </li>
  {/each}
 </ul>
</aside>
