<script lang="ts">
 import { KEYSTROKE_CODES, keystrokeHasModifier, type KeystrokeSettings } from '@opensekai/contracts';
 import { formatKeystroke } from '../blueprints/keystroke-format';

 let { value, platform, unavailable = false, onchange }: {
  value: KeystrokeSettings; platform: string; unavailable?: boolean; onchange: (next: KeystrokeSettings) => void;
 } = $props();
 let armed = $state(false), rejected = $state(false), timer: ReturnType<typeof setTimeout> | undefined;
 function capture(event: KeyboardEvent) {
  if (!armed) return;
  event.preventDefault();
  if (event.code === 'Escape') { armed = false; return; }
  if (!KEYSTROKE_CODES.includes(event.code)) return;
  const next: KeystrokeSettings = { code: event.code, control: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
  if (!keystrokeHasModifier(next)) {
   rejected = true; clearTimeout(timer);
   timer = setTimeout(() => { rejected = false; }, 1000);
   return;
  }
  armed = false;
  onchange(next);
 }
</script>

<svelte:window onkeydowncapture={capture} />
<!-- svelte-ignore a11y_role_supports_aria_props_implicit -->
<button type="button" class="keystroke-field" class:armed aria-label="Keystroke" aria-invalid={unavailable || rejected} onclick={() => { armed = true; }} onblur={() => { armed = false; }}>{armed ? '…' : formatKeystroke(value, platform)}</button>
