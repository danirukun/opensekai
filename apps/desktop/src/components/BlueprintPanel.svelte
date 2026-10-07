<script lang="ts">
 import { onMount } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { Play, Plus, Trash2 } from '@lucide/svelte';
 import { BLUEPRINT_LABELS, defaultBlueprintSettings, keystrokeAccelerator, type AppApi, type AppStatus, type BlueprintGraph, type BlueprintNode, type BlueprintStatus, type SceneView } from '@opensekai/contracts';
 import type { BlueprintSync, SyncIssue } from '../blueprints/blueprint-sync';
 import { currentPlatform, defaultKeystroke } from '../blueprints/keystroke-format';
 import type { BlueprintKind, ReteBlueprintEditor } from '../blueprints/rete-editor';
 import BlueprintList from './BlueprintList.svelte';
 import BlueprintNodeFields from './BlueprintNodeFields.svelte';

 let { api, sync, scene, status, disabled, onrun }: {
  api: AppApi | null; sync: BlueprintSync; scene: SceneView | null; status: AppStatus | null; disabled: boolean; onrun: () => void;
 } = $props();
 const platform = currentPlatform();
 let canvas: HTMLDivElement;
 let editor: ReteBlueprintEditor | null = null;
 let graphs = $state.raw<BlueprintGraph[]>([]);
 let errors = $state.raw<BlueprintStatus[]>([]);
 let issue = $state.raw<SyncIssue>(null);
 let selectedId = $state<string | null>(null);
 let nodeId = $state<string | null>(null);
 let addKind = $state<BlueprintKind>('flow.branch');
 let runError = $state<string | null>(null), busy = $state(false);
 let mountedFor: string | null = null, generation = 0, announced = '';
 const kinds = Object.entries(BLUEPRINT_LABELS) as [BlueprintKind, string][];
 const graph = $derived(graphs.find(item => item.id === selectedId) ?? null);
 const node = $derived(graph?.nodes.find(item => item.id === nodeId) ?? null);
 const trigger = $derived(graph?.nodes.find(item => item.type === 'event.manual') ?? null);
 const targets = $derived(scene?.entities.filter(entity => entity.kind !== 'tracking') ?? []);
 const cameras = $derived(scene?.entities.filter(entity => entity.kind === 'camera') ?? []);
 const failure = $derived(errors.find(item => item.graphId === selectedId));
 const problem = $derived(runError ?? failure?.error.message ?? (issue?.kind === 'rejected' ? 'Changed elsewhere' : issue?.kind === 'unavailable' ? 'Session unavailable' : ''));
 const taken = $derived(new Set((status?.warnings ?? []).flatMap(warning => warning.ids)));

 const edit = (ops: Parameters<BlueprintSync['edit']>[0]) => {
  const result = sync.edit(ops);
  if (!result.ok && graph) { const current = sync.view().find(item => item.id === graph.id); if (current) void editor?.show(current); }
  return result;
 };
 async function mount(id: string | null) {
  const mine = ++generation;
  editor?.destroy(); editor = null; mountedFor = id; nodeId = null;
  const target = graphs.find(item => item.id === id);
  if (!target) return;
  try {
   const { mountReteBlueprint } = await import('../blueprints/rete-editor');
   const mounted = await mountReteBlueprint(canvas, target, { onSelect: picked => { nodeId = picked; }, onOps: ops => { edit(ops); } });
   if (mine !== generation) { mounted.destroy(); return; }
   editor = mounted;
   const latest = sync.view().find(item => item.id === id);
   if (latest) void mounted.show(latest);
  } catch { if (mine === generation) runError = 'Blueprint canvas unavailable'; }
 }
 function choose(id: string | null) { selectedId = id; if (id !== mountedFor) void mount(id); }
 function revealError() {
  const first = errors.find(item => item.graphId === selectedId);
  const key = first ? JSON.stringify([first.graphId, first.kind, first.error.message, first.error.ids]) : '';
  if (key === announced) return;
  announced = key;
  const id = first?.error.ids.find(candidate => graph?.nodes.some(item => item.id === candidate));
  if (id) { nodeId = id; editor?.select(id); }
 }
 function update(next: BlueprintGraph[]) {
  graphs = next; errors = sync.errors(); issue = sync.issue();
  if (selectedId === null || !next.some(item => item.id === selectedId)) { choose(next[0]?.id ?? null); return; }
  if (nodeId && !graph?.nodes.some(item => item.id === nodeId)) nodeId = null;
  const current = next.find(item => item.id === selectedId);
  if (current) void editor?.show(current);
  revealError();
 }
 function create() {
  const entityId = targets[0]?.id ?? 'marker';
  const key = crypto.randomUUID(), act = crypto.randomUUID();
  const id = crypto.randomUUID();
  const settings = defaultKeystroke(platform);
  const result = edit([{ kind: 'createGraph', graph: {
   schemaVersion: 1, id, name: `Blueprint ${graphs.length + 1}`, enabled: true,
   nodes: [
    { id: key, version: 1, type: 'event.keystroke', settings, position: { x: 60, y: 80 } },
    { id: act, version: 1, type: 'scene.toggleVisibility', settings: { entityId }, position: { x: 380, y: 80 } },
   ],
   connections: [{ id: crypto.randomUUID(), sourceNodeId: key, sourcePort: 'flow', targetNodeId: act, targetPort: 'flow' }],
  } }]);
  if (result.ok) choose(id);
 }
 function add() {
  if (!graph || !editor) return;
  const { x, y } = editor.center(), offset = (graph.nodes.length % 5) * 24;
  const id = crypto.randomUUID();
  const settings = defaultBlueprintSettings(addKind, { entityId: targets[0]?.id ?? 'marker', cameraId: cameras[0]?.id ?? 'camera', keystroke: defaultKeystroke(platform) });
  const result = edit([{ kind: 'addNode', graphId: graph.id, node: { id, version: 1, type: addKind, settings, position: { x: x + offset, y: y + offset } } as BlueprintNode }]);
  if (!result.ok) return;
  nodeId = id;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor.show(latest).then(() => editor?.select(id));
 }
 function remove() { if (graph && nodeId) edit([{ kind: 'removeNode', graphId: graph.id, nodeId }]); }
 function settings(next: BlueprintNode['settings']) { if (graph && nodeId) edit([{ kind: 'setNodeSettings', graphId: graph.id, nodeId, settings: next }]); }
 async function run() {
  if (!api || !graph || !trigger || busy || disabled) return;
  busy = true; runError = null;
  try {
   const result = await api.blueprintRun({ graphId: graph.id, triggerNodeId: trigger.id });
   if (result.ok) onrun(); else runError = result.error.message;
  } catch { runError = 'Session unavailable'; }
  finally { busy = false; }
 }
 onMount(() => {
  const off = sync.subscribe(update);
  const timer = setInterval(() => { issue = sync.issue(); }, 500);
  void sync.load().then(() => update(sync.view()));
  update(sync.view());
  return () => { off(); clearInterval(timer); generation++; editor?.destroy(); editor = null; };
 });
