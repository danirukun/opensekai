import { it, expect } from 'vitest';
import { DEFAULT_AVATAR_LIGHTING, makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const lighting = { ...DEFAULT_AVATAR_LIGHTING, rimStrength: 1.5, rimTint: '#ffeedd', environmentFill: 0.5 };
const performer = (s: ReturnType<typeof createSession>) => s.inspect().entities.find(e => e.id === 'performer');
it('sets a copy of the lighting on an avatar and removes it with null', () => {
    const s = createSession(makeSmokeScene(), 'lighting-test');
    const sent = structuredClone(lighting);
    expect(s.applyPatch(patch(0, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: sent }]))).toMatchObject({ ok: true, data: { revision: 1 } });
    sent.rimStrength = 0;
    expect(performer(s)).toMatchObject({ lighting });
    expect(s.applyPatch(patch(1, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: null }]))).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(performer(s)).not.toHaveProperty('lighting');
});
it('rejects another kind, an unknown entity, and a value out of range without a change', () => {
    const s = createSession(makeSmokeScene(), 'lighting-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setAvatarLighting', entityId: 'camera_wide', lighting }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity is not an avatar' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setAvatarLighting', entityId: 'nobody', lighting }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: { ...lighting, rimStrength: 2.5 } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
