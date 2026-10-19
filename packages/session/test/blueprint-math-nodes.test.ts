import { describe, expect, it } from 'vitest';
import type { BlueprintValue, Vec3 } from '@opensekai/contracts';
import { EVALUATORS, emptyState, NO_ENV, type Evaluator, type RunEnv, type RunState } from '../src/blueprint-eval';
import { smoothDampStep } from '../src/blueprint-eval/math';
import { rotateByEuler, smoothDampVectorStep } from '../src/blueprint-eval/vector3';
import { quatToEuler, eulerToQuat } from '../src/bone-offsets';

type Inputs = Record<string, BlueprintValue>;
const ERROR = Symbol('error');
// Calls one data evaluator with explicit inputs. A missing input is a test mistake, not a default.
const evaluate = (type: string, inputs: Inputs, state: RunState = emptyState(), env: RunEnv = NO_ENV, output = 'result', id = 'n'): BlueprintValue => {
 const node = { id, version: 1, type, settings: {}, position: { x: 0, y: 0 } };
 const read = (port: string) => { if (!Object.hasOwn(inputs, port)) throw new Error(`Test input ${port} is missing`); return inputs[port]!; };
 return (EVALUATORS[type as keyof typeof EVALUATORS] as Evaluator<never>).data!(node as never, output, read, state, env);
};
const outcome = (type: string, inputs: Inputs) => { try { return evaluate(type, inputs); } catch (error) { if (error instanceof RangeError) return ERROR; throw error; } };
// Integer nodes must be exact; float nodes are compared to 9 decimals.
const expectValue = (actual: unknown, expected: unknown, label: string) => {
 if (typeof expected === 'number' && typeof actual === 'number' && !label.startsWith('integer.')) expect(actual, label).toBeCloseTo(expected, 9);
 else if (Array.isArray(expected) && Array.isArray(actual)) expected.forEach((value, i) => expect(actual[i], `${label}[${i}]`).toBeCloseTo(value as number, 9));
 else expect(actual, label).toBe(expected);
};
const table = (rows: [string, Inputs, unknown][]) => rows.forEach(([type, inputs, expected]) => expectValue(outcome(type, inputs), expected, `${type} ${JSON.stringify(inputs)}`));
const MAX = Number.MAX_SAFE_INTEGER;

describe('float to integer', () => {
 it('rounds, floors, ceils, and truncates into the safe-integer range', () => table([
  ['integer.round', { value: 2.5 }, 3], ['integer.round', { value: -2.5 }, -2], ['integer.round', { value: -0.4 }, 0],
  ['integer.floor', { value: -1.5 }, -2], ['integer.ceil', { value: -1.5 }, -1], ['integer.ceil', { value: 1.2 }, 2],
  ['integer.truncate', { value: -1.9 }, -1], ['integer.truncate', { value: 1.9 }, 1],
  ['integer.round', { value: 1e20 }, ERROR], ['integer.floor', { value: -1e20 }, ERROR], ['integer.truncate', { value: MAX }, MAX],
 ]));
 it('turns -0 into 0', () => {
  expect(Object.is(evaluate('integer.ceil', { value: -0.5 }), 0)).toBe(true);
  expect(Object.is(evaluate('integer.truncate', { value: -0.5 }), 0)).toBe(true);
 });
});

