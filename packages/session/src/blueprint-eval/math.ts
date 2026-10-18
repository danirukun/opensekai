import type { Id } from '@opensekai/contracts';
import { unit } from '../tweens';
import { getNodeState, setNodeState, type BlueprintValue, type EvaluatorTable, type NodeState, type Read, type RunEnv, type RunState } from './types';

export const num = (read: Read, port: string) => Number(read(port));
// Throws so that the run fails; the runtime would also reject the value, but an explicit throw keeps the evaluators testable.
export const real = (value: number): number => {
 if (!Number.isFinite(value)) throw new RangeError('Blueprint number is not finite');
 return value + 0;
};
// Unity Mathf.InverseLerp: an empty range gives 0.
export const inverseLerp = (a: number, b: number, value: number) => a === b ? 0 : (value - a) / (b - a);

export type Damped<T> = { value: T; velocity: T };
export const MIN_SMOOTH_TIME = 0.0001;
export const dampingFactors = (smoothTime: number, deltaSeconds: number) => {
 const omega = 2 / Math.max(MIN_SMOOTH_TIME, smoothTime), x = omega * deltaSeconds;
 return { omega, decay: 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x) };
};
// Unity Mathf.SmoothDamp without a maximum speed: a critically damped spring. A step past the target stops at the target.
export function smoothDampStep(current: number, target: number, velocity: number, smoothTime: number, deltaSeconds: number): Damped<number> {
 if (deltaSeconds <= 0) return { value: current, velocity };
 const { omega, decay } = dampingFactors(smoothTime, deltaSeconds);
 const change = current - target;
 const temp = (velocity + omega * change) * deltaSeconds;
 const value = target + (change + temp) * decay;
 if ((target - current > 0) === (value > target)) return { value: target, velocity: 0 };
 return { value, velocity: (velocity - omega * temp) * decay };
}
// `stepMs` is the tick of the last step, or null when the env has no tick time.
type DampState<T> = Damped<T> & { stepMs: number | null };
// A Smooth Damp node starts at its target on the first read after a reset. Then it steps once per session tick with a time
// delta: a second read in the same tick (another On Update run, or another input read in one run) gives the stored value
// without reading the inputs again. Without `env.tickMs` (a bare runtime), it steps at each read with a time delta.
export function damped<T extends BlueprintValue>(state: RunState, nodeId: Id, env: RunEnv, read: Read, zero: T, step: (from: Damped<T>, target: T, smoothTime: number, deltaSeconds: number) => Damped<T>): T {
 const stored = getNodeState<DampState<T>>(state, nodeId);
 const moving = env.deltaSeconds > 0, stepMs = moving ? env.tickMs ?? null : null;
 const store = (next: Damped<T>) => { setNodeState(state, nodeId, { value: next.value, velocity: next.velocity, stepMs } as unknown as NodeState); return next.value; };
 if (!stored) return store({ value: read('target') as T, velocity: zero });
 const due = moving && (env.tickMs === undefined || stored.stepMs === null || env.tickMs > stored.stepMs);
 return due ? store(step(stored, read('target') as T, num(read, 'smoothTime'), env.deltaSeconds)) : stored.value;
}

const unary = (f: (value: number) => number) => ({ data: (_n: unknown, _o: string, read: Read) => real(f(num(read, 'value'))) });
export const MATH_EVALUATORS = {
 'math.clamp01': unary(unit),
 'math.remap': { data: (_n, _o, read) => {
  const t = inverseLerp(num(read, 'fromMin'), num(read, 'fromMax'), num(read, 'value'));
  const toMin = num(read, 'toMin');
  return real(toMin + (read('clamp') === true ? unit(t) : t) * (num(read, 'toMax') - toMin));
 } },
 'math.lerp': { data: (_n, _o, read) => { const a = num(read, 'a'); return real(a + (num(read, 'b') - a) * unit(num(read, 't'))); } },
 'math.inverseLerp': { data: (_n, _o, read) => real(unit(inverseLerp(num(read, 'a'), num(read, 'b'), num(read, 'value')))) },
 'math.smoothStep': { data: (_n, _o, read) => {
  const min = num(read, 'min'), max = num(read, 'max'), value = num(read, 'value');
  if (min === max) return value < min ? 0 : 1;
  const t = unit(inverseLerp(min, max, value));
  return real(t * t * (3 - 2 * t));
 } },
 'math.moveTowards': { data: (_n, _o, read) => {
  const current = num(read, 'current'), target = num(read, 'target'), maxDelta = num(read, 'maxDelta');
  return real(Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta);
 } },
 'math.smoothDamp': { data: (node, _o, read, state, env) => damped<number>(state, node.id, env, read, 0, (from, target, smoothTime, deltaSeconds) => {
  const next = smoothDampStep(from.value, target, from.velocity, smoothTime, deltaSeconds);
  return { value: real(next.value), velocity: real(next.velocity) };
 }) },
 'math.sin': unary(Math.sin),
 'math.cos': unary(Math.cos),
 'math.tan': unary(Math.tan),
 'math.asin': unary(Math.asin),
 'math.acos': unary(Math.acos),
 'math.atan2': { data: (_n, _o, read) => real(Math.atan2(num(read, 'y'), num(read, 'x'))) },
 'math.degreesToRadians': unary(value => value * Math.PI / 180),
 'math.radiansToDegrees': unary(value => value * 180 / Math.PI),
 'math.pi': { data: () => Math.PI },
 'math.pow': { data: (_n, _o, read) => real(Math.pow(num(read, 'base'), num(read, 'exponent'))) },
 'math.sqrt': unary(Math.sqrt),
 'math.exp': unary(Math.exp),
 'math.log': unary(Math.log),
 'math.sign': unary(Math.sign),
 'math.modulo': { data: (_n, _o, read) => real(num(read, 'a') % num(read, 'b')) },
} satisfies Partial<EvaluatorTable>;
