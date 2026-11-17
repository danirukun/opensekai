import { it, expect } from 'vitest';
import { DEFAULT_CAMERA_EFFECTS, makeSmokeScene, type CameraEffects } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const effects: CameraEffects = { blur: { enabled: true, intensity: 2 }, vignetting: { ...DEFAULT_CAMERA_EFFECTS.vignetting, enabled: true } };
const camera = (s: ReturnType<typeof createSession>) => s.inspect().entities.find(e => e.id === 'camera_wide');
it('sets a copy of the effects on a camera and removes them with null', () => {
    const s = createSession(makeSmokeScene(), 'effects-test');
    const sent = structuredClone(effects);
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects: sent }]))).toMatchObject({ ok: true, data: { revision: 1 } });
    sent.blur!.intensity = 4;
    expect(camera(s)).toMatchObject({ effects });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects: null }]))).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(camera(s)).not.toHaveProperty('effects');
});
it('rejects another kind, an unknown entity, and a value out of range without a change', () => {
    const s = createSession(makeSmokeScene(), 'effects-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraEffects', entityId: 'performer', effects }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraEffects', entityId: 'nobody', effects }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects: { pixelate: { enabled: true, intensity: 0 } } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
it('commits each live edit of a drag as setCameraGrading does', () => {
    const s = createSession(makeSmokeScene(), 'effects-test');
    const steps = [0.5, 1, 1.5];
    steps.forEach((intensity, revision) =>
        expect(s.applyPatch(patch(revision, [{ kind: 'setCameraEffects', entityId: 'camera_wide', effects: { blur: { enabled: true, intensity } } }]))).toMatchObject({ ok: true, data: { revision: revision + 1 } }));
    expect(camera(s)).toMatchObject({ effects: { blur: { enabled: true, intensity: 1.5 } } });
});
