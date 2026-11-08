import { expect, it } from 'vitest';
import { LIMITS, makeSmokeScene, RuntimeFrameSchema, ShowSceneSchema, type SceneEntity, type ScreenContent } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const video = (assetId: string | null, autoPlay = false) => ({ assetId, autoPlay, loop: true, volume: 1 });
const screen = (id: string, content: ScreenContent = { kind: 'image', assetId: null }): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content });
const videoScreen = (id: string, assetId: string | null = 'video_a', autoPlay = false) => screen(id, { kind: 'video', ...video(assetId, autoPlay) });
const control = (entityId: string, action: 'play' | 'pause' | 'restart') => ({ kind: 'controlScreenVideo', entityId, action });
const create = (entity: SceneEntity) => ({ kind: 'createEntity', entity });
const content = (s: ReturnType<typeof createSession>, id: string) => (s.inspect().entities.find(e => e.id === id) as Extract<SceneEntity, { kind: 'screen' }>).content;
const playback = (s: ReturnType<typeof createSession>, ms: number) => {
    const frame = s.advance(ms);
    expect(RuntimeFrameSchema.safeParse(frame).success).toBe(true);
    return frame.screenPlayback;
};

it('sets video content and sets image content back', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(screen('tv'))])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenVideo', entityId: 'tv', video: video('video_a', true) }]))).toEqual({ ok: true, data: { revision: 2 } });
    expect(content(s, 'tv')).toEqual({ kind: 'video', ...video('video_a', true) });
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenImage', entityId: 'tv', assetId: 'image_a' }])).ok).toBe(true);
    expect(content(s, 'tv')).toEqual({ kind: 'image', assetId: 'image_a' });
});

it('rejects setScreenVideo on another kind or an unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'video-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setScreenVideo', entityId: 'performer', video: video(null) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setScreenVideo', entityId: 'nobody', video: video(null) }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});

it('gives frames no screenPlayback field without a video screen with an asset', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect('screenPlayback' in s.advance(0)).toBe(false);
    expect(s.applyPatch(patch(0, [create(videoScreen('tv', null, true))])).ok).toBe(true);
    expect('screenPlayback' in s.advance(16)).toBe(false);
});

it('plays, pauses, and restarts with control-only patches that keep the revision', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    s.advance(0);
    expect(s.applyPatch(patch(0, [create(videoScreen('tv'))])).ok).toBe(true);
    expect(playback(s, 500)).toEqual([{ entityId: 'tv', playing: false, positionMs: 0 }]);
    // An old expected revision does not matter: the patch does not commit.
    expect(s.applyPatch(patch(0, [control('tv', 'play')]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(s.inspect().revision).toBe(1);
    expect(playback(s, 1000)).toEqual([{ entityId: 'tv', playing: true, positionMs: 500 }]);
    expect(playback(s, 1250.9)).toEqual([{ entityId: 'tv', playing: true, positionMs: 750 }]);
    expect(s.applyPatch(patch(99, [control('tv', 'pause')])).ok).toBe(true);
    expect(playback(s, 3000)).toEqual([{ entityId: 'tv', playing: false, positionMs: 750 }]);
    expect(s.applyPatch(patch(1, [control('tv', 'restart')])).ok).toBe(true);
    expect(playback(s, 3500)).toEqual([{ entityId: 'tv', playing: false, positionMs: 0 }]);
    expect(s.applyPatch(patch(1, [control('tv', 'play'), control('tv', 'restart')])).ok).toBe(true);
    expect(playback(s, 3600)).toEqual([{ entityId: 'tv', playing: true, positionMs: 100 }]);
    expect(s.inspect().revision).toBe(1);
});

it('rejects a control-only patch on an unknown entity or a screen without video content', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(screen('logo'))])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [control('nobody', 'play')]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['nobody'] } });
    expect(s.applyPatch(patch(1, [control('logo', 'play')]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['logo'] } });
    expect(s.applyPatch(patch(1, [control('performer', 'play')]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('creates and plays one screen in a mixed patch', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    s.advance(100);
    expect(s.applyPatch(patch(0, [create(videoScreen('tv')), control('tv', 'play')]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(playback(s, 400)).toEqual([{ entityId: 'tv', playing: true, positionMs: 300 }]);
});

it('checks the expected revision of a mixed patch', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(videoScreen('tv'))])).ok).toBe(true);
    expect(s.applyPatch(patch(0, [{ kind: 'renameEntity', entityId: 'tv', name: 'TV' }, control('tv', 'play')]))).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    expect(playback(s, 100)).toEqual([{ entityId: 'tv', playing: false, positionMs: 0 }]);
});

