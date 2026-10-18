import { expect, it } from 'vitest';
import { CameraNavigationSchema, LIMITS, PatchOpSchema, ResultSchemas, SceneViewSchema, ShowSceneSchema, makeSmokeScene, requiredCapability, validateCall } from '../src/index';

const orbit = { mode: 'orbitCharacter', sensitivity: 1, targetId: 'performer', pivotOffset: [0, 1.3, 0] } as const;
const withNavigation = (navigation: unknown) => { const scene = makeSmokeScene(); Object.assign(scene.entities.find(e => e.id === 'camera_wide')!, { navigation }); return scene; };

it('accepts each control mode and a camera without the field (R1)', () => {
    expect(SceneViewSchema.safeParse(makeSmokeScene()).success).toBe(true);
    for (const navigation of [{ mode: 'none' }, { mode: 'freeLook', sensitivity: 0.1 }, { mode: 'freeLook', sensitivity: 10 }, orbit, { ...orbit, targetId: null }])
        expect(ShowSceneSchema.safeParse(withNavigation(navigation)).success).toBe(true);
});
it('rejects a bad sensitivity, pivot, target, or extra field (R1, R2)', () => {
    for (const navigation of [{ mode: 'freeLook', sensitivity: 0.09 }, { mode: 'freeLook', sensitivity: 10.5 }, { mode: 'freeLook' }, { mode: 'none', sensitivity: 1 }, { ...orbit, pivotOffset: [0, -1000.5, 0] }, { ...orbit, pivotOffset: [0, Infinity, 0] }])
        expect(CameraNavigationSchema.safeParse(navigation).success).toBe(false);
    expect(SceneViewSchema.safeParse(withNavigation({ ...orbit, targetId: 'missing' })).success).toBe(false);
    expect(SceneViewSchema.safeParse(withNavigation({ ...orbit, targetId: 'camera_close' })).success).toBe(false);
});
it('holds at most 8 cameras (R12a)', () => {
    const scene = makeSmokeScene();
    const camera = scene.entities.find(e => e.id === 'camera_close')!;
    for (let i = 0; scene.entities.filter(e => e.kind === 'camera').length < LIMITS.cameras; i++) scene.entities.push({ ...structuredClone(camera), id: `extra_${i}` });
    expect(SceneViewSchema.safeParse(scene).success).toBe(true);
    scene.entities.push({ ...structuredClone(camera), id: 'ninth' });
    expect(SceneViewSchema.safeParse(scene).success).toBe(false);
});
it('validates setCameraNavigation and cameraScreenshot (R3, R14)', () => {
    expect(PatchOpSchema.safeParse({ kind: 'setCameraNavigation', entityId: 'camera_wide', navigation: orbit }).success).toBe(true);
    expect(validateCall('cameraScreenshot', { cameraId: 'camera_wide', expectedRevision: 0 }).ok).toBe(true);
    expect(validateCall('cameraScreenshot', { cameraId: 'camera_wide', expectedRevision: 0, path: '/tmp/x.png' }).ok).toBe(false);
    expect(requiredCapability('cameraScreenshot')).toBe('edit');
    const result = { fileName: '20261017-120000-000-camera_wide.png', width: 1920, height: 1080, bytes: 1, sha256: 'a'.repeat(64), cameraId: 'camera_wide', revision: 0 };
    expect(ResultSchemas.cameraScreenshot.safeParse(result).success).toBe(true);
    for (const fileName of ['/tmp/a.png', '20261017-120000-000-.png', '20261017-120000-000-cam.jpg', '20261017-120000-000-a/b.png'])
        expect(ResultSchemas.cameraScreenshot.safeParse({ ...result, fileName }).success).toBe(false);
});
