<script lang="ts">
 import {Button} from '@oshi-connect/ui';
 import {RotateCcw} from '@lucide/svelte';
 // A field that differs from its default shows this mark next to its label; one click restores the default (B17 R5).
 let {label,disabled=false,onreset}:{label:string;disabled?:boolean;onreset:()=>void}=$props();
</script>
<Button type="button" variant="ghost" class="reset-mark" title="Reset {label}" {disabled} onclick={onreset}><RotateCcw size={14}/></Button>
