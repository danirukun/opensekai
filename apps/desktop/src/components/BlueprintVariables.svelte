<script lang="ts">
 import { Dropdown, Input, Select, Textarea } from '@oshi-connect/ui';
 import { Plus, Trash2 } from '@lucide/svelte';
 import { isListType, type BlueprintOp, type BlueprintValue, type BlueprintVariable, type DataType, type ScalarValue, type Vec3 } from '@opensekai/contracts';
 import { asDataType, dataTypeOptions, formatList, newVariable, parseList, parseScalar, vectorParts } from '../blueprints/fields';

 let { graphId, variables, disabled, onops }: { graphId: string; variables: readonly BlueprintVariable[]; disabled: boolean; onops: (ops: BlueprintOp[]) => void } = $props();
 let picked = $state('');
 const types = dataTypeOptions();
 const add = (type: string) => { picked = ''; onops([{ kind: 'addVariable', graphId, variable: newVariable(variables, asDataType(type) ?? 'number', crypto.randomUUID()) }]); };
 const update = (variableId: string, change: { name?: string; type?: DataType; default?: BlueprintValue }) => onops([{ kind: 'updateVariable', graphId, variableId, ...change }]);
 const rename = (variable: BlueprintVariable, input: HTMLInputElement) => {
  const name = input.value.trim();
  if (name && name.length <= 64 && !variables.some(other => other.id !== variable.id && other.name === name)) update(variable.id, { name });
  else input.value = variable.name;
 };
 const typed = (variable: BlueprintVariable, type: 'number' | 'integer' | 'string', text: string) => { const value = parseScalar(type, text); if (value !== null) update(variable.id, { default: value }); };
 // On change (Enter or blur), text that is not a value of the type goes back to the stored value.
 const settle = (field: HTMLInputElement, type: 'number' | 'integer' | 'string', stored: unknown) => { if (parseScalar(type, field.value) === null) field.value = String(stored); };
 const list = (variable: BlueprintVariable, field: HTMLTextAreaElement) => {
  const value = isListType(variable.type) ? parseList(variable.type, field.value) : null;
  if (value !== null) update(variable.id, { default: value });
  else field.value = formatList(variable.default as readonly ScalarValue[]);
 };
</script>

<section class="blueprint-variables" aria-labelledby="blueprint-variables-heading">
 <header class="blueprint-drawer-header">
  <h3 id="blueprint-variables-heading">Variables</h3>
  {#if variables.length < 32}
   <Dropdown bind:value={picked} items={types} triggerLabel="Add variable" {disabled} align="end" class="blueprint-add" onselect={add}>
    {#snippet trigger()}<Plus size={14} />{/snippet}
   </Dropdown>
  {/if}
 </header>
 <div class="blueprint-variable-list">
 {#each variables as variable (variable.id)}
  <div class="blueprint-variable">
   <Input value={variable.name} {disabled} onchange={event => rename(variable, event.currentTarget)} />
   <button type="button" class="blueprint-icon-button blueprint-variable-remove" aria-label={`Remove ${variable.name}`} title="Remove" {disabled} onclick={() => onops([{ kind: 'removeVariable', graphId, variableId: variable.id }])}><Trash2 size={13} /></button>
   <Select value={variable.type} options={types} {disabled} onchange={event => { const type = asDataType(event.currentTarget.value); if (type) update(variable.id, { type }); }} />
   {#if variable.type === 'number' || variable.type === 'integer'}
    {@const type = variable.type}
    <Input type="number" step={type === 'integer' ? 1 : 'any'} value={String(variable.default)} {disabled} oninput={event => typed(variable, type, event.currentTarget.value)} onchange={event => settle(event.currentTarget, type, variable.default)} />
   {:else if variable.type === 'boolean'}
    <label class="blueprint-checkbox"><input type="checkbox" checked={variable.default} {disabled} onchange={event => update(variable.id, { default: event.currentTarget.checked })} />Default</label>
   {:else if variable.type === 'string'}
    <Input value={variable.default} {disabled} onchange={event => { if (parseScalar('string', event.currentTarget.value) === null) settle(event.currentTarget, 'string', variable.default); else typed(variable, 'string', event.currentTarget.value); }} />
   {:else if variable.type === 'vector3'}
    {@const vector = variable.default as Vec3}
    <div class="blueprint-vector">
     {#each vector as part, index (index)}
      <Input type="number" step="any" value={String(part)} {disabled} oninput={event => { const next = vectorParts(vector, index, event.currentTarget.value); if (next) update(variable.id, { default: next }); }} onchange={event => settle(event.currentTarget, 'number', part)} />
     {/each}
    </div>
   {:else}
    <Textarea class="blueprint-variable-items" rows={3} resize="vertical" value={formatList(variable.default as readonly ScalarValue[])} {disabled} onchange={event => list(variable, event.currentTarget)} />
   {/if}
  </div>
 {/each}
 </div>
</section>
