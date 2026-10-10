<script lang="ts">
 import type { AppError, AssetRecord } from '@opensekai/contracts';
 export interface AssetListProps { assets: AssetRecord[]; warnings: AppError[] }
 let { assets, warnings }: AssetListProps = $props();
</script>
<section class="editor-panel assets" aria-labelledby="assets-heading">
 <h2 id="assets-heading">Assets</h2>
 <div class="asset-rows">{#each assets as asset (asset.id)}<div class="asset-row"><span>{asset.name}</span><span>{asset.format.toUpperCase()}</span><span>{asset.licenseLabel}</span></div>{/each}</div>
 {#each warnings as warning}<p role="status">{warning.message}{warning.ids.length ? ` (${warning.ids.join(', ')})` : ''}</p>{/each}
</section>
