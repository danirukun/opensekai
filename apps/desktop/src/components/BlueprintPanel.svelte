<script lang="ts">
 import { onMount, tick } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { Button, Textarea } from '@oshi-connect/ui';
 import { Play, Search, Trash2, Variable } from '@lucide/svelte';
 import { BLUEPRINT_LABELS, blueprintPorts, exportBlueprint, importBlueprint, serializeBlueprintFile, nodeDefinition, defaultBlueprintSettings, keystrokeAccelerator, type AppApi, type AppStatus, type BlueprintGraph, type BlueprintNode, type BlueprintOp, type BlueprintStatus, type DefaultRefs, type SceneView, type AssetRecord, triggerableExpressions } from '@opensekai/contracts';
 import { issueText, type BlueprintSync, type SyncIssue } from '../blueprints/blueprint-sync';
 import { currentPlatform, defaultKeystroke } from '../blueprints/keystroke-format';
 import type { MenuTarget, ReteBlueprintEditor } from '../blueprints/rete-editor';
 import { deleteOps, disconnectOps } from '../blueprints/selection-ops';
 import { freeSpot } from '../blueprints/placement';
 import { templatesEnabled, upperBodyRotation } from '../blueprints/templates';
 import { shortcutFor } from '../blueprints/keys';
 import { copyNodes, duplicateAnchor, pasteOps, type BlueprintClipboard } from '../blueprints/clipboard';
 import { formatLayout, formatOps } from '../blueprints/layout';
 import { wrapComment } from '../blueprints/comments';
 import type { EditorMemory } from '../blueprints/editor-memory';
 import type { SearchEntry, WireNeed } from '../blueprints/node-search';
 import CanvasMenu from './CanvasMenu.svelte';
 import NodeSearch from './NodeSearch.svelte';
 import BlueprintList from './BlueprintList.svelte';
 import BlueprintNodeFields from './BlueprintNodeFields.svelte';
 import BlueprintVariables from './BlueprintVariables.svelte';
 import BlueprintNodeView from './BlueprintNodeView.svelte';
 import BlueprintSocketView from './BlueprintSocketView.svelte';
 import BlueprintConnectionView from './BlueprintConnectionView.svelte';

 let { api, sync, memory, scene, assets = [], status, disabled, selectedEntityId = null, onrun }: {
  api: AppApi | null; sync: BlueprintSync; memory: EditorMemory; scene: SceneView | null; assets?: readonly AssetRecord[]; status: AppStatus | null; disabled: boolean; selectedEntityId?: string | null; onrun: () => void;
 } = $props();
 const platform = currentPlatform();
 let canvas: HTMLDivElement;
 let editor: ReteBlueprintEditor | null = null;
 let graphs = $state.raw<BlueprintGraph[]>([]);
 let errors = $state.raw<BlueprintStatus[]>([]);
 let issue = $state.raw<SyncIssue>(null);
 let selectedId = $state<string | null>(null);
 let nodeId = $state<string | null>(null);
 let commentIds = $state.raw<string[]>([]);
 const commentField = 'blueprint-comment-text';
 let missing = $state<string[]>([]);
 let importing = false;
 let runError = $state<string | null>(null), busy = $state(false);
 type Drawer = 'nodes' | 'variables' | null;
 const DRAWER_KEY = 'opensekai.blueprint.drawer';
 const storedDrawer = (): Drawer => { try { const value = localStorage.getItem(DRAWER_KEY); return value === 'nodes' || value === 'variables' || value === 'none' ? (value === 'none' ? null : value) : 'nodes'; } catch { return 'nodes'; } };
 let drawer = $state<Drawer>(storedDrawer());
 function toggleDrawer(next: Exclude<Drawer, null>) {
  drawer = drawer === next ? null : next;
  try { localStorage.setItem(DRAWER_KEY, drawer ?? 'none'); } catch { /* the choice is a convenience only */ }
 }
 let mountedFor: string | null = null, generation = 0, announced = '';
 const history: EditorMemory['history'] = {
  record: (...args) => memory.history.record(...args), undo: (...args) => memory.history.undo(...args), redo: (...args) => memory.history.redo(...args),
  canUndo: id => memory.history.canUndo(id), canRedo: id => memory.history.canRedo(id), clear: () => memory.history.clear(),
 };
 let clipboard = $state.raw<BlueprintClipboard | null>(null), changedElsewhere = $state(false);
 const remember = (clip: BlueprintClipboard | null) => { clipboard = memory.clipboard.current = clip ?? clipboard; };
 const graph = $derived(graphs.find(item => item.id === selectedId) ?? null);
 const node = $derived(graph?.nodes.find(item => item.id === nodeId) ?? null);
 const comment = $derived(!node && commentIds.length === 1 ? graph?.comments?.find(item => item.id === commentIds[0]) ?? null : null);
 const trigger = $derived(graph?.nodes.find(item => item.type === 'event.manual') ?? null);
 const targets = $derived(scene?.entities.filter(entity => entity.kind !== 'tracking') ?? []);
 const cameras = $derived(scene?.entities.filter(entity => entity.kind === 'camera') ?? []);
 const failure = $derived(errors.find(item => item.graphId === selectedId));
 const problem = $derived(runError ?? failure?.error.message ?? (issueText(issue) || (changedElsewhere ? 'Changed elsewhere' : null)) ?? (missing.length ? `Missing: ${missing.join(', ')}` : null));
 const outputId = $derived(scene?.outputs[0]?.id);
 // The first character whose model has a triggerable expression, for the Character node defaults.
 const face = $derived((scene?.entities ?? []).flatMap(entity => {
  const record = entity.kind === 'avatar' && entity.assetId !== null ? assets.find(asset => asset.id === entity.assetId) : undefined;
  const first = record ? triggerableExpressions(record)[0] : undefined;
  return first ? [{ avatarId: entity.id, expression: first.name }] : [];
 })[0]);
 const refs = $derived<DefaultRefs>({ entityId: targets[0]?.id, avatarId: face?.avatarId, expression: face?.expression, cameraId: cameras[0]?.id, outputId, keystroke: defaultKeystroke(platform), variables: graph?.variables ?? [] });
 const taken = $derived(new Set((status?.warnings ?? []).flatMap(warning => warning.ids)));
 const inputWarning = $derived(status?.warnings.find(warning => warning.ids.includes('input-monitoring')));
 function openInputSettings() { try { void invoke('open_input_monitoring_settings').catch(() => {}); } catch { /* outside Tauri */ } }

 const edit = (ops: Parameters<BlueprintSync['edit']>[0]) => {
  missing = [];
  const result = sync.edit(ops);
  if (!result.ok && graph) { const current = sync.view().find(item => item.id === graph.id); if (current) void editor?.show(current); }
  return result;
 };

 const act = (ops: BlueprintOp[]) => {
  const before = sync.view().find(item => item.id === selectedId);
  if (ops.length === 0 || !before) return { ok: true, data: sync.view() } as const;
  const result = edit(ops);
  if (result.ok) { changedElsewhere = false; const after = result.data.find(item => item.id === before.id); if (after) history.record(before.id, before, after, ops); }
  return result;
 };
 const send = (ops: BlueprintOp[]) => edit(ops).ok;
 function step(kind: 'undo' | 'redo', id: string) {
  const available = kind === 'undo' ? history.canUndo(id) : history.canRedo(id);
  const done = kind === 'undo' ? history.undo(id, send) : history.redo(id, send);
  changedElsewhere = available && !done;
 }
 function paste(clip: BlueprintClipboard, anchor: { x: number; y: number }) {
  if (!graph) return;
  const { ops, nodeIds, commentIds: notes } = pasteOps(clip, graph.id, anchor);
  if (!act(ops).ok) return;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor?.show(latest).then(() => { editor?.selectMany(nodeIds); editor?.selectComments(notes); });
 }
 // The selected nodes, or the whole graph when fewer than two nodes are selected.
 function format(ids: string[]) {
  if (!graph || !editor) return;
  const chosen = ids.length > 1 ? graph.nodes.filter(item => ids.includes(item.id)) : graph.nodes;
  act(formatOps(graph.id, chosen, formatLayout(chosen, graph.connections, editor.sizes())));
 }
 function addComment(ids: string[], at: { x: number; y: number }) {
  if (!graph || !editor) return;
  const added = wrapComment(crypto.randomUUID(), editor.boxes().filter(box => ids.includes(box.id)), at);
  if (!act([{ kind: 'addComment', graphId: graph.id, comment: added }]).ok) return;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor.show(latest).then(() => { editor?.select(null); editor?.selectComments([added.id]); });
 }
 async function openComment(id: string) {
  commentIds = [id]; nodeId = null;
  await tick();
  (document.getElementById(commentField) as HTMLTextAreaElement | null)?.focus();
 }
 function commentText(text: string) {
  if (graph && comment && text !== comment.text) act([{ kind: 'updateComment', graphId: graph.id, commentId: comment.id, text: text.slice(0, 512) }]);
 }
 function shortcut(event: KeyboardEvent) {
  const action = shortcutFor(event, platform);
  if (!action || !graph || !editor) return;
  event.preventDefault();
  if (disabled && !['copy', 'selectAll', 'escape'].includes(action)) return;
  const selection = editor.selected(), notes = editor.selectedComments();
  if (action === 'delete') act(deleteOps(graph, selection, notes));
  if (action === 'copy') remember(copyNodes(graph, selection, notes));
  if (action === 'paste' && clipboard) paste(clipboard, editor.pointer());
  if (action === 'duplicate') { const clip = copyNodes(graph, selection, notes); if (clip) paste(clip, duplicateAnchor(clip)); }
  if (action === 'selectAll') { editor.selectMany(graph.nodes.map(item => item.id)); editor.selectComments((graph.comments ?? []).map(item => item.id)); }
  if (action === 'undo') step('undo', graph.id);
  if (action === 'redo') step('redo', graph.id);
  if (action === 'escape') { if (menu) menu = null; else { editor.select(null); nodeId = null; } }
 }
 async function mount(id: string | null) {
  const mine = ++generation;
  editor?.destroy(); editor = null; mountedFor = id; nodeId = null; commentIds = [];
  const target = graphs.find(item => item.id === id);
  if (!target) return;
  try {
   const { mountReteBlueprint } = await import('../blueprints/rete-editor');
   const mounted = await mountReteBlueprint(canvas, target, { onSelect: picked => { nodeId = picked; }, onOps: ops => { act(ops); }, onContextMenu: openMenu, onWireDrop: openDrop, onCommentSelect: ids => { commentIds = ids; }, onCommentOpen: id => { void openComment(id); } }, { views: { node: BlueprintNodeView, socket: BlueprintSocketView, connection: BlueprintConnectionView } });
   if (mine !== generation) { mounted.destroy(); return; }
   editor = mounted;
   const latest = sync.view().find(item => item.id === id);
   if (latest) void mounted.show(latest);
  } catch { if (mine === generation) runError = 'Blueprint canvas unavailable'; }
 }
 function choose(id: string | null) { missing = []; selectedId = id; if (id !== mountedFor) void mount(id); }
 function revealError() {
  const first = errors.find(item => item.graphId === selectedId);
  const key = first ? JSON.stringify([first.graphId, first.kind, first.error.message, first.error.ids]) : '';
  if (key === announced) return;
  announced = key;
  const id = first?.error.ids.find(candidate => graph?.nodes.some(item => item.id === candidate));
  if (id) { nodeId = id; editor?.select(id); }
 }
 function update(next: BlueprintGraph[]) {
  if (sync.revision() < memory.seen.revision) history.clear();
  memory.seen.revision = sync.revision();
  graphs = next; errors = sync.errors(); issue = sync.issue();
  if (selectedId === null || !next.some(item => item.id === selectedId)) { choose(next[0]?.id ?? null); return; }
  if (nodeId && !graph?.nodes.some(item => item.id === nodeId)) nodeId = null;
  if (commentIds.some(id => !graph?.comments?.some(item => item.id === id))) commentIds = commentIds.filter(id => graph?.comments?.some(item => item.id === id));
  const current = next.find(item => item.id === selectedId);
  if (current) void editor?.show(current);
  revealError();
 }
 function create() {
  const entityId = targets[0]?.id;
  if (!entityId) return;
  const key = crypto.randomUUID(), act = crypto.randomUUID();
  const id = crypto.randomUUID();
  const settings = defaultKeystroke(platform);
  const result = edit([{ kind: 'createGraph', graph: {
   schemaVersion: 1, id, name: `Blueprint ${graphs.length + 1}`, enabled: true, variables: [],
   nodes: [
    { id: key, version: 1, type: 'event.keystroke', settings, position: { x: 60, y: 80 } },
    { id: act, version: 1, type: 'scene.toggleVisibility', settings: { entityId }, position: { x: 380, y: 80 } },
   ],
   connections: [{ id: crypto.randomUUID(), sourceNodeId: key, sourcePort: 'flow', targetNodeId: act, targetPort: 'flow' }],
  } }]);
  if (result.ok) choose(id);
 }
 const message = (error: unknown, fallback: string) => typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : fallback;
 async function importFile() {
  if (!scene || disabled || importing) return;
  let text: string | null;
  importing = true;
  try { text = await invoke<string | null>('import_blueprint_file'); } catch (error) { runError = message(error, 'Import failed'); return; } finally { importing = false; }
  // The session can go away while the dialog is open.
  if (text === null || !scene || disabled) return;
  const imported = importBlueprint(text, scene, () => crypto.randomUUID());
  if (!imported.ok) { runError = imported.error.message; return; }
  const result = edit([{ kind: 'createGraph', graph: imported.data.graph }]);
  if (!result.ok) { runError = result.error.message; return; }
  runError = null;
  choose(imported.data.graph.id);
  missing = imported.data.report.missing.map(item => item.name);
 }
 function addTemplate() {
  if (!scene || disabled || !templatesEnabled(scene, graphs.length)) return;
  const imported = upperBodyRotation(scene, selectedEntityId, () => crypto.randomUUID());
  if (!imported.ok) { runError = imported.error.message; return; }
  const result = edit([{ kind: 'createGraph', graph: imported.data.graph }]);
  if (!result.ok) { runError = result.error.message; return; }
  runError = null;
  choose(imported.data.graph.id);
  missing = imported.data.report.missing.map(item => item.name);
 }
 function duplicate(id: string) {
  if (disabled) return;
  const newGraphId = crypto.randomUUID();
  const result = edit([{ kind: 'duplicateGraph', graphId: id, newGraphId }]);
  if (!result.ok) { runError = result.error.message; return; }
  runError = null;
  choose(newGraphId);
 }
 async function exportFile(id: string) {
  if (!api || !scene) return;
  try {
   const reply = await api.blueprintInspect({});
   const stored = reply.ok && reply.data.kind === 'snapshot' ? reply.data.blueprints.find(item => item.id === id) : undefined;
   if (!stored) { runError = 'Blueprint not found'; return; }
   await invoke('export_blueprint_file', { name: stored.name, text: serializeBlueprintFile(exportBlueprint(stored, scene)) });
   runError = null;
  } catch (error) { runError = message(error, 'Export failed'); }
 }
 type Wire = { nodeId: string; port: string; side: 'input' | 'output' };
 type Menu = { x: number; y: number; at: { x: number; y: number } } & ({ kind: 'canvas' } | { kind: 'node'; nodeIds: string[] } | { kind: 'wire'; connectionId: string } | { kind: 'comment'; commentId: string } | { kind: 'drop'; from: Wire; need: WireNeed });
 let menu = $state.raw<Menu | null>(null);
 function addAt(entry: SearchEntry, at: { x: number; y: number }, from?: Wire) {
  const settings = defaultBlueprintSettings(entry.type, refs);
  if (!graph || !settings) return;
  const id = crypto.randomUUID();
  const ops: BlueprintOp[] = [{ kind: 'addNode', graphId: graph.id, node: { id, version: 1, type: entry.type, settings, position: at } as BlueprintNode }];
  if (from && entry.port) ops.push({ kind: 'connect', graphId: graph.id, connection: from.side === 'output'
   ? { id: crypto.randomUUID(), sourceNodeId: from.nodeId, sourcePort: from.port, targetNodeId: id, targetPort: entry.port }
   : { id: crypto.randomUUID(), sourceNodeId: id, sourcePort: entry.port, targetNodeId: from.nodeId, targetPort: from.port } });
  menu = null;
  canvas.focus({ preventScroll: true });
  if (!act(ops).ok) return;
  nodeId = id;
  const latest = sync.view().find(item => item.id === graph!.id);
  if (latest) void editor?.show(latest).then(() => editor?.select(id));
 }
 function openMenu(target: MenuTarget, client: { x: number; y: number }) {
  if (!editor || !graph || disabled) return;
  const at = editor.pointer(), place = { x: client.x, y: client.y, at };
  if (target.kind === 'canvas') menu = { ...place, kind: 'canvas' };
  else if (target.kind === 'wire') menu = { ...place, kind: 'wire', connectionId: target.connectionId };
  else if (target.kind === 'comment') menu = { ...place, kind: 'comment', commentId: target.commentId };
  else {
   const selection = editor.selected();
   const nodeIds = selection.length > 1 && selection.includes(target.nodeId) ? selection : [target.nodeId];
   if (nodeIds.length === 1) { editor.select(target.nodeId); nodeId = target.nodeId; }
   menu = { ...place, kind: 'node', nodeIds };
  }
 }
 function openDrop(from: Wire, client: { x: number; y: number }) {
  const source = graph?.nodes.find(item => item.id === from.nodeId);
  if (!editor || !source || disabled) return;
  const type = blueprintPorts(source)[from.side === 'output' ? 'outputs' : 'inputs'][from.port];
  if (!type) return;
  menu = { x: client.x, y: client.y, at: editor.pointer(), kind: 'drop', from, need: { side: from.side === 'output' ? 'inputs' : 'outputs', type } };
 }
 const nodeItems = (ids: string[]) => [
  { value: 'delete', label: 'Delete' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'copy', label: 'Copy' },
  { value: 'disconnect', label: 'Disconnect all' },
  ...(ids.length > 1 ? [{ value: 'format', label: 'Format' }] : []),
  { value: 'comment', label: 'Add comment' },
  ...(ids.length === 1 && graph?.nodes.find(item => item.id === ids[0])?.type === 'event.manual' ? [{ value: 'run', label: 'Run' }] : []),
 ];
 function pick(action: string) {
  const current = menu;
  menu = null;
  canvas.focus({ preventScroll: true });
  if (!graph || !current) return;
  if (current.kind === 'node' && action === 'delete') act(deleteOps(graph, current.nodeIds));
  if (current.kind === 'node' && action === 'disconnect') act(disconnectOps(graph, current.nodeIds));
  if (current.kind === 'node' && action === 'copy') remember(copyNodes(graph, current.nodeIds));
  if (current.kind === 'node' && action === 'duplicate') { const clip = copyNodes(graph, current.nodeIds); if (clip) paste(clip, duplicateAnchor(clip)); }
  if (current.kind === 'canvas' && action === 'paste' && clipboard) paste(clipboard, current.at);
  if (current.kind === 'node' && action === 'run') void run(current.nodeIds[0]!);
  if (current.kind === 'wire' && action === 'delete') act([{ kind: 'disconnect', graphId: graph.id, connectionId: current.connectionId }]);
  if (current.kind === 'canvas' && action === 'selectAll') { editor?.selectMany(graph.nodes.map(item => item.id)); editor?.selectComments((graph.comments ?? []).map(item => item.id)); }
  if (current.kind === 'canvas' && action === 'format') format(editor?.selected() ?? []);
  if (current.kind === 'node' && action === 'format') format(current.nodeIds);
  if (current.kind === 'canvas' && action === 'comment') addComment(editor?.selected() ?? [], current.at);
  if (current.kind === 'node' && action === 'comment') addComment(current.nodeIds, current.at);
  if (current.kind === 'comment' && action === 'delete') act(deleteOps(graph, [], [current.commentId]));
 }
 function remove() { if (graph && nodeId) act(deleteOps(graph, [nodeId])); }
 function removeComment() { if (graph && comment) act(deleteOps(graph, [], [comment.id])); }
 function settings(next: BlueprintNode['settings']) { if (graph && nodeId) act([{ kind: 'setNodeSettings', graphId: graph.id, nodeId, settings: next }]); }
 async function run(triggerId = trigger?.id) {
  if (!api || !graph || !triggerId || busy || disabled) return;
  busy = true; runError = null;
  try {
   const result = await api.blueprintRun({ graphId: graph.id, triggerNodeId: triggerId });
   if (result.ok) onrun(); else runError = result.error.message;
  } catch { runError = 'Session unavailable'; }
  finally { busy = false; }
 }
 onMount(() => {
  clipboard = memory.clipboard.current;
  const off = sync.subscribe(update);
  const timer = setInterval(() => { issue = sync.issue(); }, 500);
  void sync.load().then(() => update(sync.view()));
  update(sync.view());
  return () => { off(); clearInterval(timer); generation++; editor?.destroy(); editor = null; };
 });