describe('integer arithmetic', () => {
 it('adds, subtracts, multiplies, and fails on overflow', () => table([
  ['integer.add', { a: 2, b: 3 }, 5], ['integer.subtract', { a: 2, b: 3 }, -1], ['integer.multiply', { a: -4, b: 3 }, -12],
  ['integer.add', { a: MAX, b: 1 }, ERROR], ['integer.subtract', { a: -MAX, b: 1 }, ERROR], ['integer.multiply', { a: 2 ** 27, b: 2 ** 27 }, ERROR],
  ['integer.add', { a: MAX, b: 0 }, MAX],
 ]));
 it('divides toward zero, keeps the sign of the dividend in Modulo, and fails on a zero divisor', () => table([
  ['integer.divide', { a: 7, b: 2 }, 3], ['integer.divide', { a: -7, b: 2 }, -3], ['integer.divide', { a: 7, b: -2 }, -3], ['integer.divide', { a: -7, b: -2 }, 3],
  ['integer.divide', { a: MAX, b: 3 }, Math.trunc(MAX / 3)], ['integer.divide', { a: MAX - 1, b: 2 }, (MAX - 1) / 2], ['integer.divide', { a: -MAX, b: -1 }, MAX],
  ['integer.modulo', { a: 7, b: 3 }, 1], ['integer.modulo', { a: -7, b: 3 }, -1], ['integer.modulo', { a: 7, b: -3 }, 1], ['integer.modulo', { a: -8, b: 2 }, 0],
  ['integer.divide', { a: 1, b: 0 }, ERROR], ['integer.modulo', { a: 1, b: 0 }, ERROR],
 ]));
 it('keeps a = (a / b) * b + a % b', () => {
  for (const [a, b] of [[17, 5], [-17, 5], [17, -5], [-17, -5], [MAX, 7], [-MAX, 9]] as const)
   expect((evaluate('integer.divide', { a, b }) as number) * b + (evaluate('integer.modulo', { a, b }) as number)).toBe(a);
 });
 it('negates, takes the absolute value, min, max, clamp, and parity', () => table([
  ['integer.negate', { value: 4 }, -4], ['integer.negate', { value: -MAX }, MAX], ['integer.abs', { value: -4 }, 4],
  ['integer.min', { a: 2, b: -1 }, -1], ['integer.max', { a: 2, b: -1 }, 2],
  ['integer.clamp', { value: 12, min: 0, max: 10 }, 10], ['integer.clamp', { value: -3, min: 0, max: 10 }, 0], ['integer.clamp', { value: 1, min: 5, max: 0 }, ERROR],
  ['integer.isEven', { value: 4 }, true], ['integer.isEven', { value: -3 }, false], ['integer.isEven', { value: 0 }, true], ['integer.isEven', { value: -2 }, true],
 ]));
 it('turns -0 into 0 in Negate', () => expect(Object.is(evaluate('integer.negate', { value: 0 }), 0)).toBe(true));
});

describe('Random Integer', () => {
 it('draws inclusive integers from the seeded generator and advances it', () => {
  const state = emptyState(7), seen = new Set<BlueprintValue>();
  for (let i = 0; i < 200; i++) seen.add(evaluate('integer.random', { min: 1, max: 3 }, state));
  expect([...seen].sort()).toEqual([1, 2, 3]);
  const again = emptyState(7);
  expect(evaluate('integer.random', { min: 1, max: 6 }, again)).toBe(evaluate('integer.random', { min: 1, max: 6 }, emptyState(7)));
  expect(again.random).not.toBe(7);
 });
 it('gives the only value of a one-value range, stays in a range wider than 2^53, and fails on an empty range', () => {
  expect(evaluate('integer.random', { min: 5, max: 5 })).toBe(5);
  for (let seed = 0; seed < 50; seed++) {
   const value = evaluate('integer.random', { min: -MAX, max: MAX }, emptyState(seed)) as number;
   expect(Number.isSafeInteger(value)).toBe(true);
  }
  expect(outcome('integer.random', { min: 2, max: 1 })).toBe(ERROR);
 });
});

