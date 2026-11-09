import { LIMITS, isImageRecord, isWebScreenUrl, type AssetRecord, type SceneEntity, type WebScreen } from '@opensekai/contracts';
import { IMPORT_SCENE } from './environment';
// The Screen Image select (B28 R19): only image records, a missing image, and the import row.
export function imageSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const images = assets.filter(isImageRecord).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !images.some(image => image.value === assetId) ? [{ value: assetId, label: 'Missing image' }] : [];
    return [{ value: '', label: 'Choose image…' }, ...images, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
// The Screen Content select and the Web page fields (B30 R13).
export type ScreenContentKind = 'image' | 'web';
export const DEFAULT_WEB_SCREEN: WebScreen = { url: null, width: 1280, height: 720, onTop: false };
export const webLimitReached = (entities: readonly SceneEntity[]) => entities.filter(entity => entity.kind === 'screen' && entity.content.kind === 'web').length >= LIMITS.webScreens;
// Web page is disabled at the web screen limit, unless this screen already shows a page.
export function contentOptions(kind: ScreenContentKind, entities: readonly SceneEntity[]) {
    return [{ value: 'image', label: 'Image', disabled: false }, { value: 'web', label: 'Web page', disabled: kind !== 'web' && webLimitReached(entities) }];
}
// An empty field commits no URL. Text that fails the URL rule does not commit. Space around the text is not part of the URL.
export function parseWebUrl(text: string): { ok: true; url: string | null } | { ok: false } {
    const value = text.trim();
    if (value === '') return { ok: true, url: null };
    return isWebScreenUrl(value) ? { ok: true, url: value } : { ok: false };
}
const SIZE = { width: [64, 3840], height: [64, 2160] } as const;
// A size outside the range clamps; text that is not a number keeps the stored value.
// A number input bound with bind:value gives a number, or null when it is empty.
export function clampWebSize(axis: 'width' | 'height', input: string | number | null, current: number): number {
    const text = input === null ? '' : String(input), value = Number(text);
    if (text.trim() === '' || !Number.isFinite(value)) return current;
    const [min, max] = SIZE[axis];
    return Math.min(max, Math.max(min, Math.round(value)));
}
