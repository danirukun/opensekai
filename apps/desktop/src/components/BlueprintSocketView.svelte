<script lang="ts">
 // Legacy props, as in BlueprintNodeView: Rete passes the same socket object on update.
 export let data: { name: string; kind?: string };
 // A list socket has the color of its item type and a square shape.
 $: type = data.kind ?? data.name.toLowerCase();
 $: list = type.endsWith('[]');
</script>

<div class="bp-socket" data-kind={list ? type.slice(0, -2) : type} data-list={list || undefined} title={data.name}></div>
