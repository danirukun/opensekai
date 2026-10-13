import type { Id, Reply, SceneEntity, Vec3 } from './types';

export type PropertyType = 'number' | 'boolean' | 'vector3';
export type PropertyValue = number | boolean | Vec3;
export type PropertyRule = { kind: 'finite' } | { kind: 'positive' } | { kind: 'range'; min: number; max: number } | { kind: 'boolean' };
export const PROPERTY_KEYS = ['position', 'rotation', 'scale', 'visible', 'fovDegrees'] as const;
export type PropertyKey = (typeof PROPERTY_KEYS)[number];
type Kind = SceneEntity['kind'];
export interface AssetProperty { key: PropertyKey; label: string; kinds: readonly Kind[]; type: PropertyType; rule: PropertyRule }

const placed: readonly Kind[] = ['mesh', 'avatar', 'camera'];
export const PROPERTY_REGISTRY: readonly AssetProperty[] = [
 { key: 'position', label: 'Position', kinds: placed, type: 'vector3', rule: { kind: 'finite' } },
 { key: 'rotation', label: 'Rotation', kinds: placed, type: 'vector3', rule: { kind: 'finite' } },
 { key: 'scale', label: 'Scale', kinds: placed, type: 'vector3', rule: { kind: 'positive' } },
 { key: 'visible', label: 'Visible', kinds: placed, type: 'boolean', rule: { kind: 'boolean' } },
 { key: 'fovDegrees', label: 'Field of View', kinds: ['camera'], type: 'number', rule: { kind: 'range', min: 1, max: 179 } },
];
export const assetProperty = (key: PropertyKey): AssetProperty => PROPERTY_REGISTRY.find(property => property.key === key)!;
export const propertiesFor = (kind: Kind): AssetProperty[] => PROPERTY_REGISTRY.filter(property => property.kinds.includes(kind));
export const blueprintPropertyCatalog = () => PROPERTY_REGISTRY.map(property => ({ ...property, kinds: [...property.kinds] }));

const RAD = Math.PI / 180;
const clean = (value: number) => (Object.is(value, -0) ? 0 : value);
// Euler degrees [x, y, z] in YXZ order, as three.js applies them.
export function quaternionFromEuler([x, y, z]: Vec3): [number, number, number, number] {
 const c1 = Math.cos(x * RAD / 2), c2 = Math.cos(y * RAD / 2), c3 = Math.cos(z * RAD / 2);
 const s1 = Math.sin(x * RAD / 2), s2 = Math.sin(y * RAD / 2), s3 = Math.sin(z * RAD / 2);
 return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}
export function eulerFromQuaternion([qx = 0, qy = 0, qz = 0, qw = 1]: readonly number[]): Vec3 {
 const m11 = 1 - 2 * (qy * qy + qz * qz), m13 = 2 * (qx * qz + qy * qw);
 const m21 = 2 * (qx * qy + qz * qw), m22 = 1 - 2 * (qx * qx + qz * qz), m23 = 2 * (qy * qz - qx * qw);
 const m31 = 2 * (qx * qz - qy * qw), m33 = 1 - 2 * (qx * qx + qy * qy);
 const x = Math.asin(-Math.min(Math.max(m23, -1), 1));
 const [y, z] = Math.abs(m23) < 0.9999999 ? [Math.atan2(m13, m33), Math.atan2(m21, m22)] : [Math.atan2(-m31, m11), 0];
 return [clean(x / RAD), clean(y / RAD), clean(z / RAD)];
}
export function rotateByQuaternion([vx, vy, vz]: Vec3, [qx = 0, qy = 0, qz = 0, qw = 1]: readonly number[]): Vec3 {
 const tx = 2 * (qy * vz - qz * vy), ty = 2 * (qz * vx - qx * vz), tz = 2 * (qx * vy - qy * vx);
 return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n));
export function propertyValueValid(key: PropertyKey, value: unknown): value is PropertyValue {
 const { type, rule } = assetProperty(key);
 if (type === 'boolean') return typeof value === 'boolean';
 if (type === 'vector3') return isVec3(value) && (rule.kind !== 'positive' || value.every(n => n > 0));
 return typeof value === 'number' && Number.isFinite(value) && (rule.kind !== 'range' || (value >= rule.min && value <= rule.max));
}
export function readProperty(entity: SceneEntity, key: PropertyKey): PropertyValue | undefined {
 if (!assetProperty(key).kinds.includes(entity.kind)) return undefined;
 switch (key) {
  case 'position': return [...entity.transform.position] as Vec3;
  case 'rotation': return eulerFromQuaternion(entity.transform.rotation);
  case 'scale': return [...entity.transform.scale] as Vec3;
  case 'visible': return entity.visible;
  case 'fovDegrees': return entity.kind === 'camera' ? entity.lens.fovDegrees : undefined;
 }
}
const fail = (message: string, ids: Id[]): Reply<never> => ({ ok: false, error: { code: 'INVALID_INPUT', message, ids } });
export function writeProperty(entity: SceneEntity, key: PropertyKey, value: PropertyValue): Reply<SceneEntity> {
 if (!assetProperty(key).kinds.includes(entity.kind)) return fail('Property does not apply to this entity', [entity.id]);
 if (!propertyValueValid(key, value)) return fail('Invalid property value', [entity.id]);
 const next = structuredClone(entity);
 switch (key) {
  case 'position': next.transform.position = [...(value as Vec3)]; break;
  case 'rotation': next.transform.rotation = quaternionFromEuler(value as Vec3); break;
  case 'scale': next.transform.scale = [...(value as Vec3)]; break;
  case 'visible': next.visible = value as boolean; break;
  case 'fovDegrees': if (next.kind === 'camera') next.lens = { ...next.lens, fovDegrees: value as number }; break;
 }
 return { ok: true, data: next };
}
