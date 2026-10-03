<script lang="ts">
 import { Button, Input } from '@oshi-connect/ui';
 import type { Vec3 } from '@opensekai/contracts';
 import type { EditorPanelProps } from '../editor/model';
 import { parseFiniteNumber } from '../editor/numeric';
 let { model, view }: EditorPanelProps = $props();
 const entity = $derived(view.scene?.entities.find(item => item.id === view.selectedId));
 let values = $state(['', '', '']);
 let invalid = $state(false);
 $effect(() => { values = entity?.transform.position.map(String) ?? ['', '', '']; invalid = false; });
 async function apply(event: SubmitEvent) {
  event.preventDefault(); const parsed = values.map(parseFiniteNumber);
  if (parsed.some(reply => !reply.ok)) { invalid = true; return; }
  if (!entity) return;
  invalid = false; await model.setPosition(entity.id, parsed.map(reply => reply.ok ? reply.data : 0) as Vec3);
 }
</script>
<section class="editor-panel inspector" aria-labelledby="inspector-heading">
 <h2 id="inspector-heading">Inspector</h2>
 {#if entity}
  <h3>{entity.name}</h3>
  <label class="visibility-control"><input type="checkbox" checked={entity.visible} disabled={view.pending} onchange={event => { void model.setVisibility(entity.id, event.currentTarget.checked); }} />Visible</label>
  <form onsubmit={apply}>
   <fieldset disabled={view.pending}><legend>Position</legend>
    <div class="position-fields">{#each ['X', 'Y', 'Z'] as axis, index}<Input label={axis} bind:value={values[index]} state={invalid && !parseFiniteNumber(values[index]).ok ? 'error' : 'default'} inputClass="numeric-input" />{/each}</div>
    <Button type="submit" variant="secondary">Apply</Button>
   </fieldset>
  </form>
  {#if invalid}<p role="alert">Enter finite numbers.</p>{/if}
 {/if}
 {#if view.error}<p role="alert">{view.error === 'CONFLICT' ? 'Scene changed. Review values and retry.' : view.error}</p>{/if}
 <label class="panel-resize">Width<input type="range" min="220" max="420" value="260" aria-label="Inspector panel width" oninput={event => { (event.currentTarget.closest('.editor-grid') as HTMLElement | null)?.style.setProperty('--inspector-width', `${event.currentTarget.value}px`); }} /></label>
</section>
