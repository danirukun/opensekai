import {describe, expect, it} from 'vitest';
import type {AvatarPose, SceneView} from '@opensekai/contracts';
import {makeSmokeScene} from '@opensekai/contracts';
import {composeAvatarAnimation} from '../src/avatar-animation-compose';

const pose = (avatarId = 'performer'): AvatarPose => ({avatarId, bones: {}, expressions: {}});

const withAnimation = (scene: SceneView, animation: NonNullable<Extract<SceneView['entities'][number], {kind: 'avatar'}>['animation']>): SceneView => ({
  ...scene,
  entities: scene.entities.map(e => e.kind === 'avatar' && e.id === 'performer' ? {...e, animation} : e),
});

describe('composeAvatarAnimation', () => {
  it('applies an overlay and blends on switch', () => {
    const scene = withAnimation(makeSmokeScene(), {
      overlayingPoses: [{id: 'a', pose: 'rest', maskedBodyParts: ['leftArm', 'rightArm'], weight: 1}],
      overlayTransitionSeconds: 0.5,
      overrideHandPoses: {},
      handPin: {},
    });
    const first = composeAvatarAnimation([pose()], scene, 0, new Map());
    expect(first.poses[0]!.bones.rightUpperArm).toBeDefined();
    const midScene = withAnimation(makeSmokeScene(), {
      overlayingPoses: [{id: 'a', pose: 'selfie', maskedBodyParts: ['leftArm', 'rightArm'], weight: 1}],
      overlayTransitionSeconds: 0.5,
      overrideHandPoses: {},
      handPin: {},
    });
    const mid = composeAvatarAnimation([pose()], midScene, 250, first.runtimes);
    const end = composeAvatarAnimation([pose()], midScene, 500, mid.runtimes);
    expect(mid.poses[0]!.bones.rightUpperArm!.rotation).not.toEqual(end.poses[0]!.bones.rightUpperArm!.rotation);
  });

  it('applies high-priority hand poses over tracked fingers', () => {
    const scene = withAnimation(makeSmokeScene(), {
      overlayingPoses: [],
      overlayTransitionSeconds: 0,
      overrideHandPoses: {right: {enabled: true, pose: 'fist', weight: 1, highPriority: true}},
      handPin: {},
    });
    const tracked: AvatarPose = {
      avatarId: 'performer',
      bones: {rightIndexProximal: {rotation: [0, 0, 0, 1], space: 'normalized', weight: 1}},
      expressions: {},
    };
    const out = composeAvatarAnimation([tracked], scene, 0, new Map());
    expect(out.poses[0]!.bones.rightIndexProximal!.rotation).not.toEqual([0, 0, 0, 1]);
  });

  it('applies hand poses when tracking has no finger bones', () => {
    const scene = withAnimation(makeSmokeScene(), {
      overlayingPoses: [],
      overlayTransitionSeconds: 0,
      overrideHandPoses: {left: {enabled: true, pose: 'pinch2', weight: 1, highPriority: true}},
      handPin: {},
    });
    const out = composeAvatarAnimation([pose()], scene, 0, new Map());
    expect(out.poses[0]!.bones.leftIndexProximal).toBeDefined();
    expect(out.poses[0]!.bones.leftThumbMetacarpal).toBeDefined();
  });
});
