import {describe, expect, it} from 'vitest';
import {evaluateOverlayPose} from '../src/overlay-poses';
import {stepHandPin, wristEulerFromArm} from '../src/hand-pin';

describe('stepHandPin', () => {
  it('holds the wrist euler after capture while overlay arms change', () => {
    const selfie = evaluateOverlayPose('selfie', 0);
    const first = stepHandPin({}, {right: {enabled: true, mode: 'hold'}}, selfie, selfie);
    const held = first.runtime.right!.holdEuler;
    const wave = evaluateOverlayPose('wave', 300);
    const second = stepHandPin(first.runtime, {right: {enabled: true, mode: 'hold'}}, wave, wave);
    expect(second.runtime.right!.holdEuler).toEqual(held);
    expect(wristEulerFromArm(wave, 'right')).not.toEqual(held);
  });
});
