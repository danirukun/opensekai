import { expect, it } from 'vitest';
import { eulerFromQuaternion, makeSmokeScene, propertiesFor, quaternionFromEuler, readProperty, rotateByQuaternion, writeProperty, type SceneEntity } from '../src';

const entity = (id: string): SceneEntity => makeSmokeScene().entities.find(e => e.id === id)!;
const close = (actual: readonly number[], expected: readonly number[]) => actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 6));

it('lists the properties of each entity kind', () => {
 expect(propertiesFor('camera').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible', 'fovDegrees']);
 expect(propertiesFor('avatar').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
 expect(propertiesFor('mesh').map(p => p.key)).toEqual(['position', 'rotation', 'scale', 'visible']);
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
 expect(zoom.ok && zoom.data.kind === 'camera' && zoom.data.lens).toEqual({ fovDegrees: 30, near: 0.01, far: 100 });
});

it('rejects invalid values and properties that do not apply', () => {
 expect(writeProperty(entity('reference'), 'scale', [1, 0, 1])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid property value' } });
 expect(writeProperty(entity('camera_wide'), 'fovDegrees', 180).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'position', [Number.NaN, 0, 0]).ok).toBe(false);
 expect(writeProperty(entity('reference'), 'visible', 1 as never).ok).toBe(false);
 expect(writeProperty(entity('performer'), 'fovDegrees', 30)).toMatchObject({ ok: false, error: { message: 'Property does not apply to this entity' } });
});
