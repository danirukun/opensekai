import { smoothDampStep } from './blueprint-eval/math';

export const BOUNCY_ROTATION_UNIT = 1 / 180;
export const BOUNCY_MAX_STEP_SECONDS = 0.016;

const SPRING_GAIN = 44;
const DAMPING_GAIN = 2.8;

export type BouncySpringState = {
  mix: number;
  mixVelocity: number;
  position: number;
  velocity: number;
};

export type BouncyDrive = {
  pitchWeight: number;
  pitchScale: number;
  jawWeight: number;
  jawScale: number;
  pitchClamp: [number, number];
  jawClamp: [number, number];
};

const clamp = (value: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, value));

export const mixBouncyDrive = (pitchDeg: number, jawOpen: number, drive: BouncyDrive): number => {
  const pitch = pitchDeg * BOUNCY_ROTATION_UNIT;
  const pitchTerm = clamp(pitch * drive.pitchScale, drive.pitchClamp) * drive.pitchWeight;
  const jawTerm = clamp(jawOpen * drive.jawScale, drive.jawClamp) * drive.jawWeight;
  return -(pitchTerm + jawTerm);
};

export const initialBouncySpringState = (mix: number): BouncySpringState => ({
  mix,
  mixVelocity: 0,
  position: 0,
  velocity: 0,
});

export const bouncySpringOutput = (state: BouncySpringState): number => state.position;

const substep = (
  state: BouncySpringState,
  driveTarget: number,
  spring: number,
  damping: number,
  inputSmoothing: number,
  h: number
): BouncySpringState => {
  const smoothed = inputSmoothing > 0
    ? smoothDampStep(state.mix, driveTarget, state.mixVelocity, inputSmoothing, h)
    : { value: driveTarget, velocity: 0 };

  const theta = state.position;
  const omega = state.velocity;

  const s = SPRING_GAIN * spring;
  const d = DAMPING_GAIN * damping;
  const mass = 0.25;

  // Backward Euler for a pure spring (same family as Pendulum):
  // v_next = (v + h * s * (target - theta) / mass) / (1 + h * (d + h * s) / mass)
  const velocity = (omega + h * s * (smoothed.value - theta) / mass) / (1 + h * (d + h * s) / mass);
  const position = theta + velocity * h;

  return {
    mix: smoothed.value,
    mixVelocity: smoothed.velocity,
    position,
    velocity,
  };
};

const finite = (state: BouncySpringState): boolean =>
  Number.isFinite(state.mix) &&
  Number.isFinite(state.mixVelocity) &&
  Number.isFinite(state.position) &&
  Number.isFinite(state.velocity);

export const stepBouncySpring = (
  state: BouncySpringState,
  driveTarget: number,
  spring: number,
  damping: number,
  inputSmoothing: number,
  deltaSeconds: number
): BouncySpringState => {
  if (!(deltaSeconds > 0)) return state;

  const count = Math.max(1, Math.ceil(deltaSeconds / BOUNCY_MAX_STEP_SECONDS - 1e-9));
  const h = deltaSeconds / count;

  let next = state;
  for (let i = 0; i < count; i++) {
    next = substep(next, driveTarget, spring, damping, inputSmoothing, h);
  }

  return finite(next) ? next : initialBouncySpringState(driveTarget);
};
