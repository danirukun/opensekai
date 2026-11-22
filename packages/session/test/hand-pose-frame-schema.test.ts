import {describe, expect, it} from 'vitest';
import {AvatarPoseSchema, RuntimeFrameSchema, makeSmokeScene} from '@opensekai/contracts';
import {evaluateHandPose} from '../src/hand-poses';
import {createSession} from '../src/session';

describe('hand pose frame schema', () => {
  it('accepts a dual-hand fist pose under AvatarPoseSchema', () => {
    const bones = {...evaluateHandPose('left', 'fist'), ...evaluateHandPose('right', 'fist')};
    expect(Object.keys(bones).length).toBe(30);
    const parsed = AvatarPoseSchema.safeParse({avatarId: 'a', bones, expressions: {}});
    expect(parsed.success).toBe(true);
  });

  it('publishes advance frames with fist hands through RuntimeFrameSchema', () => {
    const base = makeSmokeScene();
    const scene = {
      ...base,
      entities: base.entities.map(e =>
        e.kind === 'avatar'
          ? {
              ...e,
              tracking: undefined,
              idleAnimation: {kind: 'builtin' as const, enabled: true},
              animation: {
                overlayingPoses: [],
                overlayTransitionSeconds: 0,
                overrideHandPoses: {
                  left: {enabled: true, pose: 'fist' as const, weight: 1, highPriority: true},
                  right: {enabled: true, pose: 'fist' as const, weight: 1, highPriority: true},
                },
                handPin: {},
              },
            }
          : e,
      ),
    };
    const frame = createSession(scene, 'schema').advance(1000);
    const parsed = RuntimeFrameSchema.safeParse(frame);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.log(parsed.error);
    const pose = parsed.success ? parsed.data.avatarPoses?.[0] : undefined;
    expect(pose?.bones.leftIndexProximal).toBeDefined();
  });
});
