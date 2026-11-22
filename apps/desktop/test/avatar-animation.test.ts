import {describe, expect, it} from 'vitest';
import {DEFAULT_AVATAR_ANIMATION} from '@opensekai/contracts';
import {
  animationOf,
  moveOverlay,
  newOverlayEntry,
  removeOverlay,
  withHandOverride,
  withOverlayPose,
} from '../src/editor/avatar-animation';

describe('avatar animation editor helpers', () => {
  it('adds a unique overlay entry and switches its pose', () => {
    const base = animationOf(undefined);
    expect(base).toEqual(DEFAULT_AVATAR_ANIMATION);
    const entry = newOverlayEntry([]);
    expect(entry?.id).toBe('overlay-1');
    const withEntry = {...base, overlayingPoses: [entry!]};
    expect(withOverlayPose(withEntry, 'overlay-1', 'wave').overlayingPoses[0]?.pose).toBe('wave');
  });

  it('reorders and removes overlays and updates hand overrides', () => {
    const animation = {
      ...DEFAULT_AVATAR_ANIMATION,
      overlayingPoses: [
        {id: 'a', pose: 'rest' as const, weight: 1, maskedBodyParts: ['leftArm' as const]},
        {id: 'b', pose: 'selfie' as const, weight: 1, maskedBodyParts: ['rightArm' as const]},
      ],
    };
    expect(moveOverlay(animation, 'a', 1).overlayingPoses.map(e => e.id)).toEqual(['b', 'a']);
    expect(removeOverlay(animation, 'a').overlayingPoses.map(e => e.id)).toEqual(['b']);
    expect(withHandOverride(animation, 'right', {enabled: true, pose: 'fist'}).overrideHandPoses.right).toMatchObject({
      enabled: true,
      pose: 'fist',
      weight: 1,
      highPriority: true,
    });
  });

  it('plain-copies a proxy-backed animation (Svelte state rejects structuredClone)', () => {
    const raw = {
      ...DEFAULT_AVATAR_ANIMATION,
      overrideHandPoses: {left: {enabled: true, pose: 'open' as const, weight: 1, highPriority: true}},
    };
    const proxied = new Proxy(raw, {});
    expect(() => structuredClone(proxied)).toThrow();
    const copy = animationOf(proxied);
    expect(copy.overrideHandPoses.left).toEqual({enabled: true, pose: 'open', weight: 1, highPriority: true});
    copy.overrideHandPoses.left!.enabled = false;
    expect(raw.overrideHandPoses.left.enabled).toBe(true);
  });
});
