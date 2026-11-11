import { describe, expect, it } from 'vitest';
import { CAMERA_ORBIT, clampUser, orbitFromTransform, orbitFromUser, shortYaw, transformFromOrbit, userFromOrbit, type Vec3 } from '../src';

const pivot: Vec3 = [1, 1.3, -2];
const near = (a: readonly number[], b: readonly number[]) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 9));
const at = (yawDegrees: number, pitchDegrees: number, distance = 2.5) => transformFromOrbit(orbitFromUser({ yawDegrees, pitchDegrees, distance }, pivot), [1, 1, 1]);

describe('camera orbit user values (B32 R2)', () => {
 it('round-trips through the camera transform', () => {
  for (const yaw of [0, 90, 180, -90]) for (const pitch of [-60, 0, 60]) {
   const user = userFromOrbit(orbitFromTransform(at(yaw, pitch), pivot));
   expect(user.pitchDegrees).toBeCloseTo(pitch, 9);
   expect(user.distance).toBeCloseTo(2.5, 9);
   expect(shortYaw(yaw, user.yawDegrees)).toBeCloseTo(yaw, 9);
  }
 });
 it('puts Yaw 0 and Pitch 0 on the +Z side of the pivot, looking toward -Z', () => {
  const transform = at(0, 0, 3);
  near(transform.position, [pivot[0], pivot[1], pivot[2] + 3]);
  near(transform.rotation, [0, 0, 0, 1]);
 });
 it('turns Yaw 90 counter-clockwise from above, to the +X side', () => {
  near(at(90, 0, 2).position, [pivot[0] + 2, pivot[1], pivot[2]]);
 });
 it('puts a positive Pitch above the pivot', () => {
  const { position } = at(0, 30, 2);
  expect(position[1]).toBeCloseTo(pivot[1] + 1, 9);
  expect(position[2]).toBeCloseTo(pivot[2] + Math.sqrt(3), 9);
 });
 it('clamps Pitch to 89 degrees and Distance to the navigation limits', () => {
  expect(clampUser({ yawDegrees: 720, pitchDegrees: 120, distance: 100 })).toEqual({ yawDegrees: 720, pitchDegrees: 89, distance: CAMERA_ORBIT.maxDistance });
  expect(clampUser({ yawDegrees: 0, pitchDegrees: -95, distance: 0 })).toEqual({ yawDegrees: 0, pitchDegrees: -89, distance: CAMERA_ORBIT.minDistance });
  expect(userFromOrbit(orbitFromUser({ yawDegrees: 0, pitchDegrees: 90, distance: 0.01 }, pivot)).pitchDegrees).toBeCloseTo(89, 9);
 });
 it('takes the short way for Yaw', () => {
  expect(shortYaw(350, 10)).toBe(370);
  expect(shortYaw(10, 350)).toBe(-10);
  expect(shortYaw(0, 180)).toBe(180);
  expect(shortYaw(0, 90)).toBe(90);
  expect(shortYaw(720, 10)).toBe(730);
 });
});
