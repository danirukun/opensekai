import { expect, it } from 'vitest';
import { DEFAULT_AVATAR_LIGHTING, eulerFromQuaternion, focalLengthMmFromVerticalFov, makeSmokeScene, propertiesFor, quaternionFromEuler, readProperty, rotateByQuaternion, writeProperty, type SceneEntity } from '../src';

const entity = (id: string): SceneEntity => makeSmokeScene().entities.find(e => e.id === id)!;
const close = (actual: readonly number[], expected: readonly number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));

it('lists the properties of each entity kind', () => {
 expect(propertiesFor('camera').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible', 'fovDegrees', 'focalLengthMm', 'fStop', 'focusDistance', 'autofocus', 'sensorPreset', 'renderEnvironment']);
 expect(propertiesFor('environment').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('avatar').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible', 'rimStrength']);
 expect(propertiesFor('mesh').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('screen').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('tracking')).toEqual([]);
});

it('converts YXZ Euler degrees to a quaternion and back', () => {
 close(quaternionFromEuler([0, 90, 0]), [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
 close(eulerFromQuaternion(quaternionFromEuler([10, 45, -30])), [10, 45, -30]);
 close(eulerFromQuaternion(quaternionFromEuler([0, 270, 0])), [0, -90, 0]);
 expect(eulerFromQuaternion([0, 0, 0, 1])).toEqual([0, 0, 0]);
});

it('rotates a vector by a quaternion', () => {
 close(rotateByQuaternion([0, 0, 1], quaternionFromEuler([0, 90, 0])), [1, 0, 0]);
 close(rotateByQuaternion([1, 2, 3], [0, 0, 0, 1]), [1, 2, 3]);
});

it('reads and writes properties of an entity', () => {
 expect(readProperty(entity('reference'), 'position')).toEqual([0.9, 0.7, 0]);
 expect(readProperty(entity('camera_wide'), 'fovDegrees')).toBe(45);
 expect(readProperty(entity('performer'), 'fovDegrees')).toBeUndefined();
 const moved = writeProperty(entity('reference'), 'position', [1, 2, 3]);
 expect(moved.ok && moved.data.transform.position).toEqual([1, 2, 3]);
 const turned = writeProperty(entity('reference'), 'rotation', [0, 90, 0]);
 expect(turned.ok).toBe(true);
 if (turned.ok) close(turned.data.transform.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
 const zoom = writeProperty(entity('camera_wide'), 'fovDegrees', 30);
 const zoomLens = zoom.ok && zoom.data.kind === 'camera' ? zoom.data.lens : undefined;
 expect(zoomLens).toMatchObject({ fStop: 4, focusDistance: 3, autofocus: false, sensorPreset: 'fullFrame', near: 0.01, far: 100 });
 expect(zoomLens?.fovDegrees).toBeCloseTo(30, 9);
 expect(zoomLens?.focalLengthMm).toBeCloseTo(focalLengthMmFromVerticalFov(30, 24), 9);
});

it('converts fovDegrees and focalLengthMm writes through the physical lens so the other field stays in sync', () => {
 const camera = entity('camera_wide'); // Full Frame (heightMm 24) after the fixture's legacy lens migrates.
 const byFov = writeProperty(camera, 'fovDegrees', 40);
 expect(byFov.ok && byFov.data.kind === 'camera' && byFov.data.lens.focalLengthMm).toBeCloseTo(focalLengthMmFromVerticalFov(40, 24), 9);
 expect(byFov.ok && byFov.data.kind === 'camera' && byFov.data.lens.fovDegrees).toBeCloseTo(40, 9);
 const byFocal = writeProperty(camera, 'focalLengthMm', 85);
 const byFocalLens = byFocal.ok && byFocal.data.kind === 'camera' ? byFocal.data.lens : undefined;
 expect(byFocalLens?.focalLengthMm).toBe(85);
 expect(byFocalLens?.fovDegrees).toBeCloseTo(readProperty(byFocal.ok ? byFocal.data : camera, 'fovDegrees') as number, 9);
 expect(writeProperty(camera, 'focalLengthMm', 500).ok).toBe(false);
 expect(writeProperty(camera, 'fStop', 0.5).ok).toBe(false);
 expect(writeProperty(camera, 'sensorPreset', 'notAPreset' as never).ok).toBe(false);
 const sensor = writeProperty(camera, 'sensorPreset', 'super35');
 expect(sensor.ok && sensor.data.kind === 'camera' && sensor.data.lens.sensorPreset).toBe('super35');
 expect(sensor.ok && sensor.data.kind === 'camera' && sensor.data.lens.focalLengthMm).toBe(camera.kind === 'camera' ? camera.lens.focalLengthMm : NaN);
});

it('rejects invalid values and properties that do not apply', () => {
 expect(writeProperty(entity('reference'), 'scale', [1, 0, 1])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid property value' } });
 expect(writeProperty(entity('camera_wide'), 'fovDegrees', 180).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'position', [Number.NaN, 0, 0]).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'visible', 1 as never).ok).toBe(false);
 expect(writeProperty(entity('performer'), 'fovDegrees', 30)).toMatchObject({ ok: false, error: { message: 'Property does not apply to this entity' } });
});

it('reads and writes the environment and the camera Render Environment', () => {
 const stage: SceneEntity = { id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId: null };
 const hidden = writeProperty(stage, 'visible', false);
 expect(hidden.ok && hidden.data).toMatchObject({ kind: 'environment', visible: false, assetId: null });
 expect(readProperty(stage, 'renderEnvironment')).toBeUndefined();
 expect(writeProperty(stage, 'renderEnvironment', false)).toMatchObject({ ok: false, error: { message: 'Property does not apply to this entity' } });
 const camera = entity('camera_wide');
 expect(camera.kind === 'camera' && camera.renderEnvironment).toBeUndefined();
 expect(readProperty(camera, 'renderEnvironment')).toBe(true);
 const off = writeProperty(camera, 'renderEnvironment', false);
 expect(off.ok && off.data.kind === 'camera' && off.data.renderEnvironment).toBe(false);
 expect(off.ok && readProperty(off.data, 'renderEnvironment')).toBe(false);
 expect(writeProperty(camera, 'renderEnvironment', 0 as never).ok).toBe(false);
 const same = writeProperty(camera, 'renderEnvironment', true);
 expect(same.ok && same.data).toEqual(camera);
 const back = off.ok && writeProperty(off.data, 'renderEnvironment', true);
 expect(back && back.ok && back.data.kind === 'camera' && back.data.renderEnvironment).toBe(true);
});

it('reads and writes the placed properties of a screen (B28 R10)', () => {
 const screen: SceneEntity = { id: 'logo', name: 'Logo', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'screen', content: { kind: 'image', assetId: 'image_a' } };
 const moved = writeProperty(screen, 'position', [1, 2, 3]);
 expect(moved.ok && moved.data.transform.position).toEqual([1, 2, 3]);
 const scaled = writeProperty(screen, 'scale', [2, 1, 1]);
 expect(scaled.ok && scaled.data.transform.scale).toEqual([2, 1, 1]);
 const turned = writeProperty(screen, 'rotation', [0, 90, 0]);
 expect(turned.ok).toBe(true);
 if (turned.ok) close(turned.data.transform.rotation, [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
 const hidden = writeProperty(screen, 'visible', false);
 expect(hidden.ok && hidden.data.visible).toBe(false);
 expect(readProperty(screen, 'fovDegrees')).toBeUndefined();
 expect(writeProperty(screen, 'intensity', 1).ok).toBe(false);
});

it('reads the default Rim Strength of an avatar without lighting and writes the full group', () => {
 const performer = entity('performer');
 expect(readProperty(performer, 'rimStrength')).toBe(DEFAULT_AVATAR_LIGHTING.rimStrength);
 expect(readProperty(entity('camera_wide'), 'rimStrength')).toBeUndefined();
 const written = writeProperty(performer, 'rimStrength', 1.5);
 expect(written.ok && written.data.kind === 'avatar' && written.data.lighting).toEqual({ ...DEFAULT_AVATAR_LIGHTING, rimStrength: 1.5 });
 const lit = { ...performer, lighting: { ...DEFAULT_AVATAR_LIGHTING, rimTint: '#ff0000', rimStrength: 0.5 } } as SceneEntity;
 expect(readProperty(lit, 'rimStrength')).toBe(0.5);
 const next = writeProperty(lit, 'rimStrength', 2);
 expect(next.ok && next.data.kind === 'avatar' && next.data.lighting).toEqual({ ...DEFAULT_AVATAR_LIGHTING, rimTint: '#ff0000', rimStrength: 2 });
 const same = writeProperty(performer, 'rimStrength', DEFAULT_AVATAR_LIGHTING.rimStrength);
 expect(same.ok && same.data).toEqual(performer);
 expect(writeProperty(performer, 'rimStrength', 2.1).ok).toBe(false);
 expect(writeProperty(performer, 'rimStrength', -0.1).ok).toBe(false);
 expect(writeProperty(entity('camera_wide'), 'rimStrength', 1)).toMatchObject({ ok: false, error: { message: 'Property does not apply to this entity' } });
});