</script>

<section class="blueprint-panel" aria-label="Blueprint editor">
 <header class="blueprint-toolbar"><h2>Blueprints</h2><span class="blueprint-state" role="status">{problem}</span><div class="spacer"></div>{#if trigger}<Button variant="secondary" disabled={disabled || busy || !graph} onclick={() => run()}><Play size={14}/>Run</Button>{/if}</header>
 {#if inputWarning}<div class="blueprint-warning" role="alert">{inputWarning.message}{#if inputWarning.code === 'FORBIDDEN'}<Button variant="secondary" onclick={openInputSettings}>Open Settings</Button>{/if}</div>{/if}
 <div class="blueprint-workspace">
  <BlueprintList {graphs} {selectedId} {disabled} creatable={targets.length > 0} onselect={choose} onops={edit} oncreate={create} onimport={importFile} templatable={templatesEnabled(scene, graphs.length)} ontemplate={addTemplate} onexport={exportFile} onduplicate={duplicate} />
  <nav class="blueprint-tools" aria-label="Blueprint tools">
   <button type="button" class:active={drawer === 'nodes'} aria-pressed={drawer === 'nodes'} title="Nodes" aria-label="Nodes" onclick={() => toggleDrawer('nodes')}><Search size={16} /></button>
   <button type="button" class:active={drawer === 'variables'} aria-pressed={drawer === 'variables'} title="Variables" aria-label="Variables" onclick={() => toggleDrawer('variables')}><Variable size={16} /></button>
  </nav>
  {#if drawer === 'nodes'}
   <aside class="blueprint-drawer" aria-label="Nodes"><NodeSearch {refs} prefs={memory.palette} menu disabled={disabled || !graph} onpick={entry => addAt(entry, freeSpot(graph?.nodes ?? [], editor?.center() ?? { x: 0, y: 0 }))} /></aside>
  {:else if drawer === 'variables' && graph}
   <aside class="blueprint-drawer"><BlueprintVariables graphId={graph.id} variables={graph.variables} {disabled} onops={ops => { act(ops); }} /></aside>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="blueprint-canvas" bind:this={canvas} tabindex="0" role="application" aria-label="Blueprint canvas" onkeydown={shortcut} onpointerdown={() => canvas.focus()}></div>
  {#if node}
  <aside class="blueprint-inspector" aria-label="Node properties">
    <strong>{BLUEPRINT_LABELS[node.type]}</strong>
    <span class="blueprint-inspector-category" data-category={nodeDefinition(node.type).category.toLowerCase()}>{nodeDefinition(node.type).category}</span>
    <BlueprintNodeFields {node} {scene} {assets} variables={graph?.variables ?? []} {platform} unavailable={node.type === 'event.keystroke' && taken.has(keystrokeAccelerator(node.settings))} onsettings={settings} />
    <Button variant="ghost" {disabled} onclick={remove}><Trash2 size={14}/>Delete node</Button>
  </aside>
  {:else if comment}
  <aside class="blueprint-inspector" aria-label="Comment">
   {#key comment.id}<Textarea id={commentField} label="Comment" value={comment.text} rows={6} maxlength={512} resize="vertical" {disabled} onchange={event => commentText(event.currentTarget.value)} />{/key}
   <Button variant="ghost" {disabled} onclick={removeComment}><Trash2 size={14}/>Delete comment</Button>
  </aside>
  {/if}
 </div>
 {#if menu}
  <CanvasMenu x={menu.x} y={menu.y} onclose={() => { menu = null; canvas.focus({ preventScroll: true }); }} onpick={pick}
   items={menu.kind === 'node' ? nodeItems(menu.nodeIds) : menu.kind === 'wire' || menu.kind === 'comment' ? [{ value: 'delete', label: 'Delete' }] : menu.kind === 'canvas' ? [...(clipboard ? [{ value: 'paste', label: 'Paste' }] : []), { value: 'selectAll', label: 'Select all' }, { value: 'format', label: 'Format' }, { value: 'comment', label: 'Add comment' }] : []}>
   {#if menu.kind === 'canvas' || menu.kind === 'drop'}
    {@const at = menu.at}
    {@const from = menu.kind === 'drop' ? menu.from : undefined}
    <NodeSearch {refs} prefs={memory.palette} need={menu.kind === 'drop' ? menu.need : undefined} focus onpick={entry => addAt(entry, at, from)} />
   {/if}
  </CanvasMenu>
 {/if}
</section>
