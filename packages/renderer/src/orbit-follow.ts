import type { Id, SceneView, Transform, Vec3 } from '@opensekai/contracts';

// An Orbit Character gesture with a target works in persistent coordinates around the persistent target position
// `base`. The session adds the follow offset of the target to the camera (R6a), so the editor draws the draft with it.
export interface Follow { cameraId: Id; targetId: Id; base: Vec3 }
const EPSILON = 1e-6;
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const near = (a: readonly number[], b: readonly number[]) => a.every((value, i) => Math.abs(value - b[i]!) <= EPSILON);

export function followOffset(evaluated: SceneView | null, follow: Follow): Vec3 {
    const target = evaluated?.entities.find(entity => entity.id === follow.targetId);
    return target ? sub(target.transform.position, follow.base) : [0, 0, 0];
}
export const shiftTransform = (transform: Transform, offset: Vec3): Transform => ({ ...transform, position: add(transform.position, offset) });
// The target move of a scene change that moved only the target and the camera together, as the Blueprint idle commit
// does. Any other change to the camera returns null, and the other edit wins (R8).
export function followShift(persistent: SceneView, follow: Follow, committed: Transform): Vec3 | null {
    const camera = persistent.entities.find(entity => entity.id === follow.cameraId);
    const target = persistent.entities.find(entity => entity.id === follow.targetId);
    if (camera?.kind !== 'camera' || camera.navigation?.mode !== 'orbitCharacter' || camera.navigation.targetId !== follow.targetId || !target) return null;
    const moved = sub(target.transform.position, follow.base);
    if (Math.hypot(...moved) <= EPSILON) return null;
    const { position, rotation, scale } = camera.transform;
    return near(position, add(committed.position, moved)) && near(rotation, committed.rotation) && near(scale, committed.scale) ? moved : null;
}