</script>

<section class="blueprint-panel" aria-label="Blueprint editor">
 <header class="blueprint-toolbar"><h2>Blueprints</h2><span class="blueprint-state" role="status">{problem}</span><div class="spacer"></div>{#if trigger}<Button variant="secondary" disabled={disabled || busy || !graph} onclick={run}><Play size={14}/>Run</Button>{/if}</header>
 <div class="blueprint-workspace">
  <BlueprintList {graphs} {selectedId} {disabled} onselect={choose} onops={edit} oncreate={create} />
  <aside class="blueprint-palette" aria-label="Node palette"><select aria-label="Node kind" bind:value={addKind}>{#each kinds as [kind, label]}<option value={kind}>{label}</option>{/each}</select><Button variant="secondary" disabled={disabled || !graph} onclick={add}><Plus size={14}/>Add node</Button></aside>
  <div class="blueprint-canvas" bind:this={canvas} aria-label="Blueprint canvas"></div>
  <aside class="blueprint-inspector" aria-label="Node properties">
   {#if node}
    <strong>{BLUEPRINT_LABELS[node.type]}</strong>
    <BlueprintNodeFields {node} {scene} {platform} unavailable={node.type === 'event.keystroke' && taken.has(keystrokeAccelerator(node.settings))} onsettings={settings} />
    <Button variant="ghost" {disabled} onclick={remove}><Trash2 size={14}/>Delete node</Button>
   {/if}
  </aside>
 </div>
</section>
