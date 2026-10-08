<script lang="ts">
 import { invoke } from '@tauri-apps/api/core';
 import { onDestroy } from 'svelte';
 import { KEYSTROKE_CODES, keystrokeHasModifier, type KeystrokeSettings } from '@opensekai/contracts';
 import { formatKeystroke } from '../blueprints/keystroke-format';

 let { value, platform, unavailable = false, onchange }: {
  value: KeystrokeSettings; platform: string; unavailable?: boolean; onchange: (next: KeystrokeSettings) => void;
 } = $props();
 let armed = $state(false), rejected = $state(false), timer: ReturnType<typeof setTimeout> | undefined;
 // A registered global hotkey never reaches the page, so the host suspends them while a key is captured.
 function suspendHotkeys(active: boolean) { try { void invoke('set_keystroke_capture', { active }).catch(() => {}); } catch { /* outside Tauri */ } }
 function arm() { if (armed) return; armed = true; suspendHotkeys(true); }
 function disarm() { if (!armed) return; armed = false; suspendHotkeys(false); }
 onDestroy(disarm);
 function capture(event: KeyboardEvent) {
  if (!armed) return;
  event.preventDefault();
  if (event.code === 'Escape') { disarm(); return; }
  if (!KEYSTROKE_CODES.includes(event.code)) return;
  const next: KeystrokeSettings = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  if (!keystrokeHasModifier(next)) {
   rejected = true; clearTimeout(timer);
   timer = setTimeout(() => { rejected = false; }, 1000);
   return;
  }
  disarm();
  onchange(next);
 }
</script>

<svelte:window onkeydowncapture={capture} />
<!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
<button type="button" class="keystroke-field" class:armed aria-label="Keystroke" aria-invalid={unavailable || rejected} onclick={arm} onblur={disarm}>{armed ? '…' : formatKeystroke(value, platform)}</button>
