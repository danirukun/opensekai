<script lang="ts">
 import { Button } from '@oshi-connect/ui';
 import type { EditorPanelProps } from '../editor/model';
 let { model, view }: EditorPanelProps = $props();
 function navigate(event: KeyboardEvent) {
  const entities = view.scene?.entities ?? [];
  const index = entities.findIndex(entity => entity.id === view.selectedId);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? entities.length - 1 : event.key === 'ArrowDown' ? Math.min(index + 1, entities.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : -1;
  if (next < 0 || !entities[next]) return;
  event.preventDefault(); model.select(entities[next].id);
  const button = event.currentTarget as HTMLElement;
  button.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
 }
</script>
<section class="editor-panel hierarchy" aria-labelledby="hierarchy-heading">
 <h2 id="hierarchy-heading">Scene</h2>
 <div class="entity-list" role="toolbar" aria-label="Scene entities" tabindex="0" onkeydown={navigate}>
  {#each view.scene?.entities ?? [] as entity (entity.id)}
   <Button class={view.selectedId === entity.id ? 'entity-row selected' : 'entity-row'} variant="ghost" onclick={() => model.select(entity.id)} title={view.selectedId === entity.id ? `${entity.name}, selected` : entity.name}>
    <span class="entity-kind" aria-hidden="true">{entity.kind === 'camera' ? '▣' : entity.kind === 'avatar' ? '♙' : '◇'}</span><span>{entity.name}</span>
   </Button>
  {/each}
 </div>
 <label class="panel-resize">Width<input type="range" min="160" max="360" value="208" aria-label="Scene panel width" oninput={event => { (event.currentTarget.closest('.editor-grid') as HTMLElement | null)?.style.setProperty('--hierarchy-width', `${event.currentTarget.value}px`); }} /></label>
</section>
