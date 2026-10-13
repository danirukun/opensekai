import { it, expect } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const environment = (id: string): SceneEntity => ({ id, name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null });
it('creates an environment and sets, replaces, and clears its model', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: environment('stage') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'setEnvironmentModel', entityId: 'stage', assetId: 'scene_a' }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ assetId: 'scene_a' });
    expect(s.applyPatch(patch(2, [{ kind: 'setEnvironmentModel', entityId: 'stage', assetId: null }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'stage')).toMatchObject({ assetId: null });
});
it('rejects a second environment', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: environment('stage') }])).ok).toBe(true);
    expect(s.applyPatch(patch(1, [{ kind: 'createEntity', entity: environment('stage_2') }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});
it('rejects setEnvironmentModel on another kind or an unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'environment-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setEnvironmentModel', entityId: 'performer', assetId: 'scene_a' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setEnvironmentModel', entityId: 'nobody', assetId: null }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.inspect()).toEqual(before);
});
it('sets the Render Environment flag on a camera only', () => {
    const s = createSession(makeSmokeScene(), 'environment-test');
    const camera = s.inspect().entities.find(e => e.kind === 'camera')!;
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraRenderEnvironment', entityId: camera.id, renderEnvironment: false }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === camera.id)).toMatchObject({ renderEnvironment: false });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraRenderEnvironment', entityId: 'performer', renderEnvironment: true }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraRenderEnvironment', entityId: 'nobody', renderEnvironment: true }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
