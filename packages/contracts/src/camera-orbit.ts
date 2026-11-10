import type { Transform, Vec3 } from './types';

// Pure orbit camera math, shared by the viewport (renderer) and the Camera Orbit Character node (session).
// Internal angles are radians. Yaw turns around world up, pitch around the camera right axis; a camera looks down its
// local -Z axis. There is no roll. A positive internal pitch looks up.
export interface OrbitState { pivot: Vec3; distance: number; yaw: number; pitch: number }
// The node values (B32 R2): Yaw 0 puts the camera on the +Z side of the pivot; a positive Pitch puts it above the pivot.
export interface OrbitUser { yawDegrees: number; pitchDegrees: number; distance: number }

export const CAMERA_ORBIT = {
 pitchLimit: 89 * Math.PI / 180,
 minDistance: 0.2,
 maxDistance: 50,
} as const;

const DEGREES = 180 / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const clampPitch = (pitch: number) => clamp(pitch, -CAMERA_ORBIT.pitchLimit, CAMERA_ORBIT.pitchLimit);
const PITCH_LIMIT_DEGREES = 89;
const clampDistance = (distance: number) => clamp(distance, CAMERA_ORBIT.minDistance, CAMERA_ORBIT.maxDistance);
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export function forwardOf(yaw: number, pitch: number): Vec3 {
 return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}
// q = yaw(Y) * pitch(X), as [x, y, z, w].
export function rotationOf(yaw: number, pitch: number): Transform['rotation'] {
 const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
 return [cy * sp, sy * cp, -sy * sp, cy * cp];
}
export function anglesOf(rotation: Transform['rotation']): { yaw: number; pitch: number } {
 const [x, y, z, w] = rotation;
 // The camera forward axis: the quaternion applied to (0, 0, -1).
 const fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y));
 return { yaw: Math.atan2(-fx, -fz), pitch: clampPitch(Math.asin(clamp(fy, -1, 1))) };
}

export function orbitPivot(targetPosition: Vec3 | null, pivotOffset: Vec3): Vec3 {
 return targetPosition ? add(targetPosition, pivotOffset) : [...pivotOffset];
}
export function orbitFromTransform(transform: Transform, pivot: Vec3): OrbitState {
 const offset: Vec3 = [transform.position[0] - pivot[0], transform.position[1] - pivot[1], transform.position[2] - pivot[2]];
 const length = Math.hypot(...offset);
 if (length < 1e-6) {
  const angles = anglesOf(transform.rotation);
  return { pivot: [...pivot], distance: CAMERA_ORBIT.minDistance, ...angles };
 }
 // The camera looks at the pivot, so its forward axis is the negative offset.
 return { pivot: [...pivot], distance: clampDistance(length), yaw: Math.atan2(offset[0], offset[2]), pitch: clampPitch(Math.asin(clamp(-offset[1] / length, -1, 1))) };
}
export function transformFromOrbit(state: OrbitState, scale: Vec3): Transform {
 return { position: add(state.pivot, forwardOf(state.yaw, state.pitch), -state.distance), rotation: rotationOf(state.yaw, state.pitch), scale: [...scale] };
}

// User values to the internal state: the limits apply, and the internal pitch has the opposite sign.
export const orbitFromUser = (user: OrbitUser, pivot: Vec3): OrbitState =>
 ({ pivot: [...pivot], distance: clampDistance(user.distance), yaw: user.yawDegrees / DEGREES, pitch: clampPitch(-user.pitchDegrees / DEGREES) });
export const userFromOrbit = (state: OrbitState): OrbitUser =>
 ({ yawDegrees: state.yaw * DEGREES, pitchDegrees: -state.pitch * DEGREES, distance: state.distance });
export const clampUser = (user: OrbitUser): OrbitUser =>
 ({ yawDegrees: user.yawDegrees, pitchDegrees: clamp(user.pitchDegrees, -PITCH_LIMIT_DEGREES, PITCH_LIMIT_DEGREES), distance: clampDistance(user.distance) });
// The Yaw target that is at most 180° from `from`, so a move goes the short way.
export const shortYaw = (from: number, to: number): number => to + 360 * Math.round((from - to) / 360);
