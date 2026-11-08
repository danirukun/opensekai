<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import {CONTENT_OPTIONS} from '../editor/screen';
 type Content='image'|'video';
 let {marks=NO_MARKS,content,videoDisabled=false,disabled=false,onchange}:{marks?:ResetMarks;content:Content;videoDisabled?:boolean;disabled?:boolean;onchange:(content:Content)=>void}=$props();
 let reset=$state(0);
 function change(value:string){reset++;if((value==='image'||value==='video')&&value!==content&&!(value==='video'&&videoDisabled))onchange(value);}
 // The kit Select has no disabled option; the Video option is disabled in place at the video screen limit (B29 R19).
 const limitVideo=(videoDisabled:boolean)=>(node:HTMLElement)=>{const option=node.querySelector<HTMLOptionElement>('option[value="video"]');if(option)option.disabled=videoDisabled;};
</script>
{#key `${content}:${reset}`}<div class="resettable" {@attach limitVideo(videoDisabled)}><Select label="Content" value={content} options={CONTENT_OPTIONS} {disabled} onchange={event=>change(event.currentTarget.value)}/>{#if marks.changed.has('content')}<ResetMark label="Content" disabled={marks.disabled||disabled} onreset={()=>onchange('image')}/>{/if}</div>{/key}
