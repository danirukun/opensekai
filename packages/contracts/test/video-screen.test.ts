import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/video-records.json';
import { AssetRecordSchema, AssetSummarySchema, LIMITS, PatchOpSchema, RuntimeFrameSchema, SceneViewSchema, makeSmokeScene, type SceneEntity } from '../src/index';
const placed = { name: 'Screen', visible: true, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] } };
const video = (id: string, volume = 1): SceneEntity => ({ id, ...placed, kind: 'screen', content: { kind: 'video', assetId: 'video_a', autoPlay: false, loop: true, volume } });
const image = (id: string): SceneEntity => ({ id, ...placed, kind: 'screen', content: { kind: 'image', assetId: null } });
// B29 R1: the same vectors as crates/contracts/tests/video_screen.rs.
it.each(vectors.valid)('accepts the video record vector $name', ({ record }) => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(true);
});
it.each(vectors.invalid)('rejects the video record vector $name', ({ record }) => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(false);
});
it('lists a video summary with the video kind', () => {
    expect(AssetSummarySchema.safeParse({ id: 'video_a', kind: 'video', name: 'Clip' }).success).toBe(true);
});
it('accepts at most 4 video screens inside the screen limit', () => {
    const scene = makeSmokeScene();
    scene.entities.push(...Array.from({ length: LIMITS.videoScreens }, (_, i) => video(`v${i}`)), ...Array.from({ length: LIMITS.screens - LIMITS.videoScreens }, (_, i) => image(`i${i}`)));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    const over = makeSmokeScene();
    over.entities.push(...Array.from({ length: LIMITS.videoScreens + 1 }, (_, i) => video(`v${i}`)));
    expect(SceneViewSchema.safeParse(over).success).toBe(false);
});
it('rejects a video volume outside 0 to 1 and an unknown content field', () => {
    const scene = makeSmokeScene();
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, video('v', 1.5)] }).success).toBe(false);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, { ...video('v'), content: { kind: 'video', assetId: null, autoPlay: true, loop: true, volume: 1, rate: 2 } }] }).success).toBe(false);
});
it('parses setScreenVideo and controlScreenVideo', () => {
    const settings = { assetId: 'video_a', autoPlay: true, loop: false, volume: 0.5 };
    expect(PatchOpSchema.safeParse({ kind: 'setScreenVideo', entityId: 'clip', video: settings }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenVideo', entityId: 'clip', video: { ...settings, assetId: null } }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenVideo', entityId: 'clip', video: { ...settings, volume: -0.1 } }).success).toBe(false);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenVideo', entityId: 'clip', video: { assetId: 'video_a' } }).success).toBe(false);
    for (const action of ['play', 'pause', 'restart']) expect(PatchOpSchema.safeParse({ kind: 'controlScreenVideo', entityId: 'clip', action }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'controlScreenVideo', entityId: 'clip', action: 'seek' }).success).toBe(false);
});
it('accepts screenPlayback on a frame with unique IDs and integer positions', () => {
    const frame = { schemaVersion: 1, sessionId: 's', sequence: 1, tick: 1, elapsedMs: 16, scene: makeSmokeScene() };
    expect(RuntimeFrameSchema.safeParse(frame).success).toBe(true);
    expect(RuntimeFrameSchema.safeParse({ ...frame, screenPlayback: [{ entityId: 'a', playing: true, positionMs: 1250 }] }).success).toBe(true);
    expect(RuntimeFrameSchema.safeParse({ ...frame, screenPlayback: [{ entityId: 'a', playing: true, positionMs: 1 }, { entityId: 'a', playing: false, positionMs: 2 }] }).success).toBe(false);
    expect(RuntimeFrameSchema.safeParse({ ...frame, screenPlayback: [{ entityId: 'a', playing: true, positionMs: 1.5 }] }).success).toBe(false);
    expect(RuntimeFrameSchema.safeParse({ ...frame, screenPlayback: [{ entityId: 'a', playing: true, positionMs: -1 }] }).success).toBe(false);
    expect(RuntimeFrameSchema.safeParse({ ...frame, screenPlayback: Array.from({ length: LIMITS.videoScreens + 1 }, (_, i) => ({ entityId: `v${i}`, playing: true, positionMs: 0 })) }).success).toBe(false);
});
