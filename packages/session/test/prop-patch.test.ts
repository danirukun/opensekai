import { it, expect } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const prop = (id: string): SceneEntity => ({ id, name: 'Prop', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'mesh', source: { kind: 'asset', assetId: null } });
const source = (s: ReturnType<typeof createSession>, id: string) => (s.inspect().entities.find(e => e.id === id) as Extract<SceneEntity, { kind: 'mesh' }>).source;
it('creates props, gives two of them one model, and clears one', () => {
    const s = createSession(makeSmokeScene(), 'prop-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: prop('walls') }, { kind: 'createEntity', entity: prop('walls_2') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setMeshModel', entityId: 'walls', assetId: 'scene_a' }, { kind: 'setMeshModel', entityId: 'walls_2', assetId: 'scene_a' }])).ok).toBe(true);
    expect([source(s, 'walls'), source(s, 'walls_2')]).toEqual([{ kind: 'asset', assetId: 'scene_a' }, { kind: 'asset', assetId: 'scene_a' }]);
    expect(s.applyPatch(patch(2, [{ kind: 'setMeshModel', entityId: 'walls', assetId: null }])).ok).toBe(true);
    expect([source(s, 'walls'), source(s, 'walls_2')]).toEqual([{ kind: 'asset', assetId: null }, { kind: 'asset', assetId: 'scene_a' }]);
});
it('rejects setMeshModel on another kind or an unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'prop-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setMeshModel', entityId: 'performer', assetId: 'scene_a' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setMeshModel', entityId: 'nobody', assetId: null }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