describe('float math', () => {
 it('clamps, remaps, and interpolates', () => table([
  ['math.clamp01', { value: 1.5 }, 1], ['math.clamp01', { value: -0.5 }, 0], ['math.clamp01', { value: 0.25 }, 0.25],
  ['math.remap', { value: 5, fromMin: 0, fromMax: 10, toMin: 100, toMax: 200, clamp: false }, 150],
  ['math.remap', { value: 20, fromMin: 0, fromMax: 10, toMin: 100, toMax: 200, clamp: false }, 300],
  ['math.remap', { value: 20, fromMin: 0, fromMax: 10, toMin: 100, toMax: 200, clamp: true }, 200],
  ['math.remap', { value: 3, fromMin: 10, fromMax: 0, toMin: 0, toMax: 1, clamp: false }, 0.7],
  ['math.remap', { value: 3, fromMin: 1, fromMax: 1, toMin: 4, toMax: 8, clamp: false }, 4],
  ['math.lerp', { a: 10, b: 20, t: 0.25 }, 12.5], ['math.lerp', { a: 10, b: 20, t: 2 }, 20], ['math.lerp', { a: 10, b: 20, t: -1 }, 10],
  ['math.inverseLerp', { a: 10, b: 20, value: 15 }, 0.5], ['math.inverseLerp', { a: 10, b: 20, value: 30 }, 1], ['math.inverseLerp', { a: 5, b: 5, value: 9 }, 0],
  ['math.smoothStep', { min: 0, max: 1, value: 0.5 }, 0.5], ['math.smoothStep', { min: 0, max: 1, value: 0.25 }, 0.15625], ['math.smoothStep', { min: 0, max: 1, value: 2 }, 1],
  ['math.smoothStep', { min: 2, max: 2, value: 1 }, 0], ['math.smoothStep', { min: 2, max: 2, value: 2 }, 1],
  ['math.moveTowards', { current: 0, target: 10, maxDelta: 3 }, 3], ['math.moveTowards', { current: 0, target: -10, maxDelta: 3 }, -3],
  ['math.moveTowards', { current: 9, target: 10, maxDelta: 3 }, 10], ['math.moveTowards', { current: 5, target: 5, maxDelta: -1 }, 5], ['math.moveTowards', { current: 0, target: 10, maxDelta: -2 }, -2],
  ['math.remap', { value: 1e308, fromMin: 0, fromMax: 1, toMin: 0, toMax: 10, clamp: false }, ERROR],
 ]));
 it('computes trigonometry in radians and converts angles', () => table([
  ['math.sin', { value: Math.PI / 2 }, 1], ['math.cos', { value: Math.PI }, -1], ['math.tan', { value: Math.PI / 4 }, 1],
  ['math.asin', { value: 1 }, Math.PI / 2], ['math.acos', { value: 1 }, 0], ['math.asin', { value: 1.01 }, ERROR], ['math.acos', { value: -2 }, ERROR],
  ['math.atan2', { y: 1, x: 0 }, Math.PI / 2], ['math.atan2', { y: 0, x: -1 }, Math.PI], ['math.atan2', { y: 0, x: 0 }, 0],
  ['math.degreesToRadians', { value: 180 }, Math.PI], ['math.radiansToDegrees', { value: Math.PI / 2 }, 90], ['math.pi', {}, Math.PI],
 ]));
 it('computes powers, roots, logarithms, sign, and modulo, and fails on a non-finite result', () => table([
  ['math.pow', { base: 2, exponent: 10 }, 1024], ['math.pow', { base: 4, exponent: 0.5 }, 2], ['math.pow', { base: -8, exponent: 0.5 }, ERROR], ['math.pow', { base: 10, exponent: 400 }, ERROR],
  ['math.sqrt', { value: 9 }, 3], ['math.sqrt', { value: -1 }, ERROR],
  ['math.exp', { value: 1 }, Math.E], ['math.exp', { value: 1000 }, ERROR],
  ['math.log', { value: Math.E }, 1], ['math.log', { value: 0 }, ERROR], ['math.log', { value: -1 }, ERROR],
  ['math.sign', { value: -3 }, -1], ['math.sign', { value: 0 }, 0], ['math.sign', { value: 0.1 }, 1],
  ['math.modulo', { a: 5.5, b: 2 }, 1.5], ['math.modulo', { a: -5.5, b: 2 }, -1.5], ['math.modulo', { a: 1, b: 0 }, ERROR],
 ]));
});

