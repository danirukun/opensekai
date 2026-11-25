import {describe, expect, it} from 'vitest';
import type {AssetRecord, AvatarPose, SceneView} from '@opensekai/contracts';
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

  it('samples a clip overlay and skips a missing clip asset', () => {
    const clipId = 'animation_' + 'c'.repeat(64);
    const scene = withAnimation(makeSmokeScene(), {
      overlayingPoses: [{
        id: 'c1', kind: 'clip', assetId: clipId,
        maskedBodyParts: ['body'], weight: 1, speed: 1,
      }],
      overlayTransitionSeconds: 0,
      overrideHandPoses: {},
      handPin: {},
    });
    const clip = {
      durationMs: 1000,
      bones: {chest: {times: [0, 1], rotations: [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]}},
    };
    const clipRecord: AssetRecord = {
      id: clipId, format: 'vrma', sha256: 'c'.repeat(64), bytes: 64, sourceUrl: null,
      licenseLabel: 'User supplied', importerVersion: 1, name: 'chest', expressions: [], animation: clip,
    };
    const record = (id: string) => id === clipId ? clipRecord : undefined;
    const hit = composeAvatarAnimation([pose()], scene, 0, new Map(), record);
    expect(hit.poses[0]!.bones.chest).toBeDefined();
    const miss = composeAvatarAnimation([pose()], scene, 0, new Map());
    expect(miss.poses[0]!.bones.chest).toBeUndefined();
  });
});
