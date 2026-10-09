<script lang="ts">
 // Legacy props on purpose: Rete updates a node by passing the same mutated object, and only `$:` re-reads it.
 import { Ref } from 'rete-svelte-plugin/5';
 import { nodeDefinition, type BlueprintNode } from '@opensekai/contracts';

 type Port = { socket: unknown; label?: string; index?: number };
 export let data: { id: string; label: string; selected?: boolean; data?: BlueprintNode; inputs: Record<string, Port | undefined>; outputs: Record<string, Port | undefined> };
 export let emit: (props: unknown) => void;

 const sorted = (ports: Record<string, Port | undefined>) =>
  Object.entries(ports).filter((entry): entry is [string, Port] => entry[1] !== undefined).sort(([, a], [, b]) => (a.index ?? 0) - (b.index ?? 0));
 // Flow ports read from their chevron, so only data ports and branch names keep a label.
 const label = (name: string) => name === 'flow' || name === 'exit' ? '' : name.replace(/(\d+)$/, ' $1');
 const socket = (side: 'input' | 'output', key: string, payload: unknown) => (element: HTMLElement) =>
  emit({ type: 'render', data: { type: 'socket', side, key, nodeId: data.id, element, payload } });
 const unmount = (element: HTMLElement) => emit({ type: 'unmount', data: { element } });

 $: inputs = sorted(data.inputs);
 $: outputs = sorted(data.outputs);
 $: category = data.data ? nodeDefinition(data.data.type).category.toLowerCase() : '';
</script>

<div class="bp-node" class:selected={data.selected} data-category={category} data-testid="node">
 <div class="bp-node-title"><span class="bp-node-dot" aria-hidden="true"></span>{data.label}</div>
 <div class="bp-node-body">
  <div class="bp-node-ports">
   {#each inputs as [key, input] (key)}
    <div class="bp-port input"><Ref class="bp-socket-ref" init={socket('input', key, input.socket)} {unmount} /><span>{label(key)}</span></div>
   {/each}
  </div>
  <div class="bp-node-ports outputs">
   {#each outputs as [key, output] (key)}
    <div class="bp-port output"><span>{label(key)}</span><Ref class="bp-socket-ref" init={socket('output', key, output.socket)} {unmount} /></div>
   {/each}
  </div>
 </div>
</div>