describe('Smooth Damp', () => {
 it('stays at a reached target, stops at the target instead of passing it, and does not move with a zero delta', () => {
  expect(smoothDampStep(5, 5, 0, 0.3, 0.016)).toEqual({ value: 5, velocity: 0 });
  expect(smoothDampStep(0, 10, 0, 0.3, 0)).toEqual({ value: 0, velocity: 0 });
  expect(smoothDampStep(9.99, 10, 100, 0.3, 0.1)).toEqual({ value: 10, velocity: 0 });
  // A smooth time of 0 is 0.0001, so one tick almost reaches the target.
  expect(smoothDampStep(0, 10, 0, 0, 0.016).value).toBeCloseTo(10, 2);
 });
 it('approaches the target monotonically and reaches it within a few smooth times', () => {
  let current = { value: 0, velocity: 0 }, previous = -1;
  for (let tick = 0; tick < 120; tick++) {
   current = smoothDampStep(current.value, 10, current.velocity, 0.3, 1 / 60);
   expect(current.value).toBeGreaterThan(previous); expect(current.value).toBeLessThanOrEqual(10);
   previous = current.value;
  }
  expect(current.value).toBeCloseTo(10, 2);
 });
 it('gives the target on the first read, then steps once per tick and reads its inputs only when it steps', () => {
  const tick = (tickMs: number, deltaSeconds = 0.1): RunEnv => ({ ...NO_ENV, deltaSeconds, tickMs });
  const state = emptyState();
  expect(evaluate('math.smoothDamp', { target: 4, smoothTime: 0.3 }, state, tick(0))).toBe(4);
  expect(state.nodes.get('n')).toEqual({ value: 4, velocity: 0, stepMs: 0 });
  // Reads that must not happen: the same tick, and a run without a time delta.
  const unread = { get target(): never { throw new Error('read'); }, get smoothTime(): never { throw new Error('read'); } } as unknown as Inputs;
  const moved = evaluate('math.smoothDamp', { target: 10, smoothTime: 0.3 }, state, tick(16)) as number;
  expect(moved).toBeGreaterThan(4); expect(moved).toBeLessThan(10);
  expect(evaluate('math.smoothDamp', unread, state, tick(16))).toBe(moved);
  expect(evaluate('math.smoothDamp', unread, state, tick(20, 0))).toBe(moved);
  expect(evaluate('math.smoothDamp', { target: 10, smoothTime: 0.3 }, state, tick(32))).toBeGreaterThan(moved);
 });
 it('steps at each read with a time delta when the env has no tick time', () => {
  const env = { ...NO_ENV, deltaSeconds: 0.1 }, state = emptyState();
  evaluate('math.smoothDamp', { target: 0, smoothTime: 0.3 }, state, env);
  const first = evaluate('math.smoothDamp', { target: 10, smoothTime: 0.3 }, state, env) as number;
  expect(evaluate('math.smoothDamp', { target: 10, smoothTime: 0.3 }, state, env)).toBeGreaterThan(first);
 });
 it('damps a Vector3 along the line to the target', () => {
  let current = { value: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3 };
  for (let tick = 0; tick < 10; tick++) current = smoothDampVectorStep(current.value, [3, 0, 4], current.velocity, 0.3, 1 / 60);
  expect(current.value[0] / current.value[2]).toBeCloseTo(0.75, 9);
  for (let tick = 0; tick < 200; tick++) current = smoothDampVectorStep(current.value, [3, 0, 4], current.velocity, 0.3, 1 / 60);
  current.value.forEach((value, i) => expect(value).toBeCloseTo([3, 0, 4][i]!, 3));
  expect(smoothDampVectorStep([2.99, 0, 4], [3, 0, 4], [100, 0, 0], 0.3, 0.1)).toEqual({ value: [3, 0, 4], velocity: [0, 0, 0] });
 });
});

