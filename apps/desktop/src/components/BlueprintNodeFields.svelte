<script lang="ts">
 import type { BlueprintNode, KeystrokeSettings, SceneView } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';

 let { node, scene, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; platform: string; unavailable: boolean;
  onsettings: (settings: BlueprintNode['settings']) => void;
 } = $props();
 const targets = $derived(scene?.entities.filter(entity => entity.kind !== 'tracking') ?? []);
 const cameras = $derived(scene?.entities.filter(entity => entity.kind === 'camera') ?? []);
 const outputs = $derived(scene?.outputs ?? []);
</script>

{#if node.type === 'value.number'}
 <label>Value<input type="number" value={node.settings.value} oninput={event => { const value = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(value)) onsettings({ value }); }} /></label>
{:else if node.type === 'value.boolean'}
 <label class="blueprint-checkbox"><input type="checkbox" checked={node.settings.value} onchange={event => onsettings({ value: event.currentTarget.checked })} />Value</label>
{:else if node.type === 'scene.setVisibility' || node.type === 'scene.toggleVisibility'}
 <label>Entity<select value={node.settings.entityId} onchange={event => onsettings({ entityId: event.currentTarget.value })}>{#each targets as target}<option value={target.id}>{target.name}</option>{/each}</select></label>
{:else if node.type === 'camera.switch'}
 <label>Output<select value={node.settings.outputId} onchange={event => onsettings({ ...node.settings, outputId: event.currentTarget.value })}>{#each outputs as output}<option value={output.id}>{output.id}</option>{/each}</select></label>
 <label>Camera<select value={node.settings.cameraId} onchange={event => onsettings({ ...node.settings, cameraId: event.currentTarget.value })}>{#each cameras as camera}<option value={camera.id}>{camera.name}</option>{/each}</select></label>
{:else if node.type === 'flow.delay'}
 <label>Seconds<input type="number" min="0" max="3600" step="any" value={node.settings.seconds} oninput={event => { const seconds = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 3600) onsettings({ seconds }); }} /></label>
{:else if node.type === 'flow.sequence'}
 <label>Outputs<select value={node.settings.outputs} onchange={event => onsettings({ outputs: Number(event.currentTarget.value) })}>{#each [2, 3, 4, 5, 6, 7, 8] as count}<option value={count}>{count}</option>{/each}</select></label>
{:else if node.type === 'event.keystroke'}
 <KeystrokeField value={node.settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
{/if}
