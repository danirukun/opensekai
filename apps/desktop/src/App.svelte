<script lang="ts">
 import { onMount } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { bootstrapDesktop } from './bootstrap';
 import { createEditorModel } from './editor/model';
 import { createEditorPoll } from './editor-poll';
 import Hierarchy from './components/Hierarchy.svelte';
 import Inspector from './components/Inspector.svelte';
 import OutputControls from './components/OutputControls.svelte';
 import AssetList from './components/AssetList.svelte';
 import type { EditorModel, EditorView } from './editor/model';
 import type { AppStatus, AssetRecord, AppError } from '@opensekai/contracts';
 let canvas: HTMLCanvasElement;
 let session: Awaited<ReturnType<typeof bootstrapDesktop>> | undefined;
 let model = $state.raw<EditorModel | undefined>();
 let view = $state<EditorView>({ scene: null, selectedId: null, error: null, pending: false });
 let version = $state('');
 let status = $state<AppStatus | null>(null);
 let error = $state<string | null>(null);
 let outputUrl = $state('');
 let assets = $state<AssetRecord[]>([]);
 const warnings = $derived.by(() => {
  const seen = new Set<string>();
  return [...(status?.warnings ?? []), ...(status?.outputs.flatMap(output => output.lastFrame?.warnings ?? []) ?? [])].filter((warning: AppError) => {
   const key = JSON.stringify([warning.code, warning.message, warning.ids]);
   if (seen.has(key)) return false;
   seen.add(key); return true;
  });
 });
 onMount(() => {
  let disposed = false;
  let unsubscribe = () => {};
  let poll: ReturnType<typeof createEditorPoll> | undefined;
  const timer = setInterval(() => { void poll?.poll(); }, 500);
  void invoke<string>('app_version').then(value => { if (!disposed) version = value; }).catch(() => { if (!disposed) error = 'Version unavailable'; });
  void bootstrapDesktop(canvas).then(async value => {
   if (disposed) { await value.stop(); return; }
   session = value; outputUrl = value.outputUrl; assets = value.assets;
   const editor = createEditorModel(value.client.api);
   model = editor;
   unsubscribe = editor.subscribe(next => { if (!disposed) view = next; });
   poll = createEditorPoll(value.client.api, editor, next => { if (!disposed) {status = next; error = null;} }, code => { if (!disposed) error = code; });
   await poll.poll();
  }).catch(cause => { if (!disposed) error = typeof cause?.message === 'string' ? cause.message : 'Session startup failed'; });
  return () => { disposed = true; clearInterval(timer); poll?.close(); unsubscribe(); void session?.stop().catch(() => {}); };
 });
</script>
<main>
 <header><h1>OpenSekai</h1><span>{version}</span></header>
 {#if model}<OutputControls {model} {view} {status} {outputUrl} />{/if}
 <div class="editor-grid">
  {#if model}<Hierarchy {model} {view} />{:else}<section class="editor-panel hierarchy"><h2>Scene</h2></section>{/if}
  <div class="viewport"><canvas bind:this={canvas} id="preview" aria-label="Scene preview"></canvas></div>
  {#if model}<Inspector {model} {view} />{:else}<section class="editor-panel inspector"><h2>Inspector</h2></section>{/if}
  <AssetList {assets} {warnings} />
 </div>
 <footer><span>{status ? 'Session connected' : 'Starting…'}</span><span>{view.scene ? `Revision ${view.scene.revision}` : ''}</span></footer>
 {#if error}<p role="alert">{error}</p>{/if}
</main>
