import type { Vec3 } from '@opensekai/contracts';
import { smoothDampStep } from './blueprint-eval/math';

export type PendulumInputKind = 'headPitch' | 'headYaw' | 'headRoll' | 'headPositionX' | 'headPositionY' | 'headPositionZ' | 'blendShape';
export interface PendulumInput { kind: PendulumInputKind; blendShape: string | null; weight: number; scale: number; absolute: boolean; clamp: [number, number] }
export interface PendulumArm { length: number; mass: number; drag: number; spring: number; damping: number; gravity: number }
export interface PendulumReading { rotation: Vec3; position: Vec3; blendShape: (name: string) => number }
export interface PendulumState { mix: number; mixVelocity: number; angles: number[]; velocities: number[] }

// Degrees to the input unit. Task 8 measures it.
export const PENDULUM_ROTATION_UNIT = 1 / 180;
export const PENDULUM_MAX_STEP_SECONDS = 0.016;
// Start values; Task 11 tunes them against Warudo.
const SPRING_GAIN = 44;
const DAMPING_GAIN = 2.8;
const GRAVITY_GAIN = 10;
const MIN_MASS = 0.01;
const MIN_LENGTH = 0.01;

const readInput = (input: PendulumInput, reading: PendulumReading): number => {
 switch (input.kind) {
  case 'headPitch': return reading.rotation[0] * PENDULUM_ROTATION_UNIT;
  case 'headYaw': return reading.rotation[1] * PENDULUM_ROTATION_UNIT;
  case 'headRoll': return reading.rotation[2] * PENDULUM_ROTATION_UNIT;
  case 'headPositionX': return reading.position[0];
  case 'headPositionY': return reading.position[1];
  case 'headPositionZ': return reading.position[2];
  case 'blendShape': return reading.blendShape(input.blendShape ?? '');
 }
};

export const mixPendulumInputs = (inputs: readonly PendulumInput[], reading: PendulumReading): number =>
 inputs.reduce((sum, input) => {
  const scaled = readInput(input, reading) * input.scale;
  const value = input.absolute ? Math.abs(scaled) : scaled;
  return sum + Math.min(input.clamp[1], Math.max(input.clamp[0], value)) * input.weight;
 }, 0);

export const initialPendulumState = (arms: number, mix: number): PendulumState => ({
 mix,
 mixVelocity: 0,
 angles: Array.from({ length: arms }, () => 0),
 velocities: Array.from({ length: arms }, () => 0)
});

export const pendulumOutput = (state: PendulumState): number => state.angles.length > 0 ? state.angles[state.angles.length - 1] : state.mix;

const substep = (state: PendulumState, arms: readonly PendulumArm[], mix: number, inputSmoothing: number, h: number): PendulumState => {
 const smoothed = inputSmoothing > 0
  ? smoothDampStep(state.mix, mix, state.mixVelocity, inputSmoothing, h)
  : { value: mix, velocity: 0 };
 const angles = state.angles.slice(), velocities = state.velocities.slice();
 let target = smoothed.value;
 arms.forEach((arm, i) => {
  const theta = angles[i], omega = velocities[i];
  // Spring toward the target, linear and quadratic drag, and a gravity term that restores toward 0.
  const acceleration = (SPRING_GAIN * arm.spring * (target - theta) - DAMPING_GAIN * arm.damping * omega - arm.drag * omega * Math.abs(omega) - GRAVITY_GAIN * arm.gravity * theta / Math.max(arm.length, MIN_LENGTH)) / Math.max(arm.mass, MIN_MASS);
  velocities[i] = omega + acceleration * h;
  angles[i] = theta + velocities[i] * h;
  target = angles[i];
 });
 return { mix: smoothed.value, mixVelocity: smoothed.velocity, angles, velocities };
};

const finite = (state: PendulumState): boolean =>
 Number.isFinite(state.mix) && Number.isFinite(state.mixVelocity) && state.angles.every(Number.isFinite) && state.velocities.every(Number.isFinite);

export const stepPendulum = (state: PendulumState, arms: readonly PendulumArm[], mix: number, inputSmoothing: number, deltaSeconds: number): PendulumState => {
 if (!(deltaSeconds > 0)) return state;
 // The 1e-9 keeps an exact multiple of the step (0.032 s) from rounding up to one more substep.
 const count = Math.max(1, Math.ceil(deltaSeconds / PENDULUM_MAX_STEP_SECONDS - 1e-9)), h = deltaSeconds / count;
 let next = state;
 for (let i = 0; i < count; i++) next = substep(next, arms, mix, inputSmoothing, h);
 return finite(next) ? next : initialPendulumState(arms.length, mix);
};
