import { it, expect } from 'vitest';
import { DEFAULT_AVATAR_LIGHTING, makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { COMMIT_IDLE_MS, EMPTY_OVERRIDES, dropOverrides, takeIdle, writeOverride } from '../src/overrides';
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
it('commits an idle Blueprint Rim Strength override with one setAvatarLighting that keeps the other values', () => {
    const scene = makeSmokeScene();
    scene.entities = scene.entities.map(e => e.id === 'performer' ? { ...e, lighting } as typeof e : e);
    const written = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'performer', property: 'rimStrength', value: 0.25 }, 'graph', 0);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS - 1).operations).toEqual([]);
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS).operations).toEqual([{ kind: 'setAvatarLighting', entityId: 'performer', lighting: { ...lighting, rimStrength: 0.25 } }]);
    expect(dropOverrides(written.data, [{ kind: 'setAvatarLighting', entityId: 'performer', lighting: null }]).size).toBe(0);
    expect(writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'performer', property: 'rimStrength', value: 2.5 }, 'graph', 0).ok).toBe(false);
});
it('writes Rim Strength on an avatar without lighting, and a write of the default keeps the group absent', () => {
    const scene = makeSmokeScene();
    const same = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'performer', property: 'rimStrength', value: DEFAULT_AVATAR_LIGHTING.rimStrength }, 'graph', 0);
    expect(same.ok && same.data.size).toBe(0);
    const written = writeOverride(EMPTY_OVERRIDES, scene, { kind: 'setProperty', entityId: 'performer', property: 'rimStrength', value: 0 }, 'graph', 0);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(takeIdle(scene, written.data, COMMIT_IDLE_MS).operations).toEqual([{ kind: 'setAvatarLighting', entityId: 'performer', lighting: { ...DEFAULT_AVATAR_LIGHTING, rimStrength: 0 } }]);
});
