<script lang="ts">
 import { Dropdown, Input, Select } from '@oshi-connect/ui';
 import { Plus, Trash2 } from '@lucide/svelte';
 import type { BlueprintOp, BlueprintVariable } from '@opensekai/contracts';
 import { newVariable } from '../blueprints/fields';

 let { graphId, variables, disabled, onops }: { graphId: string; variables: readonly BlueprintVariable[]; disabled: boolean; onops: (ops: BlueprintOp[]) => void } = $props();
 let picked = $state('');
 const types = [{ value: 'number', label: 'Number' }, { value: 'boolean', label: 'Boolean' }];
 const add = (type: string) => { picked = ''; onops([{ kind: 'addVariable', graphId, variable: newVariable(variables, type === 'boolean' ? 'boolean' : 'number', crypto.randomUUID()) }]); };
 const update = (variableId: string, change: { name?: string; type?: 'number' | 'boolean'; default?: number | boolean }) => onops([{ kind: 'updateVariable', graphId, variableId, ...change }]);
 const rename = (variable: BlueprintVariable, input: HTMLInputElement) => {
  const name = input.value.trim();
  if (name && name.length <= 64 && !variables.some(other => other.id !== variable.id && other.name === name)) update(variable.id, { name });
  else input.value = variable.name;
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
   <Select value={variable.type} options={types} {disabled} onchange={event => update(variable.id, { type: event.currentTarget.value === 'boolean' ? 'boolean' : 'number' })} />
   {#if variable.type === 'number'}
    <Input type="number" step="any" value={String(variable.default)} {disabled} oninput={event => { const value = Number(event.currentTarget.value); if (event.currentTarget.value !== '' && Number.isFinite(value)) update(variable.id, { default: value }); }} />
   {:else}
    <label class="blueprint-checkbox"><input type="checkbox" checked={variable.default} {disabled} onchange={event => update(variable.id, { default: event.currentTarget.checked })} />Default</label>
   {/if}
  </div>
 {/each}
 </div>
</section>
