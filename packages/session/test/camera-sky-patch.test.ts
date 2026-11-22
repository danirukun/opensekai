import { it, expect } from 'vitest';
import { makeSmokeScene, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';

const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const camera = (s: ReturnType<typeof createSession>, id: string) => s.inspect().entities.find(e => e.id === id) as Extract<SceneEntity, { kind: 'camera' }>;

it('sets a color sky on a camera', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    expect(camera(s, 'camera_wide').sky).toBeUndefined();
    const sky = { kind: 'color', color: '#003366', intensity: 1.5, ibl: true };
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky }]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(camera(s, 'camera_wide').sky).toEqual(sky);
});

it('clears sky with null', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: { kind: 'color', color: '#ff0000' } }]));
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: null }]))).toEqual({ ok: true, data: { revision: 2 } });
    expect(camera(s, 'camera_wide').sky).toBeUndefined();
});

it('sets an hdr sky with assetId', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    const sky = { kind: 'hdr', assetId: 'hdr_asset_1', intensity: 0.8, blurriness: 0.3, ibl: false };
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky }]))).toEqual({ ok: true, data: { revision: 1 } });
    expect(camera(s, 'camera_wide').sky).toEqual(sky);
});

it('sets kind none to clear the sky', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: { kind: 'color', color: '#ff0000' } }]));
    expect(s.applyPatch(patch(1, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: { kind: 'none' } }]))).toEqual({ ok: true, data: { revision: 2 } });
    expect(camera(s, 'camera_wide').sky).toEqual({ kind: 'none' });
});

it('rejects image or hdr sky with null assetId', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: { kind: 'image', assetId: null } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'camera_wide', sky: { kind: 'hdr', assetId: null } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('rejects setCameraSky on a non-camera entity', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'performer', sky: { kind: 'none' } }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('rejects setCameraSky on unknown entity', () => {
    const s = createSession(makeSmokeScene(), 'sky-test');
    expect(s.applyPatch(patch(0, [{ kind: 'setCameraSky', entityId: 'nobody', sky: { kind: 'none' } }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
