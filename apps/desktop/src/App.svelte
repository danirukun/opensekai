<script lang="ts">
 import { onMount } from 'svelte';
 import { Button } from '@oshi-connect/ui';
 import { invoke } from '@tauri-apps/api/core';
 import { bootstrapDesktop } from './bootstrap';
 import type { AppStatus } from '@opensekai/contracts';
 let canvas: HTMLCanvasElement;
 let session: Awaited<ReturnType<typeof bootstrapDesktop>> | undefined;
 let version = $state('');
 let status = $state<AppStatus | null>(null);
 let error = $state<string | null>(null);
 let copied = $state(false);
 let busy = $state(false);
 let connected = $state(false);
 onMount(() => {
  let disposed = false;
  let polling = false;
  const poll = async () => {
   if (!session || polling) return;
   polling = true;
   try {
    const reply = await session.client.api.appStatus({});
    if (!disposed) {
     if (reply.ok) { status = reply.data; error = null; }
     else error = reply.error.message;
    }
   } finally { polling = false; }
  };
  const timer = setInterval(() => { void poll(); }, 500);
  void invoke<string>('app_version').then(value => { if (!disposed) version = value; }).catch(() => { if (!disposed) error = 'Version unavailable'; });
  void bootstrapDesktop(canvas).then(async value => {
   if (disposed) { await value.stop(); return; }
   session = value; connected = true; await poll();
  }).catch(cause => { if (!disposed) error = typeof cause?.message === 'string' ? cause.message : 'Session startup failed'; });
  return () => { disposed = true; clearInterval(timer); void session?.stop().catch(() => {}); };
 });
 async function selectCamera(cameraId: string) {
  if (!session || busy) return;
  busy = true;
  try {
   const scene = await session.client.api.sceneInspect({ sceneId: 'scene_smoke' });
   if (!scene.ok) throw scene.error;
   const main = await session.client.api.cameraSelect({ outputId: 'output_main', cameraId, expectedRevision: scene.data.revision });
   if (!main.ok) throw main.error;
   const preview = await session.client.api.cameraSelect({ outputId: 'preview_main', cameraId, expectedRevision: main.data.revision });
   if (!preview.ok) throw preview.error;
   error = null;
  } catch (cause) { error = (cause as { message?: string }).message ?? 'Camera selection failed'; }
  finally { busy = false; }
 }
 async function copyOutput() {
  if (!session) return;
  try { await navigator.clipboard.writeText(session.outputUrl); copied = true; }
  catch { error = 'Could not copy the output URL'; }
 }
</script>
<main>
 <header><h1>OpenSekai</h1><span>{version}</span></header>
 <div class="toolbar">
  <span class="scene-name">Smoke scene</span>
  <Button onclick={() => selectCamera('camera_wide')} disabled={!connected || busy}>Wide</Button>
  <Button onclick={() => selectCamera('camera_close')} disabled={!connected || busy}>Close</Button>
  <div class="spacer"></div>
  <Button onclick={copyOutput} disabled={!connected}>{copied ? 'Copied' : 'Copy OBS URL'}</Button>
 </div>
 <div class="viewport"><canvas bind:this={canvas} id="preview" aria-label="Scene preview"></canvas></div>
 <footer><span>{connected ? 'Session connected' : 'Starting…'}</span><span>{status?.outputs.find(output => output.outputId === 'output_main')?.connected ? 'OBS connected' : 'OBS disconnected'}</span></footer>
 {#if error}<p role="alert">{error}</p>{/if}
</main>
