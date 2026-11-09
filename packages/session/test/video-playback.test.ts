import { describe, expect, it } from 'vitest';
import { makeSmokeScene, type SceneEntity, type SceneView, type ScreenContent } from '@opensekai/contracts';
import { applyControls, checkControl, EMPTY_VIDEO_PLAYBACK, playbackPosition, reconcilePlayback, screenPlayback } from '../src/video-playback';

const screen = (id: string, content: ScreenContent): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content });
const video = (assetId: string | null, autoPlay = true, extra: Partial<{ loop: boolean; volume: number }> = {}): ScreenContent => ({ kind: 'video', assetId, autoPlay, loop: true, volume: 1, ...extra });
const scene = (...entities: SceneEntity[]): SceneView => { const base = makeSmokeScene(); return { ...base, entities: [...base.entities, ...entities] }; };
const play = (entityId: string, action: 'play' | 'pause' | 'restart') => ({ kind: 'controlScreenVideo' as const, entityId, action });

describe('video playback entries', () => {
 it('starts an entry at position 0 with playing equal to autoPlay', () => {
  const entries = reconcilePlayback(EMPTY_VIDEO_PLAYBACK, null, scene(screen('a', video('video_a', true)), screen('b', video('video_b', false)), screen('c', { kind: 'image', assetId: null })), 100);
  expect([...entries]).toEqual([['a', { playing: true, anchorMs: 100, offsetMs: 0 }], ['b', { playing: false, anchorMs: 100, offsetMs: 0 }]]);
 });

 it('keeps the entry on an autoPlay, loop, or volume change and starts it again on an asset change', () => {
  const before = scene(screen('a', video('video_a', true)));
  const entries = applyControls(reconcilePlayback(EMPTY_VIDEO_PLAYBACK, null, before, 0), [play('a', 'pause')], 500);
  const settings = scene(screen('a', video('video_a', false, { loop: false, volume: 0.2 })));
  expect(reconcilePlayback(entries, before, settings, 900).get('a')).toEqual(entries.get('a'));
  expect(reconcilePlayback(entries, before, scene(screen('a', video('video_b', true))), 900).get('a')).toEqual({ playing: true, anchorMs: 900, offsetMs: 0 });
 });

 it('starts an entry when a screen gets video content and removes it when the content or screen goes', () => {
  const image = scene(screen('a', { kind: 'image', assetId: null }));
  const withVideo = scene(screen('a', video('video_a', false)));
  expect(reconcilePlayback(EMPTY_VIDEO_PLAYBACK, image, withVideo, 40).get('a')).toEqual({ playing: false, anchorMs: 40, offsetMs: 0 });
  const entries = reconcilePlayback(EMPTY_VIDEO_PLAYBACK, null, withVideo, 0);
  expect(reconcilePlayback(entries, withVideo, image, 50).size).toBe(0);
  expect(reconcilePlayback(entries, withVideo, scene(), 50).size).toBe(0);
 });

 it('plays, pauses, and restarts on the session clock', () => {
  const start = reconcilePlayback(EMPTY_VIDEO_PLAYBACK, null, scene(screen('a', video('video_a', false))), 0);
  const playing = applyControls(start, [play('a', 'play')], 1000);
  expect(playbackPosition(playing.get('a')!, 1600)).toBe(600);
  expect(applyControls(playing, [play('a', 'play')], 1300).get('a')).toEqual(playing.get('a'));
  const paused = applyControls(playing, [play('a', 'pause')], 1400);
  expect(playbackPosition(paused.get('a')!, 5000)).toBe(400);
  const resumed = applyControls(paused, [play('a', 'play')], 2000);
  expect(playbackPosition(resumed.get('a')!, 2100)).toBe(500);
  expect(applyControls(resumed, [play('a', 'restart')], 2100).get('a')).toEqual({ playing: true, anchorMs: 2100, offsetMs: 0 });
  expect(applyControls(paused, [play('a', 'restart')], 2100).get('a')).toEqual({ playing: false, anchorMs: 2100, offsetMs: 0 });
 });

 it('checks that a control targets a video screen', () => {
  const s = scene(screen('a', video('video_a')), screen('b', { kind: 'image', assetId: null }));
  expect(checkControl(s, play('a', 'play')).ok).toBe(true);
  expect(checkControl(s, play('b', 'play'))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['b'] } });
  expect(checkControl(s, play('performer', 'play'))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(checkControl(s, play('nobody', 'play'))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['nobody'] } });
 });

 it('lists only screens with an asset and floors the position', () => {
  const s = scene(screen('a', video('video_a')), screen('b', video(null)));
  const entries = reconcilePlayback(EMPTY_VIDEO_PLAYBACK, null, s, 10);
  expect(screenPlayback(entries, s, 26.67)).toEqual([{ entityId: 'a', playing: true, positionMs: 16 }]);
  expect(screenPlayback(EMPTY_VIDEO_PLAYBACK, scene(), 0)).toEqual([]);
 });
});
