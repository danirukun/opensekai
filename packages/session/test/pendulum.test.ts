import { describe, expect, it } from 'vitest';
import { initialPendulumState, mixPendulumInputs, pendulumOutput, stepPendulum, type PendulumArm, type PendulumInput, type PendulumReading } from '../src/pendulum';

const input = (over: Partial<PendulumInput>): PendulumInput => ({ kind: 'headPitch', blendShape: null, weight: 1, scale: 1, absolute: false, clamp: [-1, 1], ...over });
const reading = (over: Partial<PendulumReading> = {}): PendulumReading => ({ rotation: [0, 0, 0], position: [0, 0, 0], blendShape: () => 0, ...over });
const warudoArm: PendulumArm = { length: 10, mass: 0.25, drag: 0.25, spring: 0.5, damping: 0.5, gravity: 1 };
const arms = (count: number, over: Partial<PendulumArm> = {}) => Array.from({ length: count }, () => ({ ...warudoArm, ...over }));

describe('mixPendulumInputs', () => {
 it('mixes the Arm Movements inputs', () => {
  const inputs = [
   input({ kind: 'headPitch', weight: 0.33, scale: 20 }),
   input({ kind: 'headYaw', weight: 0.33, scale: 20, absolute: true }),
   input({ kind: 'headPositionZ', weight: 0.5, scale: 20 })
  ];
  const mix = mixPendulumInputs(inputs, reading({ rotation: [9, -4.5, 0], position: [0, 0, 0.01] }));
  expect(mix).toBeCloseTo(0.33 + 0.165 + 0.1, 12);
 });

 it('reads a blend shape by name', () => {
  const seen: string[] = [];
  const mix = mixPendulumInputs([input({ kind: 'blendShape', blendShape: 'jawOpen', weight: 2 })], reading({ blendShape: name => { seen.push(name); return 0.25; } }));
  expect(seen).toEqual(['jawOpen']);
  expect(mix).toBe(0.5);
 });

 it('clamps before it applies the weight', () => {
  expect(mixPendulumInputs([input({ kind: 'headRoll', scale: 1000, weight: 0.5, clamp: [-1, 1] })], reading({ rotation: [0, 0, 90] }))).toBe(0.5);
 });
});

describe('stepPendulum', () => {
 it('returns an equal state for a step of 0', () => {
  const state = { ...initialPendulumState(2, 0.3), angles: [0.1, 0.2], velocities: [1, 2] };
  expect(stepPendulum(state, arms(2), 1, 0.1, 0)).toEqual(state);
 });

 it('does not change the input state', () => {
  const state = initialPendulumState(2, 0);
  const before = structuredClone(state);
  stepPendulum(state, arms(2), 1, 0, 1 / 60);
  expect(state).toEqual(before);
 });

 it('settles on a constant mix without gravity', () => {
  let state = initialPendulumState(4, 0.5);
  for (let i = 0; i < 600; i++) state = stepPendulum(state, arms(4, { gravity: 0 }), 0.5, 0, 1 / 60);
  expect(Math.abs(pendulumOutput(state) - 0.5)).toBeLessThan(0.01);
 });

 it('outputs the smoothed mix with no arms', () => {
  const state = stepPendulum(initialPendulumState(0, 0), [], 1, 0.1, 1 / 60);
  expect(pendulumOutput(state)).toBe(state.mix);
  expect(state.mix).toBeGreaterThan(0);
  expect(state.mix).toBeLessThan(1);
 });

 it('takes the mix at once with input smoothing 0', () => {
  expect(pendulumOutput(stepPendulum(initialPendulumState(0, 0), [], 1, 0, 1 / 60))).toBe(1);
 });

 it.each([1, 5])('stays bounded for one step of %s s', seconds => {
  const next = stepPendulum(initialPendulumState(4, 0), arms(4), 1, 0, seconds);
  const output = pendulumOutput(next);
  expect(Number.isFinite(output)).toBe(true);
  expect(Math.abs(output)).toBeLessThanOrEqual(2);
 });

 it('gives equal results for 0.032 s and two steps of 0.016 s', () => {
  const start = initialPendulumState(4, 0);
  const whole = stepPendulum(start, arms(4), 1, 0.1, 0.032);
  const split = stepPendulum(stepPendulum(start, arms(4), 1, 0.1, 0.016), arms(4), 1, 0.1, 0.016);
  expect(whole.mix).toBeCloseTo(split.mix, 9);
  whole.angles.forEach((angle, i) => expect(angle).toBeCloseTo(split.angles[i], 9));
  whole.velocities.forEach((velocity, i) => expect(velocity).toBeCloseTo(split.velocities[i], 9));
 });

 // The schema limits (packages/contracts/src/blueprint-nodes/tracking.ts): each physical value is 0..100, and the step floors the mass.
 // From rest, one arm with a positive stiffness never passes twice its target (its energy only falls), so the bound is twice the largest mix.
 const limits: [string, Partial<PendulumArm>][] = [
  ...[0, 0.25].flatMap(mass => (['damping', 'drag', 'spring', 'gravity'] as const).map((key): [string, Partial<PendulumArm>] => [`${key} 100, mass ${mass}`, { [key]: 100, mass }])),
  ...[0, 100].flatMap(length => [0, 0.25].map((mass): [string, Partial<PendulumArm>] => [`length ${length}, mass ${mass}`, { length, mass }])),
  ['every value at its limit', { length: 0, mass: 0, drag: 100, spring: 100, damping: 100, gravity: 100 }]
 ];
 const drives = { step: () => 1, sine: (seconds: number) => Math.sin(2 * Math.PI * 1.5 * seconds) };
 describe.each([60, 30])('at %s Hz for 10 s', hz => {
  it.each(limits.flatMap(([name, over]) => Object.entries(drives).map(([drive, mix]) => [name, drive, over, mix] as const)))('stays finite and bounded with %s (%s input)', (_name, _drive, over, mix) => {
   let state = initialPendulumState(4, 0);
   for (let i = 1; i <= 10 * hz; i++) {
    state = stepPendulum(state, arms(4, over), mix(i / hz), 0, 1 / hz);
    // A reset to rest would hide a divergence, so each step must keep a moving chain.
    expect(state.angles.every(Number.isFinite) && state.velocities.every(Number.isFinite)).toBe(true);
    expect(Math.max(...state.angles.map(Math.abs))).toBeLessThanOrEqual(2);
   }
  });
 });

 it('treats a negative gravity as 0', () => {
  let negative = initialPendulumState(1, 0), none = negative;
  for (let i = 0; i < 600; i++) {
   negative = stepPendulum(negative, arms(1, { gravity: -100, length: 0 }), 1, 0, 1 / 60);
   none = stepPendulum(none, arms(1, { gravity: 0 }), 1, 0, 1 / 60);
  }
  expect(negative).toEqual(none);
 });

 it('resets a non-finite state', () => {
  const state = { ...initialPendulumState(2, 0), angles: [Number.NaN, 0] };
  expect(stepPendulum(state, arms(2), 0.4, 0, 1 / 60)).toEqual(initialPendulumState(2, 0.4));
 });
});
