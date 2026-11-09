import type { ErrorCode, Id, Reply, RuntimePatchOp, SceneEntity, ScenePatch, ScreenPlayback, ScreenVideo, SceneView } from '@opensekai/contracts';

// The runtime playback of one video screen (B29 R11). The session never saves it.
export interface VideoPlayback { readonly playing: boolean; readonly anchorMs: number; readonly offsetMs: number; }
export type VideoPlaybacks = ReadonlyMap<Id, VideoPlayback>;
export type ControlOp = RuntimePatchOp;

export const EMPTY_VIDEO_PLAYBACK: VideoPlaybacks = new Map();

const failure = (code: ErrorCode, message: string, ids: Id[] = []): Reply<never> => ({ ok: false, error: { code, message, ids } });

const videoOf = (entity: SceneEntity | undefined): ScreenVideo | null =>
 entity?.kind === 'screen' && entity.content.kind === 'video' ? entity.content : null;

const videoScreens = (scene: SceneView): [Id, ScreenVideo][] =>
 scene.entities.flatMap(entity => { const video = videoOf(entity); return video ? [[entity.id, video] as [Id, ScreenVideo]] : []; });

export const isControlOp = (operation: ScenePatch['operations'][number]): operation is ControlOp => operation.kind === 'controlScreenVideo';

const started = (autoPlay: boolean, nowMs: number): VideoPlayback => ({ playing: autoPlay, anchorMs: nowMs, offsetMs: 0 });

// One entry for each screen with video content. An entry starts again when the screen gets video content or a new asset ID.
// A change of autoPlay, loop, or volume keeps the entry. Pass a null `before` for a new or opened show.
export const reconcilePlayback = (entries: VideoPlaybacks, before: SceneView | null, after: SceneView, nowMs: number): VideoPlaybacks =>
 new Map(videoScreens(after).map(([id, video]) => {
  const previous = before ? videoOf(before.entities.find(entity => entity.id === id)) : null;
  const kept = previous && previous.assetId === video.assetId ? entries.get(id) : undefined;
  return [id, kept ?? started(video.autoPlay, nowMs)];
 }));

export const playbackPosition = (entry: VideoPlayback, nowMs: number): number =>
 entry.playing ? entry.offsetMs + Math.max(0, nowMs - entry.anchorMs) : entry.offsetMs;

export const checkControl = (scene: SceneView, operation: ControlOp): Reply<null> => {
 const entity = scene.entities.find(item => item.id === operation.entityId);
 if (!entity) return failure('NOT_FOUND', 'Entity not found', [operation.entityId]);
 if (!videoOf(entity)) return failure('INVALID_INPUT', 'Entity is not a video screen', [operation.entityId]);
 return { ok: true, data: null };
};

// Play on a playing entry keeps its position.
const controlled = (entry: VideoPlayback, action: ControlOp['action'], nowMs: number): VideoPlayback => {
 switch (action) {
  case 'play': return entry.playing ? entry : { playing: true, anchorMs: nowMs, offsetMs: entry.offsetMs };
  case 'pause': return { playing: false, anchorMs: nowMs, offsetMs: playbackPosition(entry, nowMs) };
  case 'restart': return { playing: entry.playing, anchorMs: nowMs, offsetMs: 0 };
 }
};

// The caller checks each operation with checkControl first. An operation without an entry changes nothing.
export const applyControls = (entries: VideoPlaybacks, operations: readonly ControlOp[], nowMs: number): VideoPlaybacks =>
 operations.reduce<VideoPlaybacks>((current, operation) => {
  const entry = current.get(operation.entityId);
  return entry ? new Map([...current, [operation.entityId, controlled(entry, operation.action, nowMs)]]) : current;
 }, entries);

// The frame list: each screen with video content and an asset, in scene order. The position is floored to an integer millisecond.
export const screenPlayback = (entries: VideoPlaybacks, scene: SceneView, nowMs: number): ScreenPlayback[] =>
 videoScreens(scene).flatMap(([entityId, video]) => {
  const entry = entries.get(entityId);
  return entry && video.assetId !== null ? [{ entityId, playing: entry.playing, positionMs: Math.floor(playbackPosition(entry, nowMs)) }] : [];
 });
