import { describe, expect, it } from 'vitest';
import {
  BOUNCY_MAX_STEP_SECONDS, mixBouncyDrive, initialBouncySpringState, stepBouncySpring, bouncySpringOutput, type BouncyDrive
} from '../src/bouncy-spring';

const drive: BouncyDrive = {
  pitchWeight: 1, pitchScale: 1, jawWeight: 0.5, jawScale: 1,
  pitchClamp: [-1, 1], jawClamp: [0, 1]
};

describe('mixBouncyDrive', () => {
  it('sinks on chin-down pitch and jaw open, rises on chin-up', () => {
    expect(mixBouncyDrive(90, 0, drive)).toBeLessThan(0);
    expect(mixBouncyDrive(-90, 0, drive)).toBeGreaterThan(0);
    expect(mixBouncyDrive(0, 1, drive)).toBeLessThan(mixBouncyDrive(0, 0, drive));
  });
});

describe('stepBouncySpring', () => {
  it('moves toward a sink target and settles', () => {
    let state = initialBouncySpringState(0);
    for (let i = 0; i < 120; i++) state = stepBouncySpring(state, -0.5, 0.5, 0.5, 0.05, 1 / 60);
    expect(bouncySpringOutput(state)).toBeLessThan(-0.2);
    expect(Math.abs(state.velocity)).toBeLessThan(0.05);
  });
  it('stays finite on a 1 s step', () => {
    const state = stepBouncySpring(initialBouncySpringState(0), -1, 0.5, 0.5, 0.05, 1);
    expect(Number.isFinite(bouncySpringOutput(state))).toBe(true);
  });
  it('uses substeps at most 16 ms', () => {
    expect(BOUNCY_MAX_STEP_SECONDS).toBe(0.016);
  });
});
