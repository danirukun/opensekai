<script lang="ts">
 // Legacy props, as in BlueprintNodeView: Rete passes the same socket object on update.
 export let data: { name: string };
 $: kind = data.name.toLowerCase();
</script>

<div class="bp-socket" data-kind={kind} title={data.name}></div>
