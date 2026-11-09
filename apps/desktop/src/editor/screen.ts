import { LIMITS, isImageRecord, isVideoRecord, isVideoScreen, type AssetRecord, type Id, type RuntimeFrame, type SceneEntity, type ScreenVideo, type ScreenVideoAction, type VideoAudioCodec, type VideoCodec } from '@opensekai/contracts';
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
export const CONTENT_OPTIONS = [{ value: 'image', label: 'Image' }, { value: 'video', label: 'Video' }];
export const videoScreenLimitReached = (entities: readonly SceneEntity[]): boolean => entities.filter(isVideoScreen).length >= LIMITS.videoScreens;
// Content Video is disabled at the video screen limit, unless this screen already has video content (B29 R19).
export const videoContentDisabled = (entity: SceneEntity, entities: readonly SceneEntity[]): boolean => !isVideoScreen(entity) && videoScreenLimitReached(entities);
// The video values of a screen, or the start values when it has other content.
export const screenVideo = (entity: SceneEntity): ScreenVideo => entity.kind === 'screen' && entity.content.kind === 'video'
    ? { assetId: entity.content.assetId, autoPlay: entity.content.autoPlay, loop: entity.content.loop, volume: entity.content.volume }
    : { ...VIDEO_DEFAULTS };
// The play state of each screen in the latest frame. A screen without an entry is not in the map (the button shows Play).
// A playing entry past the end of a video without Loop is ended: the video holds its last frame, so the button shows Play and restarts it.
export type PlayState = 'playing' | 'paused' | 'ended';
export type PlaybackState = ReadonlyMap<Id, PlayState>;
export const playbackState = (frame: Pick<RuntimeFrame, 'screenPlayback'> & { scene?: Pick<RuntimeFrame['scene'], 'entities'> }, assets: readonly AssetRecord[] = []): PlaybackState => new Map((frame.screenPlayback ?? []).map(entry => {
    const entity = frame.scene?.entities.find(candidate => candidate.id === entry.entityId);
    const content = entity?.kind === 'screen' && entity.content.kind === 'video' ? entity.content : null;
    const durationMs = assets.find(asset => asset.id === content?.assetId)?.video?.durationMs;
    const ended = entry.playing && content !== null && !content.loop && durationMs !== undefined && entry.positionMs >= durationMs - 17;
    return [entry.entityId, ended ? 'ended' : entry.playing ? 'playing' : 'paused'];
}));
export const samePlayback = (a: PlaybackState, b: PlaybackState): boolean => a.size === b.size && [...a].every(([id, state]) => b.get(id) === state);
export const playLabel = (state: PlaybackState, entityId: Id): 'Play' | 'Pause' => state.get(entityId) === 'playing' ? 'Pause' : 'Play';
export const playAction = (state: PlaybackState, entityId: Id): ScreenVideoAction => state.get(entityId) === 'playing' ? 'pause' : state.get(entityId) === 'ended' ? 'restart' : 'play';
const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = { h264: 'H.264', hevc: 'HEVC', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };
const AUDIO_CODEC_LABELS: Record<VideoAudioCodec, string> = { aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis' };
// The format column of the Assets list: a video record adds its video codec and its audio codec, when it has one (B29 R19).
export function assetFormatLabel(asset: AssetRecord): string {
    const format = asset.format.toUpperCase();
    if (!asset.video) return format;
    return [format, VIDEO_CODEC_LABELS[asset.video.videoCodec], asset.video.audioCodec ? AUDIO_CODEC_LABELS[asset.video.audioCodec] : null].filter(Boolean).join(' · ');
}
// Duplicate copies the content, so a video screen cannot be copied at the video screen limit (B29 R19).
export const duplicateLimitReached = (entity: SceneEntity, entities: readonly SceneEntity[]): boolean => isVideoScreen(entity) && videoScreenLimitReached(entities);
