<script lang="ts">
 import {meshList,type AssetMesh,type Reply} from '@opensekai/contracts';
 import {settleCheckbox} from '../editor/live-fields';
 // One checkbox for each mesh of the model, checked when the mesh shows (B26 R12). A click sends one setHiddenMeshes patch.
 let {meshes,hidden=[],disabled=false,oncommit}:{meshes:readonly AssetMesh[];hidden?:readonly string[];disabled?:boolean;oncommit:(hidden:string[])=>Promise<Reply<unknown>|undefined>}=$props();
 const rows=$derived(meshList(meshes,hidden).meshes);
 const change=async(box:HTMLInputElement,name:string)=>{
  // The list keeps unknown names (R6); a shown mesh leaves the list and a hidden one goes to its end.
  const next=box.checked?hidden.filter(item=>item!==name):[...hidden.filter(item=>item!==name),name];
  settleCheckbox(box,await oncommit(next),!hidden.includes(name));
 };
</script>
<div class="mesh-list">{#each rows as row (row.name)}<label class="visibility-control"><input type="checkbox" checked={!row.hidden} {disabled} onchange={event=>change(event.currentTarget,row.name)}/>{row.name}</label>{/each}</div>
