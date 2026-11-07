import { isImageRecord, type AssetRecord } from '@opensekai/contracts';
import { IMPORT_SCENE } from './environment';
// The Screen Image select (B28 R19): only image records, a missing image, and the import row.
export function imageSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const images = assets.filter(isImageRecord).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !images.some(image => image.value === assetId) ? [{ value: assetId, label: 'Missing image' }] : [];
    return [{ value: '', label: 'Choose image…' }, ...images, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
