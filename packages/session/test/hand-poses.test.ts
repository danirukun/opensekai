import {describe, expect, it} from 'vitest';
import {evaluateHandPose} from '../src/hand-poses';
import {quatToEuler} from '../src/bone-offsets';

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

  it('curls pinch index toward the thumb and curls the other fingers more', () => {
    const pinch = evaluateHandPose('right', 'pinch2');
    const euler = (bone: string) => quatToEuler(pinch[bone]!.rotation);
    const z = (bone: string) => euler(bone)[2]!;
    const indexCurl = z('rightIndexProximal') + z('rightIndexIntermediate') + z('rightIndexDistal');
    const middleCurl = z('rightMiddleProximal') + z('rightMiddleIntermediate') + z('rightMiddleDistal');
    const thumbMeta = euler('rightThumbMetacarpal');
    const indexAdduction = euler('rightIndexProximal')[1]!;
    expect(z('rightIndexIntermediate')).toBeGreaterThan(z('rightIndexProximal'));
    expect(middleCurl).toBeGreaterThan(indexCurl);
    expect(thumbMeta[0]!).toBeGreaterThan(40);
    expect(thumbMeta[1]!).toBeLessThan(-20);
    expect(indexAdduction).toBeLessThan(-10);
    expect(z('rightIndexDistal')).toBeGreaterThan(8);
  });
});
