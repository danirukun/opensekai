import { expect, it } from 'vitest';
import { AssetRecordSchema, PatchOpSchema, SceneViewSchema, makeSmokeScene, type SceneEntity } from '../src/index';
const environment = (id: string): SceneEntity => ({ id, name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null });
const record = { id: 'scene_' + 'a'.repeat(64), format: 'glb', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name: 'Room' };
it('accepts one environment and rejects a second one', () => {
    const scene = makeSmokeScene();
    scene.entities.push(environment('stage'));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    scene.entities.push(environment('stage_2'));
    expect(SceneViewSchema.safeParse(scene).success).toBe(false);
});
it('accepts a camera with and without the Render Environment flag', () => {
    const scene = makeSmokeScene();
    const camera = scene.entities.find(entity => entity.kind === 'camera')!;
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    if (camera.kind === 'camera') camera.renderEnvironment = false;
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
});
it('parses both environment operations', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setEnvironmentModel', entityId: 'stage', assetId: null }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setEnvironmentModel', entityId: 'stage', assetId: 'scene_a' }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setCameraRenderEnvironment', entityId: 'camera_wide', renderEnvironment: false }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setCameraRenderEnvironment', entityId: 'camera_wide' }).success).toBe(false);
});
it('accepts records with and without credits and rejects null credits', () => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(true);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: 'Room', author: null, license: 'CC-BY-4.0', sourceUrl: 'https://sketchfab.com/3d-models/room' } }).success).toBe(true);
    expect(AssetRecordSchema.safeParse({ ...record, credits: null }).success).toBe(false);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: null, author: null, license: null, sourceUrl: 'ftp://example.com/room' } }).success).toBe(false);
    expect(AssetRecordSchema.safeParse({ ...record, credits: { title: null, author: null, license: null } }).success).toBe(false);
});
