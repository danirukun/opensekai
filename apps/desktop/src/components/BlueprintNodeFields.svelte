<script lang="ts">
 import { Input, Select } from '@oshi-connect/ui';
 import { blendShapeNames, DEFAULT_EASING, EASINGS, nodeDefinition, triggerableExpressions, type AssetRecord, type BlueprintField, type BlueprintNode, type BlueprintVariable, type KeystrokeSettings, type SceneView, type Vec3 } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';
 import { boneOptions, fitPropertySettings, formatCases, keyOptions, parseCases, parseScalar, propertyOptions, vectorParts } from '../blueprints/fields';

 let { node, scene, assets = [], graphs = [], variables, platform, unavailable, onsettings }: {
  node: BlueprintNode; scene: SceneView | null; assets?: readonly AssetRecord[]; graphs?: readonly { id: string; name: string }[]; variables: readonly BlueprintVariable[]; platform: string; unavailable: boolean;
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
 const numberValue = (field: Extract<BlueprintField, { kind: 'number' }>, text: string) => {
  const value = Number(text);
  return text !== '' && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max) ? value : null;
 };
 const numberInput = (field: Extract<BlueprintField, { kind: 'number' }>, text: string) => { const value = numberValue(field, text); if (value !== null) set(field.key, value); };
 // On change (Enter or blur), an empty field clears an optional setting (a transition), so the node falls back to its
 // default behavior. Not on each input: a number input also reads empty while "-" is typed.
 const numberChange = (field: Extract<BlueprintField, { kind: 'number' }>, input: HTMLInputElement) => {
  const stored = settings[field.key];
  if (input.value === '') {
   const { [field.key]: _cleared, ...rest } = settings;
   if (stored !== undefined && nodeDefinition(node.type).settings.safeParse(rest).success) onsettings(rest as BlueprintNode['settings']);
   else if (stored !== undefined) input.value = String(stored);
   return;
  }
  if (numberValue(field, input.value) === null) input.value = stored === undefined ? '' : String(stored);
 };
 const integerValue = (field: Extract<BlueprintField, { kind: 'integer' }>, text: string) => {
  const value = parseScalar('integer', text);
  return typeof value === 'number' && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max) ? value : null;
 };
 const integerInput = (field: Extract<BlueprintField, { kind: 'integer' }>, text: string) => { const value = integerValue(field, text); if (value !== null) set(field.key, value); };
 // On change (Enter or blur), text that is not a valid value goes back to the stored value.
 const settle = (field: HTMLInputElement, valid: boolean, stored: unknown) => { if (!valid) field.value = String(stored); };
 const stringInput = (field: Extract<BlueprintField, { kind: 'string' }>, input: HTMLInputElement) => {
  const value = parseScalar('string', input.value);
  if (typeof value === 'string' && (field.maxLength === undefined || value.length <= field.maxLength)) set(field.key, value);
  else input.value = String(settings[field.key]);
 };
 const choices = (field: BlueprintField) =>
  // A second entity field (the Look At target) does not offer the node's own character.
  field.kind === 'entity' ? (scene?.entities ?? []).filter(entity => entity.kind !== 'tracking' && (field.key === 'entityId' || entity.id !== settings.entityId)).map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'avatar' ? (scene?.entities ?? []).filter(entity => entity.kind === 'avatar').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'expression' ? expressionChoices()
  : field.kind === 'blendshape' ? blendShapeChoices()
  : field.kind === 'easing' ? EASINGS.map(name => ({ value: name, label: name }))
  : field.kind === 'camera' ? (scene?.entities ?? []).filter(entity => entity.kind === 'camera').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'output' ? (scene?.outputs ?? []).map(output => ({ value: output.id, label: output.id }))
  : field.kind === 'variable' ? variables.filter(variable => variable.type === field.variableType).map(variable => ({ value: variable.id, label: variable.name }))
  : field.kind === 'graph' ? graphs.map(graph => ({ value: graph.id, label: graph.name }))
  : field.kind === 'bone' ? boneOptions()
  : field.kind === 'count' ? Array.from({ length: field.max - field.min + 1 }, (_, i) => ({ value: String(field.min + i), label: String(field.min + i) }))
  : [];
 function expressionChoices() {
  const avatar = scene?.entities.find(entity => entity.id === settings.entityId);
  const record = avatar?.kind === 'avatar' && avatar.assetId !== null ? assets.find(asset => asset.id === avatar.assetId) : undefined;
  return (record ? triggerableExpressions(record) : []).map(entry => ({ value: entry.name, label: entry.name }));
 }
 function blendShapeChoices() {
  const avatar = scene?.entities.find(entity => entity.id === settings.entityId);
  const record = avatar?.kind === 'avatar' && avatar.assetId !== null ? assets.find(asset => asset.id === avatar.assetId) : undefined;
  return (record ? blendShapeNames(record) : []).map(name => ({ value: name, label: name }));
 }
 const options = (field: BlueprintField) => {
  const list = choices(field), value = settings[field.key];
  return (field.kind === 'entity' || field.kind === 'camera' || field.kind === 'output' || field.kind === 'avatar' || field.kind === 'expression' || field.kind === 'blendshape' || field.kind === 'graph') && typeof value === 'string' && !list.some(item => item.value === value)
   ? [{ value, label: 'Missing' }, ...list] : list;
 };
</script>

{#each fields as field (field.key)}
 {#if field.kind === 'number'}
  <Input type="number" label={field.label} min={field.min} max={field.max} step="any" value={settings[field.key] === undefined ? '' : String(settings[field.key])} oninput={event => numberInput(field, event.currentTarget.value)} onchange={event => numberChange(field, event.currentTarget)} />
 {:else if field.kind === 'integer'}
  <Input type="number" label={field.label} min={field.min} max={field.max} step={1} value={String(settings[field.key])} oninput={event => integerInput(field, event.currentTarget.value)} onchange={event => settle(event.currentTarget, integerValue(field, event.currentTarget.value) !== null, settings[field.key])} />
 {:else if field.kind === 'string'}
  <Input label={field.label} value={String(settings[field.key])} onchange={event => stringInput(field, event.currentTarget)} />
 {:else if field.kind === 'vector3'}
  {@const vector = settings[field.key] as Vec3}
  <div class="blueprint-field-vector" role="group" aria-label={field.label}>
   {#each vector as part, index (index)}
    <Input type="number" step="any" label={index === 0 ? field.label : undefined} value={String(part)} oninput={event => { const next = vectorParts(vector, index, event.currentTarget.value); if (next) set(field.key, next); }} onchange={event => settle(event.currentTarget, parseScalar('number', event.currentTarget.value) !== null, part)} />
   {/each}
  </div>
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
 {:else if field.kind === 'easing'}
  <Select label={field.label} value={String(settings[field.key] ?? DEFAULT_EASING)} options={choices(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'space'}
  <Select label={field.label} value={String(settings[field.key])} options={spaces} onchange={event => set(field.key, event.currentTarget.value)} />
 {:else if field.kind === 'choice'}
  <Select label={field.label} value={String(settings[field.key])} options={field.options.map(option => ({ value: String(option.value), label: option.label }))} onchange={event => set(field.key, field.options.find(option => String(option.value) === event.currentTarget.value)?.value)} />
 {:else if field.kind === 'keystroke'}
  <KeystrokeField value={settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
 {:else}
  <Select label={field.label} value={String(settings[field.key])} options={options(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {/if}
{/each}
