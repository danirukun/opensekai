import { LIMITS, isCaptureScreen, isImageRecord, isVideoRecord, isVideoScreen, isWebScreenUrl, type AssetRecord, type Id, type RuntimeFrame, type SceneEntity, type ScreenVideo, type VideoAudioCodec, type VideoCodec, type WebScreen } from '@opensekai/contracts';
import { IMPORT_SCENE } from './environment';
import type { SliderRange } from './slider';
// The Screen Image select (B28 R19): only image records, a missing image, and the import row.
export function imageSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const images = assets.filter(isImageRecord).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !images.some(image => image.value === assetId) ? [{ value: assetId, label: 'Missing image' }] : [];
    return [{ value: '', label: 'Choose image…' }, ...images, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
// The Screen Video select (B29 R19): only video records, a missing video, and the import row.
export function videoSourceOptions(assetId: string | null, assets: readonly AssetRecord[]) {
    const videos = assets.filter(isVideoRecord).map(asset => ({ value: asset.id, label: asset.name }));
    const missing = assetId !== null && !videos.some(video => video.value === assetId) ? [{ value: assetId, label: 'Missing video' }] : [];
    return [{ value: '', label: 'Choose video…' }, ...videos, ...missing, { value: IMPORT_SCENE, label: 'Import file…' }];
}
// A screen that gets video content starts with these values (B29 R19). The reset defaults use them too.
export const VIDEO_DEFAULTS: Readonly<ScreenVideo> = Object.freeze({ assetId: null, autoPlay: false, loop: true, volume: 1 });
export const VOLUME_RANGE: SliderRange = { min: 0, max: 1, step: 0.01, curve: 'linear' };
export const CONTENT_OPTIONS: readonly { value: ScreenContentKind; label: string }[] = [{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }, { value: 'web', label: 'Web page' }, { value: 'display', label: 'Display' }, { value: 'window', label: 'Window' }];
export const videoScreenLimitReached = (entities: readonly SceneEntity[]): boolean => entities.filter(isVideoScreen).length >= LIMITS.videoScreens;
// Content Video is disabled at the video screen limit, unless this screen already has video content (B29 R19).
export const videoContentDisabled = (entity: SceneEntity, entities: readonly SceneEntity[]): boolean => !isVideoScreen(entity) && videoScreenLimitReached(entities);
// The video values of a screen, or the start values when it has other content.
export const screenVideo = (entity: SceneEntity): ScreenVideo => entity.kind === 'screen' && entity.content.kind === 'video'
    ? { assetId: entity.content.assetId, autoPlay: entity.content.autoPlay, loop: entity.content.loop, volume: entity.content.volume }
    : { ...VIDEO_DEFAULTS };
// The playing value of each screen in the latest frame. A screen without an entry is not in the map (the button shows Play).
export type PlaybackState = ReadonlyMap<Id, boolean>;
export const playbackState = (frame: Pick<RuntimeFrame, 'screenPlayback'>): PlaybackState => new Map((frame.screenPlayback ?? []).map(entry => [entry.entityId, entry.playing]));
export const samePlayback = (a: PlaybackState, b: PlaybackState): boolean => a.size === b.size && [...a].every(([id, playing]) => b.get(id) === playing);
export const playLabel = (state: PlaybackState, entityId: Id): 'Play' | 'Pause' => state.get(entityId) === true ? 'Pause' : 'Play';
const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = { h264: 'H.264', hevc: 'HEVC', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };
const AUDIO_CODEC_LABELS: Record<VideoAudioCodec, string> = { aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis' };
// The format column of the Assets list: a video record adds its video codec and its audio codec, when it has one (B29 R19).
export function assetFormatLabel(asset: AssetRecord): string {
    const format = asset.format.toUpperCase();
    if (!asset.video) return format;
    return [format, VIDEO_CODEC_LABELS[asset.video.videoCodec], asset.video.audioCodec ? AUDIO_CODEC_LABELS[asset.video.audioCodec] : null].filter(Boolean).join(' · ');
}
// Duplicate copies the content, so a video or web screen cannot be copied at its screen limit (B29 R19, B30 R13).
export const duplicateLimitReached = (entity: SceneEntity, entities: readonly SceneEntity[]): boolean => (isVideoScreen(entity) && videoScreenLimitReached(entities)) || (entity.kind === 'screen' && entity.content.kind === 'web' && webLimitReached(entities)) || (isCaptureScreen(entity) && captureLimitReached(entities));
// The Screen Content select and the Web page fields (B29 R19, B30 R13).
// B31 R17: capture content shows as Display or Window, from its target.
export type ScreenContentKind = 'image' | 'video' | 'web' | 'display' | 'window';
export const contentKind = (content: Extract<SceneEntity, { kind: 'screen' }>['content']): ScreenContentKind => content.kind === 'capture' ? content.target : content.kind;
export const captureLimitReached = (entities: readonly SceneEntity[]) => entities.filter(isCaptureScreen).length >= LIMITS.captureScreens;
export const DEFAULT_WEB_SCREEN: WebScreen = { url: null, width: 1280, height: 720, onTop: false };
export const webLimitReached = (entities: readonly SceneEntity[]) => entities.filter(entity => entity.kind === 'screen' && entity.content.kind === 'web').length >= LIMITS.webScreens;
// Video and Web page are disabled at their screen limit, unless this screen already has that content.
// Display and Window share the capture limit, so a capture screen can change between them (B31 R17).
export function contentOptions(kind: ScreenContentKind, entities: readonly SceneEntity[]) {
    const capture = kind !== 'display' && kind !== 'window' && captureLimitReached(entities);
    const full = { image: false, video: videoScreenLimitReached(entities), web: webLimitReached(entities), display: capture, window: capture };
    return CONTENT_OPTIONS.map(option => ({ ...option, disabled: option.value !== kind && full[option.value] }));
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
