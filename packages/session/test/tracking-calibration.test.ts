import { describe, expect, it } from 'vitest';
import type { TrackingBone, TrackingSample } from '@opensekai/contracts';
import { applyCalibration, captureCalibration } from '../src/tracking-calibration';

const head: TrackingBone = { rotation: [0, 0, 0, 1], space: 'raw' };
const sample = (headPosition?: [number, number, number]): TrackingSample => ({ sourceId: 's', generation: 1, receivedAtMs: 0, bones: { head }, expressions: {}, ...(headPosition ? { headPosition } : {}) });

describe('head position calibration', () => {
 it('captures the head position as the neutral, and has no key without one', () => {
  expect(captureCalibration(sample([0.01, 0.1, 0.02]))!.headPosition).toEqual([0.01, 0.1, 0.02]);
  expect('headPosition' in captureCalibration(sample())!).toBe(false);
 });
 it('subtracts the neutral from the sample', () => {
  const calibration = captureCalibration(sample([0.01, 0.1, 0.02]))!;
  const result = applyCalibration(sample([0.02, 0.1, 0.05]), calibration).headPosition!;
  [0.01, 0, 0.03].forEach((value, i) => expect(result[i]).toBeCloseTo(value, 9));
 });
 it('gives no head position for an old calibration or without a calibration', () => {
  const old = captureCalibration(sample())!;
  expect('headPosition' in applyCalibration(sample([0.02, 0.1, 0.05]), old)).toBe(false);
  const none = applyCalibration(sample([0, 0, -0.4]), undefined);
  expect('headPosition' in none).toBe(false);
  expect(none.bones).toEqual({ head });
 });
 it('gives no head position when the sample has none', () => {
  const calibration = captureCalibration(sample([0.01, 0.1, 0.02]))!;
  expect('headPosition' in applyCalibration(sample(), calibration)).toBe(false);
 });
});
