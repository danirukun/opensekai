<script lang="ts">
 import { Button, Select } from '@oshi-connect/ui';
 import type { EditorPanelProps } from '../editor/model';
 import {cameraOptions,qualityOptions} from '../editor/live-fields';
 import {withQualityProfile} from '../editor/output-url';
 import {DEFAULT_QUALITY_PROFILE,QualityProfileIdSchema,type AppStatus,type QualityProfileId} from '@opensekai/contracts';
 export interface OutputControlsProps extends EditorPanelProps { status: AppStatus | null; outputUrl: string; disabled?:boolean }
 let { model, view, status, outputUrl, disabled=false }: OutputControlsProps = $props();
 let copied = $state(false); let copyError = $state(false); let quality = $state<QualityProfileId>(DEFAULT_QUALITY_PROFILE);
 const obsUrl = $derived(withQualityProfile(outputUrl, quality));
 const cameras=$derived(cameraOptions(view.scene?.entities??[]));
 const camera = $derived(view.scene?.outputs.find(output => output.id === 'output_main')?.cameraId ?? '');
 const output = $derived(status?.outputs.find(output => output.outputId === 'output_main'));
 const fresh = $derived(Boolean(status?.ready && output?.connected));
 async function copy() { try { await navigator.clipboard.writeText(obsUrl); copied = true; copyError = false; } catch { copied = false; copyError = true; } }
 $effect(() => { obsUrl; copied = false; copyError = false; });
</script>
<div class="output-controls" aria-label="Output controls">
 <Select label="Camera" value={camera} options={cameras} disabled={disabled || !view.scene || view.pending} onchange={event => { void model.selectCamera(event.currentTarget.value); }} />
 <span class="output-state" role="status">{fresh ? 'OBS ready' : output?.connected ? 'OBS waiting' : 'OBS disconnected'}</span>
 <div class="spacer"></div>
 <Select label="Quality" value={quality} options={qualityOptions} disabled={!outputUrl} onchange={event => { const parsed = QualityProfileIdSchema.safeParse(event.currentTarget.value); if (parsed.success) quality = parsed.data; }} />
 <Button variant="secondary" disabled={!outputUrl} onclick={copy}>{copied ? 'Copied' : 'Copy OBS URL'}</Button>
 {#if copyError}<p role="alert">Could not copy URL.</p>{/if}
</div>
