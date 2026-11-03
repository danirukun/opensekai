<script lang="ts">
 import { Button, Input, Select, Textarea } from '@oshi-connect/ui';
 import { Plus, X } from '@lucide/svelte';
 import { blendShapeNames, DEFAULT_EASING, EASINGS, MAX_NODE_MESHES, nodeDefinition, triggerableExpressions, type AssetRecord, type BlueprintField, type BlueprintNode, type BlueprintVariable, type DataType, type KeystrokeSettings, type SceneView, type Vec3 } from '@opensekai/contracts';
 import KeystrokeField from './KeystrokeField.svelte';
 import { chooseTypedVariable, formatStringCases, parseStringCases, resizeTypes, typedVariableOptions } from '../blueprints/data-fields';
 import { boneOptions, dataTypeOptions, fitPropertySettings, formatCases, keyOptions, parseCases, parseScalar, propertyOptions, vectorParts } from '../blueprints/fields';

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
  // The settings schema decides too: an event or timer name cannot be empty or only spaces.
  const fits = typeof value === 'string' && (field.maxLength === undefined || value.length <= field.maxLength) && nodeDefinition(node.type).settings.safeParse({ ...settings, [field.key]: value }).success;
  if (fits) set(field.key, value);
  else input.value = String(settings[field.key]);
 };
 const choices = (field: BlueprintField) =>
  // A second entity field (the Look At target) does not offer the node's own character.
  field.kind === 'entity' ? (scene?.entities ?? []).filter(entity => entity.kind !== 'tracking' && (field.key === 'entityId' || entity.id !== settings.entityId)).map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'avatar' ? (scene?.entities ?? []).filter(entity => entity.kind === 'avatar').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'trackingSource' ? (scene?.entities ?? []).filter(entity => entity.kind === 'tracking').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'expression' ? expressionChoices()
  : field.kind === 'blendshape' ? blendShapeChoices()
  : field.kind === 'easing' ? EASINGS.map(name => ({ value: name, label: name }))
  : field.kind === 'camera' ? (scene?.entities ?? []).filter(entity => entity.kind === 'camera').map(entity => ({ value: entity.id, label: entity.name }))
  : field.kind === 'output' ? (scene?.outputs ?? []).map(output => ({ value: output.id, label: output.id }))
  : field.kind === 'variable' ? variables.filter(variable => variable.type === field.variableType).map(variable => ({ value: variable.id, label: variable.name }))
  : field.kind === 'graph' ? graphs.map(graph => ({ value: graph.id, label: graph.name }))
  : field.kind === 'typedVariable' ? typedVariableOptions(variables, field.lists === true)
  : field.kind === 'bone' ? boneOptions()
  : field.kind === 'count' ? Array.from({ length: field.max - field.min + 1 }, (_, i) => ({ value: String(field.min + i), label: String(field.min + i) }))
  : [];
 function expressionChoices() {
  const avatar = scene?.entities.find(entity => entity.id === settings.entityId);
  const record = avatar?.kind === 'avatar' && avatar.assetId !== null ? assets.find(asset => asset.id === avatar.assetId) : undefined;
  return (record ? triggerableExpressions(record) : []).map(entry => ({ value: entry.name, label: entry.name }));
 }
 // The meshes of the record of the selected character, in record order (B26 R11).
 function meshChoices() {
  const avatar = scene?.entities.find(entity => entity.id === settings.entityId);
  const record = avatar?.kind === 'avatar' && avatar.assetId !== null ? assets.find(asset => asset.id === avatar.assetId) : undefined;
  return (record?.meshes ?? []).map(entry => ({ value: entry.name, label: entry.name }));
 }
 const meshNames = (field: BlueprintField) => settings[field.key] as string[];
 // Each entry offers the record meshes that no other entry uses; a saved name that the record does not have shows as missing.
 const meshOptions = (field: BlueprintField, index: number) => {
  const names = meshNames(field), value = names[index]!, list = meshChoices().filter(item => item.value === value || !names.includes(item.value));
  return list.some(item => item.value === value) ? list : [{ value, label: 'Missing' }, ...list];
 };
 const nextMesh = (field: BlueprintField) => meshNames(field).length < MAX_NODE_MESHES ? meshChoices().find(item => !meshNames(field).includes(item.value))?.value : undefined;
 function blendShapeChoices() {
  const avatar = scene?.entities.find(entity => entity.id === settings.entityId);
  const record = avatar?.kind === 'avatar' && avatar.assetId !== null ? assets.find(asset => asset.id === avatar.assetId) : undefined;
  return (record ? blendShapeNames(record) : []).map(name => ({ value: name, label: name }));
 }
 const chooseVariable = (field: Extract<BlueprintField, { kind: 'typedVariable' }>, id: string) => {
  const next = chooseTypedVariable(settings, field.key, field.typeKey, variables, id);
  if (next) onsettings(next as BlueprintNode['settings']);
 };
 // Cases text that does not parse stays in the field and shows the error state.
 let invalidCases = $state<string | null>(null);
 const types = (field: Extract<BlueprintField, { kind: 'types' }>) => settings[field.key] as DataType[];
 const counts = (max: number) => Array.from({ length: max + 1 }, (_, i) => ({ value: String(i), label: String(i) }));
 const options = (field: BlueprintField) => {
  const list = choices(field), value = settings[field.key];
  return (field.kind === 'entity' || field.kind === 'camera' || field.kind === 'output' || field.kind === 'avatar' || field.kind === 'trackingSource' || field.kind === 'expression' || field.kind === 'blendshape' || field.kind === 'typedVariable' || field.kind === 'graph') && typeof value === 'string' && !list.some(item => item.value === value)
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
 {:else if field.kind === 'stringCases'}
  <Textarea label={field.label} rows={3} resize="vertical" state={invalidCases === `${node.id}:${field.key}` ? 'error' : 'default'} value={formatStringCases(settings[field.key] as string[])} onchange={event => { const cases = parseStringCases(event.currentTarget.value); invalidCases = cases ? null : `${node.id}:${field.key}`; if (cases) set(field.key, cases); }} />
 {:else if field.kind === 'typedVariable'}
  <Select label={field.label} value={String(settings[field.key])} options={options(field)} onchange={event => chooseVariable(field, event.currentTarget.value)} />
 {:else if field.kind === 'types'}
  <Select label={field.label} value={String(types(field).length)} options={counts(field.max)} onchange={event => set(field.key, resizeTypes(types(field), Number(event.currentTarget.value), field.options[0]!))} />
  {#each types(field) as type, index (index)}
   <Select label={`{${index}}`} value={type} options={dataTypeOptions(field.options)} onchange={event => set(field.key, types(field).map((item, i) => i === index ? event.currentTarget.value : item))} />
  {/each}
 {:else if field.kind === 'meshes'}
  {@const next = nextMesh(field)}
  <div class="blueprint-field-list" role="group" aria-label={field.label}>
   {#each meshNames(field) as name, index (name)}
    <div class="blueprint-field-entry">
     <Select label={index === 0 ? field.label : undefined} value={name} options={meshOptions(field, index)} onchange={event => set(field.key, meshNames(field).map((item, i) => i === index ? event.currentTarget.value : item))} />
     <Button variant="ghost" size="sm" title={`Remove ${name}`} disabled={meshNames(field).length === 1} onclick={() => set(field.key, meshNames(field).filter((_, i) => i !== index))}><X size={14}/></Button>
    </div>
   {/each}
   <Button variant="ghost" size="sm" title={`Add ${field.label.toLowerCase()}`} disabled={next === undefined} onclick={() => { if (next !== undefined) set(field.key, [...meshNames(field), next]); }}><Plus size={14}/></Button>
  </div>
 {:else if field.kind === 'keystroke'}
  <KeystrokeField value={settings as KeystrokeSettings} {platform} {unavailable} onchange={next => onsettings(next)} />
 {:else}
  <Select label={field.label} value={String(settings[field.key])} options={options(field)} onchange={event => set(field.key, event.currentTarget.value)} />
 {/if}
{/each}
