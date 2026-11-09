import { eulerFromQuaternion, quaternionFromEuler, type Quat, type SceneEntity, type Vec3 } from '@opensekai/contracts';
import type { Framing } from './intents';
import { WORDS } from './words';

const DEG = 180 / Math.PI;
const EPS = 1e-9;

// Cameras (three.js) and spot lights (renderer `lightDirection`) look along local −Z. The result has +Y up and no roll.
export const lookAt = (from: Vec3, to: Vec3): Quat => {
 const [dx, dy, dz] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
 const flat = Math.hypot(dx, dz);
 if (flat < EPS && Math.abs(dy) < EPS) return [0, 0, 0, 1];
 const yaw = flat < EPS ? 0 : Math.atan2(-dx, -dz) * DEG;
 return quaternionFromEuler([Math.atan2(dy, flat) * DEG, yaw, 0]).map(v => v + 0) as Quat;
};

// Euler degrees [x, y, z] in YXZ order, as `property.set` rotation takes them.
export const eulerDegrees = (q: Quat): Vec3 => eulerFromQuaternion(q);

export const targetPoint = (entity: SceneEntity, framing: Framing = 'medium'): Vec3 => {
 const [x, y, z] = entity.transform.position;
 return entity.kind === 'avatar' ? [x, y + WORDS.framing[framing].aimHeight * entity.transform.scale[1], z] : [x, y, z];
};
