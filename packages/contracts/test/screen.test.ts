import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/image-records.json';
import { AssetRecordSchema, AssetSummarySchema, LIMITS, PatchOpSchema, SceneViewSchema, makeSmokeScene, type SceneEntity } from '../src/index';
const screen = (id: string, assetId: string | null): SceneEntity => ({ id, name: 'Screen', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'image', assetId } });
// B28 R1: the same vectors as crates/contracts/tests/screen.rs.
it.each(vectors.valid)('accepts the image record vector $name', ({ record }) => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(true);
});
it.each(vectors.invalid)('rejects the image record vector $name', ({ record }) => {
    expect(AssetRecordSchema.safeParse(record).success).toBe(false);
});
it('lists an image summary with the image kind', () => {
    expect(AssetSummarySchema.safeParse({ id: 'image_a', kind: 'image', name: 'Logo' }).success).toBe(true);
});
it('accepts screens with and without an image up to the limit', () => {
    const scene = makeSmokeScene();
    scene.entities.push(screen('logo', 'image_a'), screen('empty', null));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    const full = makeSmokeScene();
    full.entities.push(...Array.from({ length: LIMITS.screens }, (_, i) => screen(`s${i}`, null)));
    expect(SceneViewSchema.safeParse(full).success).toBe(true);
    full.entities.push(screen('over', null));
    expect(SceneViewSchema.safeParse(full).success).toBe(false);
    expect(SceneViewSchema.safeParse({ ...scene, entities: [...scene.entities, { ...screen('v', null), content: { kind: 'video', assetId: null } }] }).success).toBe(false);
});
it('parses setScreenImage with an image or null and rejects it without assetId', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setScreenImage', entityId: 'logo', assetId: 'image_a' }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenImage', entityId: 'logo', assetId: null }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setScreenImage', entityId: 'logo' }).success).toBe(false);
});
