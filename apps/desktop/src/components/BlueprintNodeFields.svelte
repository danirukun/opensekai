<script lang="ts">
 import { Input, Select } from '@oshi-connect/ui';
 import type { BlueprintNode, KeystrokeSettings, SceneView } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';

 let { node, scene, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; platform: string; unavailable: boolean;
  onsettings: (settings: BlueprintNode['settings']) => void;
 } = $props();
 const targets = $derived(scene?.entities.filter(entity => entity.kind !== 'tracking') ?? []);
 const cameras = $derived(scene?.entities.filter(entity => entity.kind === 'camera') ?? []);
 const entityOptions = $derived(targets.map(target => ({ value: target.id, label: target.name })));
 const cameraOptions = $derived(cameras.map(camera => ({ value: camera.id, label: camera.name })));
 const outputOptions = $derived((scene?.outputs ?? []).map(output => ({ value: output.id, label: output.id })));
 const countOptions = [2, 3, 4, 5, 6, 7, 8].map(count => ({ value: String(count), label: String(count) }));
</script>

{#if node.type === 'value.number'}
 <Input type="number" label="Value" value={String(node.settings.value)} oninput={event => { const value = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(value)) onsettings({ value }); }} />
{:else if node.type === 'value.boolean'}
 <label class="blueprint-checkbox"><input type="checkbox" checked={node.settings.value} onchange={event => onsettings({ value: event.currentTarget.checked })} />Value</label>
{:else if node.type === 'scene.setVisibility' || node.type === 'scene.toggleVisibility'}
 <Select label="Entity" value={node.settings.entityId} options={entityOptions} onchange={event => onsettings({ entityId: event.currentTarget.value })} />
{:else if node.type === 'camera.switch'}
 <Select label="Output" value={node.settings.outputId} options={outputOptions} onchange={event => onsettings({ ...node.settings, outputId: event.currentTarget.value })} />
 <Select label="Camera" value={node.settings.cameraId} options={cameraOptions} onchange={event => onsettings({ ...node.settings, cameraId: event.currentTarget.value })} />
{:else if node.type === 'flow.delay'}
 <Input type="number" label="Seconds" min={0} max={3600} step="any" value={String(node.settings.seconds)} oninput={event => { const seconds = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600) onsettings({ seconds }); }} />
{:else if node.type === 'flow.sequence'}
 <Select label="Outputs" value={String(node.settings.outputs)} options={countOptions} onchange={event => onsettings({ outputs: Number(event.currentTarget.value) })} />
{:else if node.type === 'event.keystroke'}
 <KeystrokeField value={node.settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
{/if}
