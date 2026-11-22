import {describe, expect, it} from 'vitest';
import {blendOverlayBones, evaluateOverlayPose} from '../src/overlay-poses';

describe('evaluateOverlayPose', () => {
  it('gives distinct held poses and a moving wave', () => {
    const rest = evaluateOverlayPose('rest', 0);
    const selfie = evaluateOverlayPose('selfie', 0);
    expect(rest.rightUpperArm!.rotation).not.toEqual(selfie.rightUpperArm!.rotation);
    const w0 = evaluateOverlayPose('wave', 0);
    const w1 = evaluateOverlayPose('wave', 250);
    expect(w0.rightUpperArm!.rotation).not.toEqual(w1.rightUpperArm!.rotation);
    expect(evaluateOverlayPose('mic', 0).rightUpperArm!.rotation).toEqual(evaluateOverlayPose('mic', 5000).rightUpperArm!.rotation);
  });
});

describe('blendOverlayBones', () => {
  it('returns endpoints at t=0 and t=1', () => {
    const a = evaluateOverlayPose('rest', 0);
    const b = evaluateOverlayPose('selfie', 0);
    expect(blendOverlayBones(a, b, 0).rightUpperArm!.rotation).toEqual(a.rightUpperArm!.rotation);
    expect(blendOverlayBones(a, b, 1).rightUpperArm!.rotation).toEqual(b.rightUpperArm!.rotation);
  });
});
