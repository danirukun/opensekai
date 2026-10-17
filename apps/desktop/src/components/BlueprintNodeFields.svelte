<script lang="ts">
 import { Input, Select } from '@oshi-connect/ui';
 import { nodeDefinition, type BlueprintField, type BlueprintNode, type BlueprintVariable, type KeystrokeSettings, type SceneView } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';
 import { fitPropertySettings, formatCases, keyOptions, parseCases, propertyOptions } from '../blueprints/fields';

 let { node, scene, variables, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; variables: readonly BlueprintVariable[]; platform: string; unavailable: boolean;
  onsettings: (settings: BlueprintNode['settings']) => void;
 } = $props();
 const settings = $derived(node.settings as Record<string, unknown>);
 const fields = $derived(nodeDefinition(node.type).fields);
 const set = (key: string, value: unknown) => {
  const next = { ...settings, [key]: value } as BlueprintNode['settings'];
  onsettings(node.type === 'property.get' || node.type === 'property.set' ? fitPropertySettings(next as never, scene) : next);
 };
 const spaces = [{ value: 'world', label: 'World' }, { value: 'local', label: 'Local' }];
 const truth = [{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }];
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
 const options = (field: BlueprintField) => {
  const list = choices(field), value = settings[field.key];
  return (field.kind === 'entity' || field.kind === 'camera' || field.kind === 'output') && typeof value === 'string' && !list.some(item => item.value === value)
   ? [{ value, label: 'Missing' }, ...list] : list;
 };
</script>

{#each fields as field (field.key)}
 {#if field.kind === 'number'}
  <Input type="number" label={field.label} min={field.min} max={field.max} step="any" value={String(settings[field.key])} oninput={event => numberInput(field, event.currentTarget.value)} />
 {:else if field.kind === 'boolean' && node.type === 'value.boolean'}
  <Select label={field.label} value={String(Boolean(settings[field.key]))} options={truth} onchange={event => set(field.key, event.currentTarget.value === 'true')} />
 {:else if field.kind === 'boolean'}
  <label class="blueprint-checkbox"><input type="checkbox" checked={Boolean(settings[field.key])} onchange={event => set(field.key, event.currentTarget.checked)} />{field.label}</label>
 {:else if field.kind === 'count'}
  <Select label={field.label} value={String(settings[field.key])} options={choices(field)} onchange={event => set(field.key, Number(event.currentTarget.value))} />
 {:else if field.kind === 'cases'}
  <Input label={field.label} value={formatCases(settings[field.key] as number[])} onchange={event => { const cases = parseCases(event.currentTarget.value); if (cases) set(field.key, cases); else event.currentTarget.value = formatCases(settings[field.key] as number[]); }} />
 {:else if field.kind === 'key'}
  <Select label={field.label} value={String(settings[field.key])} options={keyOptions()} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'property'}
  <Select label={field.label} value={String(settings[field.key])} options={propertyOptions(scene, String(settings.entityId))} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'space'}
  <Select label={field.label} value={String(settings[field.key])} options={spaces} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'keystroke'}
  <KeystrokeField value={settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
 {:else}
  <Select label={field.label} value={String(settings[field.key])} options={options(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {/if}
{/each}
