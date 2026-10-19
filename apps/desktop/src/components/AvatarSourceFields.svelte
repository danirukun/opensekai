<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import type {SceneEntity,AvatarTracking,AvatarIdle} from '@opensekai/contracts';
 import {sourceOptions,withSource,type Commit,type SourceChannel,type SourceOption} from '../editor/live-fields';
 let {entityId,tracking,idleAnimation,onidle,entities,revision,disabled=false,oncommit}:{entityId:string;tracking?:AvatarTracking;idleAnimation?:AvatarIdle;onidle?:Commit<AvatarIdle>;entities:SceneEntity[];revision:number;disabled?:boolean;oncommit?:Commit<AvatarTracking>}=$props();
 const body=$derived(sourceOptions(entities,'body',entityId)),face=$derived(sourceOptions(entities,'face',entityId)),fingers=$derived(sourceOptions(entities,'fingers',entityId));
 function change(channel:SourceChannel,value:string){void oncommit?.(entityId,withSource(tracking,channel,value),revision);}
 // The kit Select has no disabled option, so this marks the rendered options after each options change.
 const disableOptions=(options:SourceOption[])=>(node:HTMLElement)=>{for(const option of node.querySelectorAll('option'))option.disabled=options.find(item=>item.value===option.value)?.disabled??false;};
</script>
<div class="sources"><label class="idle-option"><input type="checkbox" checked={idleAnimation?.enabled??false} disabled={disabled||!onidle} onchange={event=>{void onidle?.(entityId,{kind:'builtin',enabled:event.currentTarget.checked},revision);}}/>Idle animation</label><div {@attach disableOptions(body)}><Select label="Body source" value={tracking?.bodySourceId??''} options={body} disabled={disabled||!oncommit} onchange={event=>change('body',event.currentTarget.value)}/></div><div {@attach disableOptions(face)}><Select label="Face source" value={tracking?.faceSourceId??''} options={face} disabled={disabled||!oncommit} onchange={event=>change('face',event.currentTarget.value)}/></div><div {@attach disableOptions(fingers)}><Select label="Fingers source" value={tracking?.fingersSourceId??''} options={fingers} disabled={disabled||!oncommit} onchange={event=>change('fingers',event.currentTarget.value)}/></div></div>
<style>.idle-option{display:flex;align-items:center;gap:7px;font-size:12px}.sources{display:grid;gap:10px;padding:12px 0;border-bottom:1px solid #e1dee6}</style>
