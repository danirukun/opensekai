import type { Id } from '@opensekai/contracts';
import { getNodeState, setNodeState, type BlueprintValue, type EvaluatorTable, type NodeState, type Read, type RunState } from './types';

export const num = (read: Read, port: string) => Number(read(port));
// Throws so that the run fails; the runtime would also reject the value, but an explicit throw keeps the evaluators testable.
export const real = (value: number): number => {
 if (!Number.isFinite(value)) throw new RangeError('Blueprint number is not finite');
 return value + 0;
};
export const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);
// Unity Mathf.InverseLerp: an empty range gives 0.
export const inverseLerp = (a: number, b: number, value: number) => a === b ? 0 : (value - a) / (b - a);

// Each run has its own RunState copy (cloneState in runFlow). A stateful data node uses it as the run key,
// because the runtime data cache lives only for one input read, and the node must advance at most once per run.
const perRun = new WeakMap<RunState, Map<Id, BlueprintValue>>();
export function oncePerRun(state: RunState, nodeId: Id, compute: () => BlueprintValue): BlueprintValue {
 let seen = perRun.get(state);
 if (!seen) perRun.set(state, seen = new Map());
 if (seen.has(nodeId)) return seen.get(nodeId)!;
 const value = compute();
 seen.set(nodeId, value);
 return value;
}

export interface Damped<T> { value: T; velocity: T }
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
// The first read after a reset starts at the target.
export const damped = <T extends BlueprintValue>(state: RunState, nodeId: Id, target: T, zero: T, step: (from: Damped<T>) => Damped<T>): T =>
 oncePerRun(state, nodeId, () => {
  const stored = getNodeState<{ value: T; velocity: T }>(state, nodeId);
  const next = stored ? step(stored) : { value: target, velocity: zero };
  setNodeState(state, nodeId, next as unknown as NodeState);
  return next.value;
 }) as T;

const unary = (f: (value: number) => number) => ({ data: (_n: unknown, _o: string, read: Read) => real(f(num(read, 'value'))) });
export const MATH_EVALUATORS = {
 'math.clamp01': unary(clamp01),
 'math.remap': { data: (_n, _o, read) => {
  const t = inverseLerp(num(read, 'fromMin'), num(read, 'fromMax'), num(read, 'value'));
  const toMin = num(read, 'toMin');
  return real(toMin + (read('clamp') === true ? clamp01(t) : t) * (num(read, 'toMax') - toMin));
 } },
 'math.lerp': { data: (_n, _o, read) => { const a = num(read, 'a'); return real(a + (num(read, 'b') - a) * clamp01(num(read, 't'))); } },
 'math.inverseLerp': { data: (_n, _o, read) => real(clamp01(inverseLerp(num(read, 'a'), num(read, 'b'), num(read, 'value')))) },
 'math.smoothStep': { data: (_n, _o, read) => {
  const min = num(read, 'min'), max = num(read, 'max'), value = num(read, 'value');
  if (min === max) return value < min ? 0 : 1;
  const t = clamp01(inverseLerp(min, max, value));
  return real(t * t * (3 - 2 * t));
 } },
 'math.moveTowards': { data: (_n, _o, read) => {
  const current = num(read, 'current'), target = num(read, 'target'), maxDelta = num(read, 'maxDelta');
  return real(Math.abs(target - current) <= maxDelta ? target : current + Math.sign(target - current) * maxDelta);
 } },
 'math.smoothDamp': { data: (node, _o, read, state, env) => {
  const target = num(read, 'target'), smoothTime = num(read, 'smoothTime');
  return damped(state, node.id, target, 0, from => {
   const next = smoothDampStep(from.value, target, from.velocity, smoothTime, env.deltaSeconds);
   return { value: real(next.value), velocity: real(next.velocity) };
  });
 } },
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
