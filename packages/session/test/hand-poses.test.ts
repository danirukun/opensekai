import {describe, expect, it} from 'vitest';
import {evaluateHandPose} from '../src/hand-poses';

describe('evaluateHandPose', () => {
  it('uses only finger bones and differs by shape and side', () => {
    const open = evaluateHandPose('right', 'open');
    const fist = evaluateHandPose('right', 'fist');
    expect(Object.keys(open).every(k => k.startsWith('right'))).toBe(true);
    expect(Object.keys(open).some(k => k.includes('Index'))).toBe(true);
    expect(open.rightIndexProximal!.rotation).not.toEqual(fist.rightIndexProximal!.rotation);
    const left = evaluateHandPose('left', 'fist');
    expect(left.leftIndexProximal!.rotation).not.toEqual(fist.rightIndexProximal!.rotation);
  });
});
