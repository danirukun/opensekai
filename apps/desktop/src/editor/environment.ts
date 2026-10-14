import type { AssetCredits, AssetRecord } from '@opensekai/contracts';
export const IMPORT_SCENE = '__import__';
export function creditLine({ title, author, license, sourceUrl }: AssetCredits): string | null {
    if (!title && !author && !license && !sourceUrl) return null;
    return ['This work is based on', title ? `"${title}"` : null, sourceUrl ? `(${sourceUrl})` : null, author ? `by ${author}` : null, license ? `licensed under ${license}` : null].filter(Boolean).join(' ');
}
export function sceneSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const scenes = assets.filter(asset => asset.id.startsWith('scene_')).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !scenes.some(scene => scene.value === assetId) ? [{ value: assetId, label: 'Missing model' }] : [];
    return [{ value: '', label: 'Choose model…' }, ...scenes, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
export function sourceAction(value: string): { kind: 'import' } | { kind: 'select'; assetId: string | null } {
    return value === IMPORT_SCENE ? { kind: 'import' } : { kind: 'select', assetId: value || null };
}
