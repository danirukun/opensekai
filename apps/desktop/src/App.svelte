<script lang="ts">
 import { onMount } from 'svelte';
 import { Button, Input } from '@oshi-connect/ui';
 import { invoke } from '@tauri-apps/api/core';
 let version = $state<string | null>(null);
 let error = $state<string | null>(null);
 let name = $state('Untitled scene');
 async function readVersion() {
  try { version = await invoke<string>('app_version'); error = null; }
  catch (cause) { error = String(cause); }
 }
 onMount(() => { void readVersion(); });
</script>
<main>
 <header><h1>OpenSekai</h1><span>{version ?? 'Starting…'}</span></header>
 <section aria-label="Scene"><Input label="Scene name" bind:value={name} /><Button onclick={readVersion}>Check version</Button></section>
 {#if error}<p role="alert">{error}</p>{/if}
</main>
