import { it, expect } from 'vitest';
import { makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
it('sets the anti-aliasing mode on a camera and increases the revision', () => {
    const s = createSession(makeSmokeScene(), 'quality-test');
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraAntiAliasing', entityId: 'camera_wide', antiAliasing: 'fxaa' }]))).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(s.inspect().entities.find(e => e.id === 'camera_wide')).toMatchObject({ antiAliasing: 'fxaa' });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraAntiAliasing', entityId: 'camera_wide', antiAliasing: 'none' }])).ok).toBe(true);
    expect(s.inspect().entities.find(e => e.id === 'camera_wide')).toMatchObject({ antiAliasing: 'none' });
});
it('rejects another kind, an unknown entity, and an unknown mode without a change', () => {
    const s = createSession(makeSmokeScene(), 'quality-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraAntiAliasing', entityId: 'performer', antiAliasing: 'fxaa' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraAntiAliasing', entityId: 'nobody', antiAliasing: 'fxaa' }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraAntiAliasing', entityId: 'camera_wide', antiAliasing: 'smaa' }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
