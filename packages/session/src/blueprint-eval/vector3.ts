import type { Vec3 } from '@opensekai/contracts';
import { eulerToQuat } from '../bone-offsets';
import { clamp01, damped, dampingFactors, num, real, type Damped } from './math';
import type { EvaluatorTable, Read } from './types';

const vec = (read: Read, port: string) => read(port) as Vec3;
const ZERO: Vec3 = [0, 0, 0];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (v: Vec3, f: number): Vec3 => [v[0] * f, v[1] * f, v[2] * f];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const realVec = (v: Vec3): Vec3 => [real(v[0]), real(v[1]), real(v[2])];

// Euler degrees in YXZ order, as Get Bone Rotation gives them: rotation = Ry · Rx · Rz.
export function rotateByEuler(value: Vec3, euler: Vec3): Vec3 {
 const [x, y, z, w] = eulerToQuat(euler), axis: Vec3 = [x, y, z];
 const t = scale(cross(axis, value), 2);
 return add(add(value, scale(t, w)), cross(axis, t));
}
// The forward axis of a glTF or VRM 1.0 model is +Z.
export const FORWARD: Vec3 = [0, 0, 1];

// Unity Vector3.SmoothDamp without a maximum speed. A step past the target stops at the target.
export function smoothDampVectorStep(current: Vec3, target: Vec3, velocity: Vec3, smoothTime: number, deltaSeconds: number): Damped<Vec3> {
 if (deltaSeconds <= 0) return { value: current, velocity };
 const { omega, decay } = dampingFactors(smoothTime, deltaSeconds);
 const change = sub(current, target);
 const temp = scale(add(velocity, scale(change, omega)), deltaSeconds);
 const value = add(target, scale(add(change, temp), decay));
 if (dot(sub(target, current), sub(value, target)) > 0) return { value: target, velocity: ZERO };
 return { value, velocity: scale(sub(velocity, scale(temp, omega)), decay) };
}

export const VECTOR3_EVALUATORS = {
 'vector3.make': { data: (_n, _o, read) => [Number(read('x')), Number(read('y')), Number(read('z'))] as Vec3 },
 'vector3.break': { data: (_n, output, read) => vec(read, 'value')[output === 'x' ? 0 : output === 'y' ? 1 : 2]! },
 'vector3.add': { data: (_n, _o, read) => { const a = vec(read, 'a'), b = vec(read, 'b'); return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as Vec3; } },
 'vector3.scale': { data: (_n, _o, read) => { const v = vec(read, 'value'), f = Number(read('factor')); return [v[0] * f, v[1] * f, v[2] * f] as Vec3; } },
 'vector3.subtract': { data: (_n, _o, read) => realVec(sub(vec(read, 'a'), vec(read, 'b'))) },
 'vector3.length': { data: (_n, _o, read) => real(length(vec(read, 'value'))) },
 'vector3.distance': { data: (_n, _o, read) => real(length(sub(vec(read, 'a'), vec(read, 'b')))) },
 'vector3.dot': { data: (_n, _o, read) => real(dot(vec(read, 'a'), vec(read, 'b'))) },
 'vector3.cross': { data: (_n, _o, read) => realVec(cross(vec(read, 'a'), vec(read, 'b'))) },
 'vector3.normalize': { data: (_n, _o, read) => {
  const v = vec(read, 'value'), size = real(length(v));
  return size === 0 ? ZERO : realVec(scale(v, 1 / size));
 } },
 'vector3.lerp': { data: (_n, _o, read) => { const a = vec(read, 'a'); return realVec(add(a, scale(sub(vec(read, 'b'), a), clamp01(num(read, 't'))))); } },
 // Unity Vector3.MoveTowards: a negative distance moves away from the target.
 'vector3.moveTowards': { data: (_n, _o, read) => {
  const current = vec(read, 'current'), target = vec(read, 'target'), maxDistance = num(read, 'maxDistance');
  const offset = sub(target, current), distance = real(length(offset));
  if (distance === 0 || (maxDistance >= 0 && distance <= maxDistance)) return target;
  return realVec(add(current, scale(offset, maxDistance / distance)));
 } },
 'vector3.smoothDamp': { data: (node, _o, read, state, env) => {
  const target = vec(read, 'target'), smoothTime = num(read, 'smoothTime');
  return damped(state, node.id, target, ZERO, from => {
   const next = smoothDampVectorStep(from.value, target, from.velocity, smoothTime, env.deltaSeconds);
   return { value: realVec(next.value), velocity: realVec(next.velocity) };
  });
 } },
 'vector3.rotateByEuler': { data: (_n, _o, read) => realVec(rotateByEuler(vec(read, 'value'), vec(read, 'euler'))) },
 'vector3.directionFromEuler': { data: (_n, _o, read) => realVec(rotateByEuler(FORWARD, vec(read, 'euler'))) },
 'vector3.clampLength': { data: (_n, _o, read) => {
  const v = vec(read, 'value'), maxLength = num(read, 'maxLength');
  if (maxLength < 0) throw new RangeError('Length limit is negative');
  const size = real(length(v));
  return size <= maxLength ? v : realVec(scale(v, maxLength / size));
 } },
} satisfies Partial<EvaluatorTable>;
