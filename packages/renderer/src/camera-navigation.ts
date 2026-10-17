import type { Transform, Vec3 } from '@opensekai/contracts';

// Pure camera navigation math (Warudo Control Modes). Angles are radians. Yaw turns around world up,
// pitch around the camera right axis; a camera looks down its local -Z axis. There is no roll.
export interface FreeLookState { position: Vec3; yaw: number; pitch: number }
export interface OrbitState { pivot: Vec3; distance: number; yaw: number; pitch: number }
export interface FreeLookInput { forward: number; right: number; up: number; fast: boolean; sensitivity: number }

export const NAVIGATION = {
    pitchLimit: 89 * Math.PI / 180,
    freeLookSpeed: 2,
    fastFactor: 3,
    freeLookTurn: 0.2 * Math.PI / 180,
    orbitTurn: 0.3 * Math.PI / 180,
    zoomStep: 1.1,
    minDistance: 0.2,
    maxDistance: 50,
    defaultPivotOffset: [0, 1.3, 0] as Vec3,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampPitch = (pitch: number) => clamp(pitch, -NAVIGATION.pitchLimit, NAVIGATION.pitchLimit);
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export function forwardOf(yaw: number, pitch: number): Vec3 {
    return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}
export function rightOf(yaw: number): Vec3 { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
export function upOf(yaw: number, pitch: number): Vec3 {
    return [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
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

export function freeLookFromTransform(transform: Transform): FreeLookState {
    return { position: [...transform.position], ...anglesOf(transform.rotation) };
}
export function freeLookTurn(state: FreeLookState, dx: number, dy: number, sensitivity: number): FreeLookState {
    const k = NAVIGATION.freeLookTurn * sensitivity;
    return { ...state, yaw: state.yaw - dx * k, pitch: clampPitch(state.pitch - dy * k) };
}
export function freeLookStep(state: FreeLookState, input: FreeLookInput, dtSeconds: number): FreeLookState {
    const distance = NAVIGATION.freeLookSpeed * input.sensitivity * (input.fast ? NAVIGATION.fastFactor : 1) * Math.max(0, dtSeconds);
    let position = add(state.position, forwardOf(state.yaw, state.pitch), clamp(input.forward, -1, 1) * distance);
    position = add(position, rightOf(state.yaw), clamp(input.right, -1, 1) * distance);
    position = add(position, [0, 1, 0], clamp(input.up, -1, 1) * distance);
    return { ...state, position };
}
export function transformFromFreeLook(state: FreeLookState, scale: Vec3): Transform {
    return { position: [...state.position], rotation: rotationOf(state.yaw, state.pitch), scale: [...scale] };
}

export function orbitPivot(targetPosition: Vec3 | null, pivotOffset: Vec3): Vec3 {
    return targetPosition ? add(targetPosition, pivotOffset) : [...pivotOffset];
}
export function orbitFromTransform(transform: Transform, pivot: Vec3): OrbitState {
    const offset: Vec3 = [transform.position[0] - pivot[0], transform.position[1] - pivot[1], transform.position[2] - pivot[2]];
    const length = Math.hypot(...offset);
    if (length < 1e-6) {
        const angles = anglesOf(transform.rotation);
        return { pivot: [...pivot], distance: NAVIGATION.minDistance, ...angles };
    }
    // The camera looks at the pivot, so its forward axis is the negative offset.
    return { pivot: [...pivot], distance: clamp(length, NAVIGATION.minDistance, NAVIGATION.maxDistance), yaw: Math.atan2(offset[0], offset[2]), pitch: clampPitch(Math.asin(clamp(-offset[1] / length, -1, 1))) };
}
export function orbitDrag(state: OrbitState, dx: number, dy: number, sensitivity: number): OrbitState {
    const k = NAVIGATION.orbitTurn * sensitivity;
    return { ...state, yaw: state.yaw - dx * k, pitch: clampPitch(state.pitch - dy * k) };
}
export function orbitZoom(state: OrbitState, steps: number): OrbitState {
    return { ...state, distance: clamp(state.distance * NAVIGATION.zoomStep ** steps, NAVIGATION.minDistance, NAVIGATION.maxDistance) };
}
// A pan moves the pivot in the view plane, so the point under the pointer follows it. `delta` is the pivot change.
export function orbitPan(state: OrbitState, dx: number, dy: number, viewHeight: number, fovDegrees: number): { state: OrbitState; delta: Vec3 } {
    if (!(viewHeight > 0)) return { state, delta: [0, 0, 0] };
    const perPixel = 2 * state.distance * Math.tan(fovDegrees * Math.PI / 360) / viewHeight;
    const delta = add(add([0, 0, 0], rightOf(state.yaw), -dx * perPixel), upOf(state.yaw, state.pitch), dy * perPixel);
    return { state: { ...state, pivot: add(state.pivot, delta) }, delta };
}
export function transformFromOrbit(state: OrbitState, scale: Vec3): Transform {
    return { position: add(state.pivot, forwardOf(state.yaw, state.pitch), -state.distance), rotation: rotationOf(state.yaw, state.pitch), scale: [...scale] };
}
