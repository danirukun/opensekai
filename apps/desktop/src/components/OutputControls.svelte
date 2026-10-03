<script lang="ts">
 import { Button, Select } from '@oshi-connect/ui';
 import type { AppStatus } from '@opensekai/contracts';
 import type { EditorPanelProps } from '../editor/model';
 export interface OutputControlsProps extends EditorPanelProps { status: AppStatus | null; outputUrl: string }
 let { model, view, status, outputUrl }: OutputControlsProps = $props();
 let copied = $state(false); let copyError = $state(false);
 const camera = $derived(view.scene?.outputs.find(output => output.id === 'output_main')?.cameraId ?? '');
 const output = $derived(status?.outputs.find(output => output.outputId === 'output_main'));
 const fresh = $derived(Boolean(status?.ready && output?.connected));
 async function copy() { try { await navigator.clipboard.writeText(outputUrl); copied = true; copyError = false; } catch { copied = false; copyError = true; } }
 $effect(() => { outputUrl; copied = false; copyError = false; });
</script>
<div class="output-controls" aria-label="Output controls">
 <Select label="Camera" value={camera} options={[{ value: 'camera_wide', label: 'Wide' }, { value: 'camera_close', label: 'Close' }]} disabled={!view.scene || view.pending} onchange={event => { void model.selectCamera(event.currentTarget.value); }} />
 <span class="output-state" role="status">{fresh ? 'OBS ready' : output?.connected ? 'OBS waiting' : 'OBS disconnected'}</span>
 <div class="spacer"></div>
 <Button variant="secondary" disabled={!outputUrl} onclick={copy}>{copied ? 'Copied' : 'Copy OBS URL'}</Button>
 {#if copyError}<p role="alert">Could not copy URL.</p>{/if}
</div>
