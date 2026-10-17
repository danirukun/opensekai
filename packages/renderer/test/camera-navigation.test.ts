import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import type { Transform, Vec3 } from '@opensekai/contracts';
import { NAVIGATION, anglesOf, forwardOf, freeLookFromTransform, freeLookStep, freeLookTurn, orbitDrag, orbitFromTransform, orbitPan, orbitPivot, orbitZoom, rotationOf, transformFromFreeLook, transformFromOrbit } from '../src/camera-navigation';

const deg = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, digits));
const still = { forward: 0, right: 0, up: 0, fast: false, sensitivity: 1 };

describe('rotation', () => {
    it('matches three.js: the forward axis of rotationOf is forwardOf', () => {
        for (const [yaw, pitch] of [[0, 0], [30 * deg, 10 * deg], [-120 * deg, -60 * deg], [170 * deg, 89 * deg]] as const) {
            const q = new Quaternion(...rotationOf(yaw, pitch));
            close(new Vector3(0, 0, -1).applyQuaternion(q).toArray(), forwardOf(yaw, pitch));
            expect(Math.hypot(...rotationOf(yaw, pitch))).toBeCloseTo(1, 12);
            const angles = anglesOf(rotationOf(yaw, pitch));
            close([angles.yaw, angles.pitch], [yaw, pitch]);
        }
    });
    it('looks down -Z with the identity rotation', () => {
        close(forwardOf(0, 0), [0, 0, -1]);
        const { yaw, pitch } = anglesOf([0, 0, 0, 1]);
        close([yaw, pitch], [0, 0]);
    });
});

describe('Free Look', () => {
    const start = freeLookFromTransform({ position: [0, 1.2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    it('turns 0.2 degrees for each pixel times the sensitivity and clamps pitch at 89 degrees', () => {
        const turned = freeLookTurn(start, 10, -5, 2);
        expect(turned.yaw).toBeCloseTo(-4 * deg);
        expect(turned.pitch).toBeCloseTo(2 * deg);
        expect(freeLookTurn(start, 0, -10_000, 1).pitch).toBeCloseTo(89 * deg);
        expect(freeLookTurn(start, 0, 10_000, 1).pitch).toBeCloseTo(-89 * deg);
    });
    it('moves 2 m/s times the sensitivity, and Shift multiplies by 3', () => {
        close(freeLookStep(start, { ...still, forward: 1 }, 0.5).position, [0, 1.2, 2]);
        close(freeLookStep(start, { ...still, right: 1, sensitivity: 2 }, 0.5).position, [2, 1.2, 3]);
        close(freeLookStep(start, { ...still, up: -1, fast: true }, 0.5).position, [0, -1.8, 3]);
        close(freeLookStep(start, still, 1).position, start.position);
    });
    it('moves E and Q along world up even when the camera looks down', () => {
        const down = { ...start, pitch: -60 * deg };
        close(freeLookStep(down, { ...still, up: 1 }, 1).position, [0, 3.2, 3]);
    });
    it('keeps scale and has no roll', () => {
        const transform = transformFromFreeLook(freeLookTurn(start, 100, 50, 1), [2, 2, 2]);
        expect(transform.scale).toEqual([2, 2, 2]);
        const right = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...transform.rotation));
        expect(right.y).toBeCloseTo(0, 12);
    });
});

describe('Orbit Character', () => {
    const pivot: Vec3 = [0, 1.3, 0];
    const transform: Transform = { position: [0, 1.3, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    it('places the pivot on the target root plus the offset, or on the offset alone', () => {
        expect(orbitPivot([1, 0, 2], [0, 1.3, 0])).toEqual([1, 1.3, 2]);
        expect(orbitPivot(null, [0, 1.3, 0])).toEqual([0, 1.3, 0]);
    });
    it('round-trips a transform that looks at the pivot', () => {
        const state = orbitFromTransform(transform, pivot);
        expect(state.distance).toBeCloseTo(3);
        const back = transformFromOrbit(state, transform.scale);
        close(back.position, transform.position);
        close(back.rotation, transform.rotation);
    });
    it('rotates at a constant distance and always looks at the pivot', () => {
        const state = orbitDrag(orbitFromTransform(transform, pivot), 300, 100, 1);
        expect(state.yaw).toBeCloseTo(-90 * deg);
        expect(state.pitch).toBeCloseTo(-30 * deg);
        const moved = transformFromOrbit(state, [1, 1, 1]);
        const offset = moved.position.map((value, i) => value - pivot[i]!);
        expect(Math.hypot(...offset)).toBeCloseTo(3);
        const forward = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...moved.rotation));
        close(forward.toArray(), offset.map(value => -value / 3));
        expect(orbitDrag(state, 0, 100_000, 1).pitch).toBeCloseTo(-89 * deg);
    });
    it('zooms by 1.1 for each wheel step within 0.2 to 50 m', () => {
        const state = orbitFromTransform(transform, pivot);
        expect(orbitZoom(state, 1).distance).toBeCloseTo(3.3);
        expect(orbitZoom(state, -2).distance).toBeCloseTo(3 / 1.21);
        expect(orbitZoom(state, -100).distance).toBe(NAVIGATION.minDistance);
        expect(orbitZoom(state, 100).distance).toBe(NAVIGATION.maxDistance);
        expect(orbitFromTransform({ ...transform, position: [0, 1.3, 500] }, pivot).distance).toBe(NAVIGATION.maxDistance);
    });
    it('pans the camera and the pivot by the same delta in the view plane', () => {
        const state = orbitFromTransform(transform, pivot);
        // 90 degree FOV: the view is 2 * distance high, so 540 px is one distance.
        const { state: panned, delta } = orbitPan(state, 540, 540, 1080, 90);
        close(delta, [-3, 3, 0]);
        close(panned.pivot, [-3, 4.3, 0]);
        const before = transformFromOrbit(state, [1, 1, 1]), after = transformFromOrbit(panned, [1, 1, 1]);
        close(after.position, before.position.map((value, i) => value + delta[i]!));
        close(after.rotation, before.rotation);
        expect(orbitPan(state, 5, 5, 0, 45).delta).toEqual([0, 0, 0]);
    });
    it('starts from the camera rotation when the camera is on the pivot', () => {
        const state = orbitFromTransform({ ...transform, position: [...pivot] }, pivot);
        expect(state.distance).toBe(NAVIGATION.minDistance);
        expect(state.yaw).toBeCloseTo(0);
    });
});
