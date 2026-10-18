<script lang="ts">
 // Legacy props on purpose: Rete updates a node by passing the same mutated object, and only `$:` re-reads it.
 import { Ref } from 'rete-svelte-plugin/5';
 import { Input } from '@oshi-connect/ui';
 import { inlineInputType, nodeDefinition, unconnectedInputValue, type BlueprintNode, type ScalarType, type ScalarValue, type Vec3 } from '@opensekai/contracts';
 import { parseScalar, vectorParts } from '../blueprints/fields';

 type Port = { socket: unknown; label?: string; index?: number };
 export let data: { id: string; label: string; selected?: boolean; data?: BlueprintNode; wired?: ReadonlyMap<string, number>; editable?: boolean; setInput?: (port: string, value: ScalarValue | null) => void; inputs: Record<string, Port | undefined>; outputs: Record<string, Port | undefined> };
 export let emit: (props: unknown) => void;

 const sorted = (ports: Record<string, Port | undefined>) =>
  Object.entries(ports).filter((entry): entry is [string, Port] => entry[1] !== undefined).sort(([, a], [, b]) => (a.index ?? 0) - (b.index ?? 0));
 // Flow ports read from their chevron, so only data ports and branch names keep a label.
 const label = (name: string) => {
  if (name === 'flow' || name === 'exit') return '';
  // A Switch On Number case port shows the value it matches.
  const match = /^case(\d+)$/.exec(name);
  if (match && data.data?.type === 'flow.switch') return `= ${data.data.settings.cases[Number(match[1])]}`;
  return name.replace(/(\d+)$/, ' $1');
 };
 const socket = (side: 'input' | 'output', key: string, payload: unknown) => (element: HTMLElement) =>
  emit({ type: 'render', data: { type: 'socket', side, key, nodeId: data.id, element, payload } });
 const unmount = (element: HTMLElement) => emit({ type: 'unmount', data: { element } });
 // A scalar data input without a wire gets an inline editor; list inputs and wired inputs show only their label.
 const inline = (key: string): { type: ScalarType; value: ScalarValue } | null => {
  const node = data.data, type = node && !data.wired?.has(key) ? inlineInputType(node, key) : null;
  return node && type ? { type, value: unconnectedInputValue(node, key) as ScalarValue } : null;
 };
 const commit = (key: string, type: Exclude<ScalarType, 'boolean'>, field: HTMLInputElement, current: ScalarValue) => {
  const value = parseScalar(type, field.value);
  if (value === null) field.value = String(current);
  else if (value !== current) data.setInput?.(key, value);
 };
 const commitPart = (key: string, vector: Vec3, index: number, field: HTMLInputElement) => {
  const next = vectorParts(vector, index, field.value);
  if (next) data.setInput?.(key, next); else field.value = String(vector[index]);
 };
 // The node is dragged and selected on pointer down; an editor keeps the pointer for itself.
 const keep = (event: Event) => event.stopPropagation();

 $: inputs = sorted(data.inputs);
 $: outputs = sorted(data.outputs);
 $: editable = data.editable !== false;
 $: editors = data && Object.fromEntries(inputs.map(([key]) => [key, inline(key)]));
 $: category = data.data ? nodeDefinition(data.data.type).category.toLowerCase() : '';
</script>

<div class="bp-node" class:selected={data.selected} data-category={category} data-testid="node">
 <div class="bp-node-title"><span class="bp-node-dot" aria-hidden="true"></span>{data.label}</div>
 <div class="bp-node-body">
  <div class="bp-node-ports">
   {#each inputs as [key, input] (key)}
    {@const editor = editors[key]}
    <div class="bp-port input"><Ref class="bp-socket-ref" init={socket('input', key, input.socket)} {unmount} /><span>{label(key)}</span>
     {#if editor}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="bp-inline" data-type={editor.type} onpointerdown={keep} ondblclick={keep}>
       {#if editor.type === 'boolean'}
        <input type="checkbox" aria-label={label(key)} checked={editor.value === true} disabled={!editable} onchange={event => data.setInput?.(key, event.currentTarget.checked)} />
       {:else if editor.type === 'vector3'}
        {@const vector = editor.value as Vec3}
        {#each vector as part, index (index)}
         <Input type="number" step="any" value={String(part)} disabled={!editable} onchange={event => commitPart(key, vector, index, event.currentTarget)} />
        {/each}
       {:else}
        {@const type = editor.type}
        {@const current = editor.value}
        <Input type={type === 'string' ? 'text' : 'number'} step={type === 'integer' ? 1 : type === 'number' ? 'any' : undefined} value={String(current)} disabled={!editable} onchange={event => commit(key, type, event.currentTarget, current)} />
       {/if}
      </span>
     {/if}
    </div>
   {/each}
  </div>
  <div class="bp-node-ports outputs">
   {#each outputs as [key, output] (key)}
    <div class="bp-port output"><span>{label(key)}</span><Ref class="bp-socket-ref" init={socket('output', key, output.socket)} {unmount} /></div>
   {/each}
  </div>
 </div>
</div>
