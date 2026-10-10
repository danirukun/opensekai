<script lang="ts">
 import { Input, Select } from '@oshi-connect/ui';
 import { nodeDefinition, type BlueprintField, type BlueprintNode, type BlueprintVariable, type KeystrokeSettings, type SceneView } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';
 import { formatCases, parseCases } from '../blueprints/fields';

 let { node, scene, variables, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; variables: readonly BlueprintVariable[]; platform: string; unavailable: boolean;
  onsettings: (settings: BlueprintNode['settings']) => void;
 } = $props();
 const settings = $derived(node.settings as Record<string, unknown>);
 const fields = $derived(nodeDefinition(node.type).fields);
 const set = (key: string, value: unknown) => onsettings({ ...settings, [key]: value } as BlueprintNode['settings']);
 const numberInput = (field: Extract<BlueprintField, { kind: 'number' }>, text: string) => {
  const value = Number(text);
  if (text !== '' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)) set(field.key, value);
 };
 const choices = (field: BlueprintField) =>
  field.kind === 'entity' ? (scene?.entities ?? []).filter(entity => entity.kind !== 'tracking').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'camera' ? (scene?.entities ?? []).filter(entity => entity.kind === 'camera').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'output' ? (scene?.outputs ?? []).map(output => ({ value: output.id, label: output.id }))
  : field.kind === 'variable' ? variables.filter(variable => variable.type === field.variableType).map(variable => ({ value: variable.id, label: variable.name }))
  : field.kind === 'count' ? Array.from({ length: field.max - field.min + 1 }, (_, i) => ({ value: String(field.min + i), label: String(field.min + i) }))
  : [];
</script>

{#each fields as field (field.key)}
 {#if field.kind === 'number'}
  <Input type="number" label={field.label} min={field.min} max={field.max} step="any" value={String(settings[field.key])} oninput={event => numberInput(field, event.currentTarget.value)} />
 {:else if field.kind === 'boolean'}
  <label class="blueprint-checkbox"><input type="checkbox" checked={Boolean(settings[field.key])} onchange={event => set(field.key, event.currentTarget.checked)} />{field.label}</label>
 {:else if field.kind === 'count'}
  <Select label={field.label} value={String(settings[field.key])} options={choices(field)} onchange={event => set(field.key, Number(event.currentTarget.value))} />
 {:else if field.kind === 'cases'}
  <Input label={field.label} value={formatCases(settings[field.key] as number[])} onchange={event => { const cases = parseCases(event.currentTarget.value); if (cases) set(field.key, cases); else event.currentTarget.value = formatCases(settings[field.key] as number[]); }} />
 {:else if field.kind === 'keystroke'}
  <KeystrokeField value={settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
 {:else}
  <Select label={field.label} value={String(settings[field.key])} options={choices(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {/if}
{/each}