it('rejects a mixed patch with a bad control operation and commits nothing', () => {
    const s = createSession(makeSmokeScene(), 'video-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [create(videoScreen('tv')), create(screen('logo')), control('tv', 'play'), control('logo', 'play')]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['logo'] } });
    expect(s.inspect()).toEqual(before);
    // A control that a removal in the same patch makes invalid fails too.
    expect(s.applyPatch(patch(0, [create(videoScreen('tv'))])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'removeEntity', entityId: 'tv' }, control('tv', 'play')]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect().revision).toBe(1);
});

it('starts the entry again on an asset change and keeps it on an Auto Play, Loop, or Volume change', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(videoScreen('tv')), control('tv', 'play')])).ok).toBe(true);
    expect(playback(s, 1000)).toEqual([{ entityId: 'tv', playing: true, positionMs: 1000 }]);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenVideo', entityId: 'tv', video: { assetId: 'video_a', autoPlay: true, loop: false, volume: 0.25 } }])).ok).toBe(true);
    expect(playback(s, 1200)).toEqual([{ entityId: 'tv', playing: true, positionMs: 1200 }]);
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenVideo', entityId: 'tv', video: { assetId: 'video_b', autoPlay: false, loop: false, volume: 0.25 } }])).ok).toBe(true);
    expect(playback(s, 1500)).toEqual([{ entityId: 'tv', playing: false, positionMs: 0 }]);
});

it('starts an entry for a screen that gets video content and removes it on image content or delete', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(screen('tv')), create(screen('tv_2'))])).ok).toBe(true);
    s.advance(200);
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenVideo', entityId: 'tv', video: video('video_a', true) }, { kind: 'setScreenVideo', entityId: 'tv_2', video: video('video_a', true) }])).ok).toBe(true);
    expect(playback(s, 300)).toEqual([{ entityId: 'tv', playing: true, positionMs: 100 }, { entityId: 'tv_2', playing: true, positionMs: 100 }]);
    expect(s.applyPatch(patch(2, [{ kind: 'setScreenImage', entityId: 'tv', assetId: null }, { kind: 'removeEntity', entityId: 'tv_2' }])).ok).toBe(true);
    expect('screenPlayback' in s.advance(400)).toBe(false);
    expect(s.applyPatch(patch(3, [control('tv', 'play')]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('gives a duplicate (createEntity) its own entry', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(videoScreen('tv', 'video_a', true))])).ok).toBe(true);
    s.advance(1000);
    expect(s.applyPatch(patch(1, [create(videoScreen('tv_copy', 'video_a', true))])).ok).toBe(true);
    expect(playback(s, 1100)).toEqual([{ entityId: 'tv', playing: true, positionMs: 1100 }, { entityId: 'tv_copy', playing: true, positionMs: 100 }]);
});

it('starts all entries again when a show opens', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    expect(s.applyPatch(patch(0, [create(videoScreen('tv', 'video_a', false)), control('tv', 'play')])).ok).toBe(true);
    s.advance(2000);
    const show = ShowSceneSchema.parse({ ...s.inspect(), revision: 0 });
    expect(s.replaceScene(show, 1).ok).toBe(true);
    expect(playback(s, 2500)).toEqual([{ entityId: 'tv', playing: false, positionMs: 0 }]);
});

it('rejects a fifth video screen by setScreenVideo, createEntity, and duplicate', () => {
    const s = createSession(makeSmokeScene(), 'video-test');
    const four = Array.from({ length: LIMITS.videoScreens }, (_, i) => create(videoScreen(`v${i}`)));
    expect(s.applyPatch(patch(0, [...four, create(screen('logo'))])).ok).toBe(true);
    const before = s.inspect();
    expect(s.applyPatch(patch(1, [{ kind: 'setScreenVideo', entityId: 'logo', video: video(null) }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [create(videoScreen('v4', null))]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    // The editor Duplicate sends createEntity with a copy of the screen.
    expect(s.applyPatch(patch(1, [create({ ...videoScreen('v0'), id: 'v0_copy', name: 'Screen copy' })]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
    expect(s.advance(0).screenPlayback).toHaveLength(LIMITS.videoScreens);
});
