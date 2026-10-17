<script lang="ts">
 import { Button, Input, Select } from '@oshi-connect/ui';
 import { ChevronRight } from '@lucide/svelte';
 import type { ExpressionSettings, ExpressionState, ExpressionView, Reply } from '@opensekai/contracts';
 import { editSettings, LAYER_OPTIONS } from '../editor/expressions';
 export interface ExpressionApi {
  get(avatarId: string): Promise<Reply<ExpressionState>>;
  set(avatarId: string, name: string, active: boolean): Promise<Reply<ExpressionState>>;
 }
 let { avatarId, revision, api, disabled = false, onsettings }: {
  avatarId: string; revision: number; api: ExpressionApi; disabled?: boolean;
  onsettings: (avatarId: string, name: string, settings: ExpressionSettings | null, revision: number) => Promise<unknown>;
 } = $props();
 let list = $state.raw<ExpressionView[]>([]), error = $state<string | null>(null), busy = $state(false), open = $state<string | null>(null);
 let request = 0, shown: string | null = null;
 async function read(id: string) {
  const ticket = ++request;
  try {
   const reply = await api.get(id);
   if (ticket !== request || id !== avatarId) return;
   if (reply.ok) { list = reply.data.expressions; error = null; } else error = reply.error.message;
  } catch { if (ticket === request) error = 'UNAVAILABLE'; }
 }
 // Read on selection change, after a settings commit, and at the editor poll interval while the group is visible.
 $effect(() => {
  const id = avatarId;
  void revision;
  if (shown !== id) { list = []; open = null; shown = id; }
  void read(id);
  const timer = setInterval(() => { if (!busy) void read(id); }, 500);
  return () => { clearInterval(timer); request += 1; };
 });
 async function toggle(view: ExpressionView, box: HTMLInputElement) {
  busy = true; const ticket = ++request;
  try {
   const reply = await api.set(avatarId, view.name, box.checked);
   if (reply.ok) { if (ticket === request) list = reply.data.expressions; error = null; }
   else { box.checked = view.active; error = reply.error.message; }
  } catch { box.checked = view.active; error = 'UNAVAILABLE'; }
  finally { busy = false; }
 }
 function commit(view: ExpressionView, edit: Parameters<typeof editSettings>[1], restore?: () => void) {
  const settings = editSettings(view, edit);
  if (!settings) { restore?.(); return; }
  void onsettings(avatarId, view.name, settings, revision);
 }
</script>
{#if list.length}
<section class="expressions" aria-labelledby="expressions-{avatarId}">
 <h4 id="expressions-{avatarId}">Expressions</h4>
 {#each list as view (view.name)}
  <div class="row">
   <label class="toggle"><input type="checkbox" role="switch" checked={view.active} {disabled} onchange={event => toggle(view, event.currentTarget)} /><span class="name">{view.name}</span></label>
   <button type="button" class="disclose" aria-expanded={open === view.name} aria-label="{view.name} settings" onclick={() => { open = open === view.name ? null : view.name; }}><ChevronRight size={14} /></button>
  </div>
  {#if open === view.name}
   <fieldset {disabled}>
    <Select label="Layer" value={String(view.layer)} options={LAYER_OPTIONS} onchange={event => commit(view, { layer: event.currentTarget.value })} />
    <Input type="number" label="Fade (s)" min={0} max={5} step="0.1" value={String(view.fadeSeconds)} onchange={event => { const input = event.currentTarget; commit(view, { fadeSeconds: input.value }, () => { input.value = String(view.fadeSeconds); }); }} />
    <div class="suppress" role="group" aria-label="Suppress tracking"><span>Suppress tracking</span>
     {#each [['blink', 'Blink'], ['mouth', 'Mouth'], ['brow', 'Brow']] as const as [key, label] (key)}
      <label><input type="checkbox" checked={view.suppress[key]} onchange={event => commit(view, { suppress: { [key]: event.currentTarget.checked } })} />{label}</label>
     {/each}
    </div>
    <Button type="button" variant="ghost" onclick={() => void onsettings(avatarId, view.name, null, revision)}>Reset</Button>
   </fieldset>
  {/if}
 {/each}
 {#if error}<p role="alert">{error}</p>{/if}
</section>
{/if}
<style>
 .expressions{padding:12px 0;border-bottom:1px solid #e1dee6}
 h4{font-size:12px;font-weight:600;margin:0 0 6px}
 .row{display:flex;align-items:center;gap:8px;min-height:26px}
 .toggle{display:flex;flex:1 1 auto;align-items:center;gap:6px;min-width:0;font-size:12px;color:#423c4b}
 .toggle input{flex:none;accent-color:#8571ac}
 .name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .disclose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;color:#78717f;cursor:pointer}
 .disclose :global(svg){transition:transform .15s}
 .disclose[aria-expanded='true'] :global(svg){transform:rotate(90deg)}
 fieldset{border:0;margin:4px 0 8px;padding:0 0 0 22px;display:flex;flex-direction:column;gap:6px;min-width:0}
 .suppress{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px}
 .suppress span{width:100%}
 .suppress label{display:flex;align-items:center;gap:4px}
 @media (prefers-reduced-motion:reduce){.disclose :global(svg){transition:none}}
</style>
