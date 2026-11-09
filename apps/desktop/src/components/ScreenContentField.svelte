<script lang="ts">
 import {Select} from '@oshi-connect/ui';
 import ResetMark from './ResetMark.svelte';
 import {NO_MARKS,type ResetMarks} from '../editor/property-defaults';
 import type {ScreenContentKind} from '../editor/screen';
 let {marks=NO_MARKS,content,options,disabled=false,onchange}:{marks?:ResetMarks;content:ScreenContentKind;options:{value:ScreenContentKind;label:string;disabled:boolean}[];disabled?:boolean;onchange:(content:ScreenContentKind)=>void}=$props();
 let reset=$state(0);
 function change(value:string){reset++;const option=options.find(item=>item.value===value);if(option&&value!==content&&!option.disabled)onchange(option.value);}
 // The kit Select has no disabled option; Video and Web page are disabled in place at their screen limit (B29 R19, B30 R13).
 const limit=(options:readonly {value:string;disabled:boolean}[])=>(node:HTMLElement)=>{for(const option of node.querySelectorAll('option'))option.disabled=options.find(item=>item.value===option.value)?.disabled??false;};
</script>
{#key `${content}:${reset}`}<div class="resettable" {@attach limit(options)}><Select label="Content" value={content} {options} {disabled} onchange={event=>change(event.currentTarget.value)}/>{#if marks.changed.has('content')}<ResetMark label="Content" disabled={marks.disabled||disabled} onreset={()=>onchange('image')}/>{/if}</div>{/key}
