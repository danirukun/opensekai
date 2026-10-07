<script lang="ts">
 import { onMount } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { Play, Plus, Trash2 } from '@lucide/svelte';
 import { compileBlueprint } from '@opensekai/session';
 import type { AppApi, BlueprintGraph, BlueprintNode, SceneView } from '@opensekai/contracts';
 import type { BlueprintKind, ReteBlueprintEditor } from '../blueprints/rete-editor';

 let { api, scene, disabled, draft, ondraft, onrun }: {
  api: AppApi | null; scene: SceneView | null; disabled: boolean;
  draft: BlueprintGraph | null; ondraft: (graph: BlueprintGraph) => void; onrun: () => void;
 } = $props();
 let canvas: HTMLDivElement;
 let editor = $state.raw<ReteBlueprintEditor | null>(null);
 let graph = $state<BlueprintGraph | null>(null);
 let selectedId = $state<string | null>(null);
 let addKind = $state<BlueprintKind>('event.manual');
 let status = $state('Draft');
 let busy = $state(false);
 const selected = $derived(graph?.nodes.find(node => node.id === selectedId) ?? null);
 const targets = $derived(scene?.entities.filter(entity => entity.kind !== 'tracking') ?? []);
 const kinds: { kind: BlueprintKind; label: string }[] = [
  { kind: 'event.manual', label: 'Manual Trigger' }, { kind: 'value.number', label: 'Number' },
  { kind: 'value.boolean', label: 'Boolean' }, { kind: 'math.add', label: 'Add' },
  { kind: 'logic.greater', label: 'Greater Than' }, { kind: 'scene.setVisibility', label: 'Set Visibility' },
 ];
 export function readDraft(): BlueprintGraph | null { return editor?.read() ?? draft; }
 function refresh() { if (editor) { graph = editor.read(); ondraft(graph); } }
 function changeSettings(settings: BlueprintNode['settings']) { if (!editor || !selectedId) return; editor.setSettings(selectedId, settings); refresh(); status = 'Draft'; }
 async function add() { if (!editor) return; await editor.add(addKind, targets[0]?.id ?? 'marker'); refresh(); status = 'Draft'; }
 async function remove() { if (!editor || !selectedId) return; await editor.remove(selectedId); selectedId = null; refresh(); status = 'Draft'; }
 async function run() {
  if (!api || !editor || busy || disabled) return;
  const current = editor.read(); graph = current;
  const valid = compileBlueprint(current);
  if (!valid.ok) { status = valid.error.message; return; }
  const trigger = current.nodes.find(node => node.type === 'event.manual');
  if (!trigger) { status = 'Add a Manual Trigger'; return; }
  busy = true;
  try {
   const result = await api.blueprintRun({ graph: current, triggerNodeId: trigger.id });
   status = result.ok ? 'Ran' : result.error.message;
   if (result.ok) onrun();
  } catch { status = 'Session unavailable'; }
  finally { busy = false; }
 }
 onMount(() => {
  let disposed = false;
  void import('../blueprints/rete-editor').then(async ({ mountReteBlueprint, initialBlueprint }) => {
   if (disposed) return;
   const mounted = await mountReteBlueprint(canvas, draft ?? initialBlueprint(targets[0]?.id ?? 'marker'), id => { selectedId = id; refresh(); });
   if (disposed) { mounted.destroy(); return; }
   editor = mounted; refresh();
  }).catch(() => { if (!disposed) status = 'Blueprint canvas unavailable'; });
  return () => { disposed = true; if (editor) { ondraft(editor.read()); editor.destroy(); editor = null; } };
 });
</script>

<section class="blueprint-panel" aria-label="Blueprint editor">
 <header class="blueprint-toolbar"><h2>Blueprints</h2><span class="blueprint-state">{status}</span><div class="spacer"></div><Button variant="secondary" disabled={disabled || busy || !editor} onclick={run}><Play size={14}/>Run</Button></header>
 <div class="blueprint-workspace">
  <aside class="blueprint-palette" aria-label="Node palette"><h3>Nodes</h3><select aria-label="Node kind" bind:value={addKind}>{#each kinds as entry}<option value={entry.kind}>{entry.label}</option>{/each}</select><Button variant="secondary" disabled={!editor} onclick={add}><Plus size={14}/>Add node</Button></aside>
  <div class="blueprint-canvas" bind:this={canvas} aria-label="Blueprint canvas"></div>
  <aside class="blueprint-inspector" aria-label="Node properties"><h3>Properties</h3>
   {#if selected}
    <strong>{kinds.find(entry => entry.kind === selected.type)?.label}</strong>
    {#if selected.type === 'value.number'}<label>Value<input type="number" value={selected.settings.value} oninput={event => { const value = Number(event.currentTarget.value); if (Number.isFinite(value)) changeSettings({ value }); }}/></label>{/if}
    {#if selected.type === 'value.boolean'}<label class="blueprint-checkbox"><input type="checkbox" checked={selected.settings.value} onchange={event => changeSettings({ value: event.currentTarget.checked })}/>Value</label>{/if}
    {#if selected.type === 'scene.setVisibility'}<label>Entity<select value={selected.settings.entityId} onchange={event => changeSettings({ entityId: event.currentTarget.value })}>{#each targets as target}<option value={target.id}>{target.name}</option>{/each}</select></label>{/if}
    <Button variant="ghost" onclick={remove}><Trash2 size={14}/>Delete node</Button>
   {/if}
  </aside>
 </div>
</section>
