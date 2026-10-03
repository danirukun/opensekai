<script lang="ts">
 import type { Transform, Reply } from '@opensekai/contracts';
 import type { EditorPanelProps } from '../editor/model';
 import TransformFields from './TransformFields.svelte';
 type Props=Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};draft?:{entityId:string;transform:Transform}|null;ondraft?:(draft:{entityId:string;transform:Transform}|null)=>void;disabled?:boolean};
 let {model,view,draft=null,ondraft,disabled=false}:Props=$props();
 const entity=$derived(view.scene?.entities.find(item=>item.id===view.selectedId));
</script>
<section class="editor-panel inspector" aria-labelledby="inspector-heading">
 <h2 id="inspector-heading">Properties</h2>
 {#if entity && view.scene}<h3>{entity.name}</h3><label class="visibility-control"><input type="checkbox" checked={entity.visible} disabled={view.pending||disabled} onchange={event=>{void model.setVisibility(entity.id,event.currentTarget.checked);}}/>Visible</label>
 <TransformFields entityId={entity.id} transform={draft?.entityId===entity.id?draft.transform:entity.transform} revision={view.scene.revision} disabled={view.pending||disabled} oncommit={(transform,revision)=>{void model.setTransform?.(entity.id,transform,revision);}} ondraft={transform=>ondraft?.(transform?{entityId:entity.id,transform}:null)}/>
 {/if}
 {#if view.error}<p role="alert">{view.error==='CONFLICT'?'Scene changed. Review values and retry.':view.error}</p>{/if}
</section>
