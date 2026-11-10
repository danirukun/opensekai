import { it, expect } from 'vitest';
import { DEFAULT_CAMERA_GRADING, makeSmokeScene } from '@opensekai/contracts';
import { createSession } from '../src/session';
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const grading = { ...DEFAULT_CAMERA_GRADING, toneMapping: 'aces', exposure: 0.5, bloom: { intensity: 1, threshold: 0.76, radius: 0.4 } };
const camera = (s: ReturnType<typeof createSession>) => s.inspect().entities.find(e => e.id === 'camera_wide');
it('sets a copy of the grading on a camera and removes it with null', () => {
    const s = createSession(makeSmokeScene(), 'grading-test');
    const sent = structuredClone(grading);
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraGrading', entityId: 'camera_wide', grading: sent }]))).toMatchObject({ ok: true, data: { revision: 1 } });
    sent.bloom.intensity = 4;
    expect(camera(s)).toMatchObject({ grading });
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraGrading', entityId: 'camera_wide', grading: null }]))).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(camera(s)).not.toHaveProperty('grading');
});
it('rejects another kind, an unknown entity, and a value out of range without a change', () => {
    const s = createSession(makeSmokeScene(), 'grading-test'); const before = s.inspect();
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraGrading', entityId: 'performer', grading }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraGrading', entityId: 'nobody', grading }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraGrading', entityId: 'camera_wide', grading: { ...grading, exposure: 5 } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.inspect()).toEqual(before);
});
