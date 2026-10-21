<script lang="ts">
 let {value,peak,label}:{value:number;peak?:number;label:string}=$props();
 const pct=(v:number)=>`${Math.round(Math.min(1,Math.max(0,v))*1000)/10}%`;
</script>
<div class="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={1} aria-valuenow={Math.round(value*100)/100}>
 <i style:width={pct(value)}></i>
 {#if peak!==undefined&&peak>0}<b style:left={pct(peak)}></b>{/if}
</div>
<style>
 .meter{position:relative;height:8px;border-radius:4px;background:#eeecf2}
 i{position:absolute;inset:0 auto 0 0;border-radius:4px;background:#8571ac;transition:width 90ms linear}
 b{position:absolute;top:-3px;bottom:-3px;width:2px;margin-left:-1px;background:#3b3546}
 @media (prefers-reduced-motion:reduce){i{transition:none}}
</style>
