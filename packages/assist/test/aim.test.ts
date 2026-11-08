import { expect, it } from 'vitest';
import { quaternionFromEuler, rotateByQuaternion, type Vec3 } from '@opensekai/contracts';
import { eulerDegrees, lookAt, targetPoint } from '../src';
import { scene } from './context';

const angle = (a: Vec3, b: Vec3) =>
 Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180 / Math.PI;
const forward = (from: Vec3, to: Vec3) => rotateByQuaternion([0, 0, -1], lookAt(from, to));

it('gives the identity orientation for a camera that looks down −Z', () => {
 expect(lookAt([0, 0, 5], [0, 0, 0])).toEqual([0, 0, 0, 1]);
});

it('points the −Z axis at the target with no roll', () => {
 const cases: [Vec3, Vec3][] = [[[2, 3, 2], [0, 1.2, 0]], [[-3, 0.4, -1], [1, 1, 1]], [[0, 5, 0], [0, 0, 0]], [[0, 0, 0], [0, 4, 0]], [[1, 1, 1], [1, 1, -3]]];
 for (const [from, to] of cases) {
  expect(angle(forward(from, to), [to[0] - from[0], to[1] - from[1], to[2] - from[2]])).toBeLessThan(1e-6);
  expect(eulerDegrees(lookAt(from, to))[2]).toBeCloseTo(0, 9);
 }
});

it('keeps the identity orientation when the points are equal', () => {
 expect(lookAt([1, 2, 3], [1, 2, 3])).toEqual([0, 0, 0, 1]);
});

it('round-trips Euler degrees in YXZ order', () => {
 for (const e of [[0, 0, 0], [30, 45, 0], [-60, 170, 10], [89, -120, -45], [-10, -179, 5]] as Vec3[]) {
  const back = eulerDegrees(quaternionFromEuler(e));
  e.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 9));
 }
});

it('aims at an avatar from the framing height and at other entities at their position', () => {
 const avatar = scene.entities.find(e => e.kind === 'avatar')!;
 const mesh = scene.entities.find(e => e.id === 'reference')!;
 expect(targetPoint(avatar, 'closeUp')).toEqual([0, 1.5, 0]);
 expect(targetPoint(avatar)).toEqual([0, 1.2, 0]);
 expect(targetPoint(mesh, 'closeUp')).toEqual([0.9, 0.7, 0]);
});
