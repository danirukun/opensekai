<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import type {SceneEntity,AvatarTracking,AvatarIdle} from '@opensekai/contracts';
 import {sourceOptions,type Commit} from '../editor/live-fields';
 let {entityId,tracking,idleAnimation,onidle,entities,revision,disabled=false,oncommit}:{entityId:string;tracking?:AvatarTracking;idleAnimation?:AvatarIdle;onidle?:Commit<AvatarIdle>;entities:SceneEntity[];revision:number;disabled?:boolean;oncommit?:Commit<AvatarTracking>}=$props();
 function change(channel:'bodySourceId'|'faceSourceId',value:string){void oncommit?.(entityId,{bodySourceId:tracking?.bodySourceId??null,faceSourceId:tracking?.faceSourceId??null,[channel]:value||null},revision);}
</script>
<div class="sources"><label class="idle-option"><input type="checkbox" checked={idleAnimation?.enabled??false} disabled={disabled||!onidle} onchange={event=>{void onidle?.(entityId,{kind:'builtin',enabled:event.currentTarget.checked},revision);}}/>Idle animation</label><Select label="Body source" value={tracking?.bodySourceId??''} options={sourceOptions(entities,'body')} disabled={disabled||!oncommit} onchange={event=>change('bodySourceId',event.currentTarget.value)}/><Select label="Face source" value={tracking?.faceSourceId??''} options={sourceOptions(entities,'face')} disabled={disabled||!oncommit} onchange={event=>change('faceSourceId',event.currentTarget.value)}/></div>
<style>.idle-option{display:flex;align-items:center;gap:7px;font-size:12px}.sources{display:grid;gap:10px;padding:12px 0;border-bottom:1px solid #e1dee6}</style>
