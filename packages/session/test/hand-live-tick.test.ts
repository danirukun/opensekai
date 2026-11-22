import {describe, expect, it} from 'vitest';
import {makeSmokeScene} from '@opensekai/contracts';
import {createSession} from '../src/session';

const fistAnimation = {
  overlayingPoses: [],
  overlayTransitionSeconds: 0,
  overrideHandPoses: {
    left: {enabled: true, pose: 'fist' as const, weight: 1, highPriority: true},
    right: {enabled: true, pose: 'fist' as const, weight: 1, highPriority: true},
  },
  handPin: {},
};

describe('live hand pose tick', () => {
  it('emits fist finger bones with idle and no tracking', () => {
    const base = makeSmokeScene();
    const scene = {
      ...base,
      entities: base.entities.map(e =>
        e.kind === 'avatar'
          ? {
              ...e,
              tracking: undefined,
              idleAnimation: {kind: 'builtin' as const, enabled: true},
              animation: fistAnimation,
            }
          : e,
      ),
    };
    const avatarId = scene.entities.find(e => e.kind === 'avatar')!.id;
    const session = createSession(scene, 'test');
    const frame = session.advance(1000);
    const pose = frame.avatarPoses?.find(p => p.avatarId === avatarId);
    expect(pose).toBeDefined();
    expect(pose!.baseBones?.leftUpperArm).toBeDefined();
    expect(pose!.bones.leftIndexProximal).toBeDefined();
    expect(pose!.bones.leftIndexProximal!.rotation).not.toEqual([0, 0, 0, 1]);
  });

  it('emits fist finger bones with animation only (idle off, no tracking)', () => {
    const base = makeSmokeScene();
    const scene = {
      ...base,
      entities: base.entities.map(e =>
        e.kind === 'avatar'
          ? {
              ...e,
              tracking: undefined,
              idleAnimation: {kind: 'builtin' as const, enabled: false},
              animation: fistAnimation,
            }
          : e,
      ),
    };
    const avatarId = scene.entities.find(e => e.kind === 'avatar')!.id;
    const session = createSession(scene, 'test');
    const frame = session.advance(1000);
    const pose = frame.avatarPoses?.find(p => p.avatarId === avatarId);
    expect(pose).toBeDefined();
    expect(pose!.baseBones).toBeUndefined();
    expect(pose!.bones.leftIndexProximal).toBeDefined();
  });
});