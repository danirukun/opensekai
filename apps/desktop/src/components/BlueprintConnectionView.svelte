<script lang="ts">
 // Legacy props, as in BlueprintNodeView. Rete also passes data, start, and end, which this view does not need.
 export let path: string;
</script>

<!-- The wide transparent path is the pointer target; the thin path is what the operator sees. -->
<svg class="bp-wire" data-testid="connection"><path class="bp-wire-hit" d={path} /><path class="bp-wire-line" d={path} /></svg>
