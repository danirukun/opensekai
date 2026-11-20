<script lang="ts">
 let {message}:{message:string}=$props();
</script>
<p class="empty-state">{message}</p>
<style>
 .empty-state{margin:0;flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px;text-align:center;font-size:12px;line-height:1.4;color:var(--ds-color-text-muted)}
</style>
