<script lang="ts">
 import {invoke} from '@tauri-apps/api/core';
 import {Button,toasts} from '@oshi-connect/ui';
 import {CircleQuestionMark} from '@lucide/svelte';
 import type {HelpTopic} from '../editor/help';
 let {topic}:{topic:HelpTopic}=$props();
 // The window sends only the topic; the host builds the handbook URL (B40a R5).
 function open(){invoke<void>('open_help',{topic}).catch(()=>{toasts.push({variant:'error',message:'Could not open help'});});}
</script>
<Button variant="ghost" size="sm" class="help-button" title="Help" onclick={open}><CircleQuestionMark size={16}/><span class="sr-only">Help</span></Button>
<style>
 :global(.help-button){flex:none;margin:-5px -5px -5px 0;padding:5px!important;border:0!important;background:transparent!important;box-shadow:none!important;color:var(--ds-color-rail-icon)!important}
 :global(.help-button:hover),:global(.help-button:focus-visible){background:var(--ds-color-hover)!important}
</style>
