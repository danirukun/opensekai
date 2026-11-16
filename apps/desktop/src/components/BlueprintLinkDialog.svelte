<script lang="ts">
 import { tick } from 'svelte';
 import { Button, Modal, Spinner } from '@oshi-connect/ui';
 import type { Reply } from '@opensekai/contracts';
 import { countLine, type LinkImportState, type LinkSummary } from '../blueprints/link-import';

 // The link confirmation (B39 R11). The parent mounts it only while a link is open.
 let { state: link, summary, onimport, onclose }: { state: LinkImportState; summary: Reply<LinkSummary> | null; onimport: () => void; onclose: () => void } = $props();
 const failure = $derived(link.kind === 'failed' ? link.message : link.kind === 'confirm' && summary && !summary.ok ? summary.error.message : null);
 const ready = $derived(link.kind === 'confirm' && summary?.ok ? summary.data : null);
 const title = $derived(failure !== null ? 'Blueprint not imported' : ready ? 'Import blueprint?' : 'Import blueprint');
 let body = $state<HTMLDivElement>();
 // Focus starts on the first footer button: Cancel, or Close after a failure.
 $effect(() => { void (failure !== null); void tick().then(() => (body?.closest('dialog')?.querySelector('footer button') as HTMLButtonElement | null)?.focus()); });
</script>

<Modal open={true} {title} closeOnBackdrop={false} class="blueprint-link-dialog" {onclose}>
 <div bind:this={body}>
  {#if failure !== null}<p>{failure}</p>
  {:else if ready}<p class="truncate font-semibold" title={ready.name}>{ready.name}</p><p class="text-ds-text-muted">{countLine(ready.nodeCount, ready.host)}</p>{#if ready.missing.length > 0}<p class="text-ds-text-muted">Missing: {ready.missing.join(', ')}</p>{/if}
  {:else}<Spinner />{/if}
 </div>
 {#snippet footer()}
  {#if failure !== null}<Button variant="primary" onclick={onclose}>Close</Button>
  {:else}<Button variant="secondary" onclick={onclose}>Cancel</Button>{#if ready}<Button variant="primary" onclick={onimport}>Import</Button>{/if}{/if}
 {/snippet}
</Modal>
