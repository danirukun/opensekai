import { expect, it } from 'vitest';
import { PatchOpSchema, SceneViewSchema, makeSmokeScene, type SceneEntity } from '../src/index';
const prop = (id: string, assetId: string | null): SceneEntity => ({ id, name: 'Prop', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'mesh', source: { kind: 'asset', assetId } });
it('accepts props with and without a model, more than one for each model', () => {
    const scene = makeSmokeScene();
    scene.entities.push(prop('walls', 'scene_a'), prop('walls_2', 'scene_a'), prop('empty', null));
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
});
it('parses setMeshModel with a model or null and rejects it without assetId', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setMeshModel', entityId: 'walls', assetId: 'scene_a' }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setMeshModel', entityId: 'walls', assetId: null }).success).toBe(true);
    expect(PatchOpSchema.safeParse({ kind: 'setMeshModel', entityId: 'walls' }).success).toBe(false);
});
