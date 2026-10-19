<script lang="ts">
 import { tick } from 'svelte';
 import { Button, Select } from '@oshi-connect/ui';
 import { DEBUG_LEVEL_LABELS, DEBUG_LEVELS, type BlueprintGraph, type DebugEntry } from '@opensekai/contracts';
 import { debugTime, debugToastText } from '../blueprints/debug-feed';

 let { entries, graphs, onclear }: { entries: readonly DebugEntry[]; graphs: readonly BlueprintGraph[]; onclear: () => void } = $props();
 let graphId = $state(''), level = $state('');
 let list: HTMLOListElement | undefined = $state();
 const levels = [{ value: '', label: 'All' }, ...DEBUG_LEVELS.map(value => ({ value, label: DEBUG_LEVEL_LABELS[value] }))];
 const graphOptions = $derived([{ value: '', label: 'All graphs' }, ...graphs.map(graph => ({ value: graph.id, label: graph.name }))]);
 const names = $derived(new Map(graphs.map(graph => [graph.id, graph.name])));
 // Toast and event rows have no level, so a level filter shows Log rows only.
 const shown = $derived(entries.filter(entry => (!graphId || entry.graphId === graphId) && (!level || (entry.kind === 'log' && entry.level === level))));
 const kind = (entry: DebugEntry) => entry.kind === 'log' ? entry.level : entry.kind;
 const text = (entry: DebugEntry) => entry.kind === 'log' ? entry.message
  : entry.kind === 'toast' ? debugToastText(entry)
  : entry.text === undefined ? entry.name : `${entry.name} ${entry.text}`;
 // Follow new rows only when the list is at its end, so a scroll back stays where it is.
 let following = true;
 const track = () => { if (list) following = list.scrollTop + list.clientHeight >= list.scrollHeight - 4; };
 $effect(() => { void shown.length; if (following) void tick().then(() => { if (list) list.scrollTop = list.scrollHeight; }); });
</script>

<section class="blueprint-debug" aria-label="Debug output">
 <header>
  <Select value={graphId} options={graphOptions} onchange={event => { graphId = event.currentTarget.value; }}>{#snippet label()}<span class="sr-only">Graph</span>{/snippet}</Select>
  <Select value={level} options={levels} onchange={event => { level = event.currentTarget.value; }}>{#snippet label()}<span class="sr-only">Level</span>{/snippet}</Select>
  <div class="spacer"></div>
  <Button variant="ghost" disabled={entries.length === 0} onclick={onclear}>Clear</Button>
 </header>
 <ol bind:this={list} onscroll={track}>
  {#each shown as entry (entry.seq)}
   <li data-kind={kind(entry)}><time>{debugTime(entry.atMs)}</time><span class="graph">{names.get(entry.graphId) ?? entry.graphId}</span><span class="kind">{kind(entry)}</span><span class="text">{text(entry)}{#if entry.dropped}<span class="dropped"> +{entry.dropped}</span>{/if}</span></li>
  {/each}
 </ol>
</section>
