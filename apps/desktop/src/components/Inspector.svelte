<script lang="ts">
 import type { Transform, Reply } from '@opensekai/contracts';
 import type { EditorPanelProps } from '../editor/model';
 import type {LivePropertyCallbacks} from '../editor/live-fields';
 import CameraLensFields from './CameraLensFields.svelte';
 import AvatarSourceFields from './AvatarSourceFields.svelte';
 import TrackingSourceFields from './TrackingSourceFields.svelte';
 import TransformFields from './TransformFields.svelte';
 type Props=LivePropertyCallbacks&Omit<EditorPanelProps,'model'>&{model:EditorPanelProps['model']&{setTransform?:(id:string,transform:Transform,revision?:number)=>Promise<Reply<{revision:number}>>};draft?:{entityId:string;transform:Transform}|null;ondraft?:(draft:{entityId:string;transform:Transform}|null)=>void;disabled?:boolean;onlivetransform?:(id:string,transform:Transform)=>void;oncanceltransform?:()=>void;onfinishtransform?:()=>void;transformError?:string|null;livePending?:boolean};
 let {model,view,draft=null,ondraft,disabled=false,onlivetransform,oncanceltransform,onfinishtransform,transformError=null,livePending=false,onlens,onavatartracking,ontrackingconfig,ontrackingtoggle,trackingStatus=[],devices=[]}:Props=$props();
 const entity=$derived(view.scene?.entities.find(item=>item.id===view.selectedId));
</script>
<section class="editor-panel inspector" aria-labelledby="inspector-heading">
 <h2 id="inspector-heading">Properties</h2>
 {#if entity && view.scene}<h3>{entity.name}</h3>{#if entity.kind!=='tracking'}<label class="visibility-control"><input type="checkbox" checked={entity.visible} disabled={view.pending||disabled} onchange={event=>{void model.setVisibility(entity.id,event.currentTarget.checked,view.scene?.revision);}}/>Visible</label>
 <TransformFields entityId={entity.id} baseTransform={entity.transform} transform={draft?.entityId===entity.id?draft.transform:entity.transform} revision={view.scene.revision} disabled={disabled||(view.pending&&!view.transformPending)} committing={livePending||(view.transformPending??false)} cancelKey={transformError??view.error} oncommit={(transform,revision)=>{if(onlivetransform)onlivetransform(entity.id,transform);else void model.setTransform?.(entity.id,transform,revision);}} oncancel={oncanceltransform} onfinish={onfinishtransform}/>
 {/if}
 {#if entity.kind==='camera'}<CameraLensFields entityId={entity.id} lens={entity.lens} revision={view.scene.revision} disabled={view.pending||disabled} oncommit={onlens}/>{:else if entity.kind==='avatar'}<AvatarSourceFields entityId={entity.id} tracking={entity.tracking} entities={view.scene.entities} revision={view.scene.revision} disabled={view.pending||disabled} oncommit={onavatartracking}/>{:else if entity.kind==='tracking'}<TrackingSourceFields entityId={entity.id} config={entity.config} generation={entity.generation} revision={view.scene.revision} disabled={view.pending||disabled} oncommit={ontrackingconfig} ontoggle={ontrackingtoggle} statuses={trackingStatus} {devices}/>{/if}
 {/if}
 {#if view.error}<p role="alert">{view.error==='CONFLICT'?'Scene changed. Review values and retry.':view.error}</p>{/if}
</section>
