import { CAMERA_ORBIT, anglesOf, clampPitch, forwardOf, rotationOf, type OrbitState, type Transform, type Vec3 } from '@opensekai/contracts';

// Camera navigation math for the viewport (Warudo Control Modes). The orbit math is in the contracts package, so the
// session uses the same functions (B32 R4).
export { anglesOf, forwardOf, orbitFromTransform, orbitPivot, rotationOf, transformFromOrbit, type OrbitState } from '@opensekai/contracts';
export interface FreeLookState { position: Vec3; yaw: number; pitch: number }
export interface FreeLookInput { forward: number; right: number; up: number; fast: boolean; sensitivity: number }

export const NAVIGATION = {
    ...CAMERA_ORBIT,
    freeLookSpeed: 2,
    fastFactor: 3,
    freeLookTurn: 0.2 * Math.PI / 180,
    orbitTurn: 0.3 * Math.PI / 180,
    zoomStep: 1.1,
    defaultPivotOffset: [0, 1.3, 0] as Vec3,
} as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export function rightOf(yaw: number): Vec3 { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
export function upOf(yaw: number, pitch: number): Vec3 {
    return [Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
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