describe('Vector3', () => {
 it('subtracts, measures, multiplies, and normalizes', () => table([
  ['vector3.subtract', { a: [3, 2, 1], b: [1, 1, 1] }, [2, 1, 0]],
  ['vector3.length', { value: [3, 0, 4] }, 5], ['vector3.length', { value: [0, 0, 0] }, 0],
  ['vector3.distance', { a: [1, 1, 1], b: [4, 5, 1] }, 5],
  ['vector3.dot', { a: [1, 2, 3], b: [4, -5, 6] }, 12], ['vector3.dot', { a: [1e200, 0, 0], b: [1e200, 0, 0] }, ERROR],
  ['vector3.cross', { a: [1, 0, 0], b: [0, 1, 0] }, [0, 0, 1]], ['vector3.cross', { a: [0, 1, 0], b: [1, 0, 0] }, [0, 0, -1]],
  ['vector3.normalize', { value: [0, 3, 4] }, [0, 0.6, 0.8]], ['vector3.normalize', { value: [0, 0, 0] }, [0, 0, 0]], ['vector3.normalize', { value: [1e-200, 0, 0] }, [1, 0, 0]],
  ['vector3.normalize', { value: [5e-324, 0, -5e-324] }, [Math.SQRT1_2, 0, -Math.SQRT1_2]], ['vector3.normalize', { value: [1.7e308, 1.7e308, 0] }, [Math.SQRT1_2, Math.SQRT1_2, 0]],
  ['vector3.length', { value: [1e300, 1e300, 0] }, 1e300 * Math.SQRT2], ['vector3.length', { value: [1.7e308, 1.7e308, 0] }, ERROR],
  ['vector3.add', { a: [1.7e308, 0, 0], b: [1.7e308, 0, 0] }, ERROR], ['vector3.scale', { value: [1, 2, 3], factor: -2 }, [-2, -4, -6]], ['vector3.scale', { value: [1e300, 0, 0], factor: 1e10 }, ERROR],
  ['vector3.subtract', { a: [-1.7e308, 0, 0], b: [1.7e308, 0, 0] }, ERROR],
 ]));
 it('interpolates, moves towards, and clamps the length', () => table([
  ['vector3.lerp', { a: [0, 0, 0], b: [2, 4, 6], t: 0.5 }, [1, 2, 3]], ['vector3.lerp', { a: [0, 0, 0], b: [2, 4, 6], t: 3 }, [2, 4, 6]],
  ['vector3.moveTowards', { current: [0, 0, 0], target: [0, 3, 4], maxDistance: 1 }, [0, 0.6, 0.8]],
  ['vector3.moveTowards', { current: [0, 0, 0], target: [0, 3, 4], maxDistance: 10 }, [0, 3, 4]],
  ['vector3.moveTowards', { current: [1, 1, 1], target: [1, 1, 1], maxDistance: -1 }, [1, 1, 1]],
  ['vector3.moveTowards', { current: [0, 0, 0], target: [0, 0, 2], maxDistance: -1 }, [0, 0, -1]],
  ['vector3.clampLength', { value: [0, 3, 4], maxLength: 1 }, [0, 0.6, 0.8]], ['vector3.clampLength', { value: [0, 0.3, 0.4], maxLength: 1 }, [0, 0.3, 0.4]],
  ['vector3.clampLength', { value: [0, 3, 4], maxLength: 0 }, [0, 0, 0]], ['vector3.clampLength', { value: [0, 0, 0], maxLength: 0 }, [0, 0, 0]],
  ['vector3.clampLength', { value: [1, 0, 0], maxLength: -1 }, ERROR], ['vector3.clampLength', { value: [1.7e308, -1.7e308, 0], maxLength: 2 }, [Math.SQRT2, -Math.SQRT2, 0]],
  ['vector3.moveTowards', { current: [5, 5, 5], target: [5, 5, 5], maxDistance: -1 }, [5, 5, 5]],
 ]));
 it('rotates by YXZ Euler degrees in the Get Bone Rotation convention', () => table([
  ['vector3.rotateByEuler', { value: [0, 0, 1], euler: [0, 90, 0] }, [1, 0, 0]],
  ['vector3.rotateByEuler', { value: [0, 0, 1], euler: [90, 0, 0] }, [0, -1, 0]],
  ['vector3.rotateByEuler', { value: [1, 0, 0], euler: [0, 0, 90] }, [0, 1, 0]],
  ['vector3.rotateByEuler', { value: [2, 3, 4], euler: [0, 0, 0] }, [2, 3, 4]],
  ['vector3.directionFromEuler', { euler: [0, 0, 0] }, [0, 0, 1]],
  ['vector3.directionFromEuler', { euler: [0, 180, 0] }, [0, 0, -1]],
  ['vector3.directionFromEuler', { euler: [-45, 90, 0] }, [Math.SQRT1_2, Math.SQRT1_2, 0]],
 ]));
 it('applies Y after X after Z, so the order matters and the round trip through Get Bone Rotation holds', () => {
  const euler: Vec3 = [30, 60, 20];
  // Rz first, then Rx, then Ry.
  const stepwise = rotateByEuler(rotateByEuler(rotateByEuler([1, 2, 3], [0, 0, 20]), [30, 0, 0]), [0, 60, 0]);
  rotateByEuler([1, 2, 3], euler).forEach((value, i) => expect(value).toBeCloseTo(stepwise[i]!, 9));
  quatToEuler(eulerToQuat(euler)).forEach((value, i) => expect(value).toBeCloseTo(euler[i]!, 9));
  expect(Math.hypot(...rotateByEuler([1, 2, 3], euler))).toBeCloseTo(Math.hypot(1, 2, 3), 9);
 });
});
