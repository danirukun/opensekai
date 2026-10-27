<script lang="ts">
 import { Button, Select } from '@oshi-connect/ui';
 import type { EditorPanelProps } from '../editor/model';
 import {cameraOptions,qualityOptions} from '../editor/live-fields';
 import {withObsLayer,withQualityProfile} from '../editor/output-url';
 import {changedFormat,formatField,frameLimitOptions,outputFormat,outputSizeOptions,renderScaleOptions} from '../editor/output-format';
 import {DEFAULT_QUALITY_PROFILE,QualityProfileIdSchema,type AppStatus,type QualityProfileId} from '@opensekai/contracts';
 export interface OutputControlsProps extends EditorPanelProps { status: AppStatus | null; outputUrl: string; disabled?:boolean }
 let { model, view, status, outputUrl, disabled=false }: OutputControlsProps = $props();
 let copied = $state(false); let copyError = $state(false); let quality = $state<QualityProfileId>(DEFAULT_QUALITY_PROFILE);
 const main = $derived(view.scene?.outputs.find(output => output.id === 'output_main'));
 const format = $derived(outputFormat(main));
 const obsUrl = $derived(withObsLayer(withQualityProfile(outputUrl, quality), main));
 const cameras=$derived(cameraOptions(view.scene?.entities??[]));
 const camera = $derived(main?.cameraId ?? '');
 const output = $derived(status?.outputs.find(output => output.outputId === 'output_main'));
 const fresh = $derived(Boolean(status?.ready && output?.connected));
 const editLocked = $derived(disabled || !view.scene || view.pending);
 async function copy() { try { await navigator.clipboard.writeText(obsUrl); copied = true; copyError = false; } catch { copied = false; copyError = true; } }
 // A rejected change leaves the scene value as it was, so put the scene value back in the select.
 async function change(select:HTMLSelectElement,field:'size'|'renderScale'|'fps') {
  const next=changedFormat(format,field,select.value);
  const reply=next?await model.setOutputFormat(next,view.scene?.revision):undefined;
  if(!reply?.ok)select.value=formatField(format,field);
 }
 function drag(event:DragEvent) { if(!obsUrl||!event.dataTransfer)return; event.dataTransfer.setData('text/uri-list',obsUrl); event.dataTransfer.setData('text/plain',obsUrl); event.dataTransfer.effectAllowed='copy'; }
 $effect(() => { obsUrl; copied = false; copyError = false; });
</script>
<div class="output-controls" aria-label="Output controls">
 <Select label="Camera" value={camera} options={cameras} disabled={editLocked} onchange={event => { void model.selectCamera(event.currentTarget.value); }} />
 <span class="output-state" role="status">{fresh ? 'OBS ready' : output?.connected ? 'OBS waiting' : 'OBS disconnected'}</span>
 <div class="spacer"></div>
 <Select label="Quality" value={quality} options={qualityOptions} disabled={!outputUrl} onchange={event => { const parsed = QualityProfileIdSchema.safeParse(event.currentTarget.value); if (parsed.success) quality = parsed.data; }} />
 <Button variant="secondary" disabled={!outputUrl} onclick={copy}>{copied ? 'Copied' : 'Copy OBS URL'}</Button>
 <a class="obs-drag" href={obsUrl || undefined} aria-disabled={!obsUrl} draggable={Boolean(obsUrl)} ondragstart={drag} onclick={event => event.preventDefault()}>Drag to OBS</a>
 {#if copyError}<p role="alert">Could not copy URL.</p>{/if}
</div>
<div class="output-controls output-format">
 <Select label="Resolution" value={formatField(format,'size')} options={outputSizeOptions} disabled={editLocked || !main} onchange={event => { void change(event.currentTarget,'size'); }} />
 <Select label="Render scale" value={formatField(format,'renderScale')} options={renderScaleOptions} disabled={editLocked || !main} onchange={event => { void change(event.currentTarget,'renderScale'); }} />
 <Select label="Frame limit" value={formatField(format,'fps')} options={frameLimitOptions} disabled={editLocked || !main} onchange={event => { void change(event.currentTarget,'fps'); }} />
</div>
