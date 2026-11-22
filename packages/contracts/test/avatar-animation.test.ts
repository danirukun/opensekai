import {describe, expect, it} from 'vitest';
import {
  AvatarAnimationSchema, MAX_OVERLAY_POSES, OVERLAY_POSE_IDS, SceneEntitySchema, ScenePatchSchema, makeSmokeScene,
} from '../src/index';

const animation = {
  overlayingPoses: [{id: 'o1', pose: 'selfie' as const, maskedBodyParts: ['leftArm', 'rightArm'] as const, weight: 1}],
  overlayTransitionSeconds: 1,
  overrideHandPoses: {left: {enabled: true, pose: 'peace' as const, weight: 1, highPriority: false}},
  handPin: {left: {enabled: true, mode: 'preset' as const}},
};

describe('AvatarAnimation', () => {
  it('accepts a valid animation and its avatar patch', () => {
    expect(AvatarAnimationSchema.safeParse(animation).success).toBe(true);
    const avatar = makeSmokeScene().entities.find(e => e.kind === 'avatar')!;
    expect(SceneEntitySchema.safeParse({...avatar, animation}).success).toBe(true);
    expect(ScenePatchSchema.safeParse({
      sceneId: 'scene_smoke', expectedRevision: 0,
      operations: [{kind: 'setAvatarAnimation', entityId: avatar.id, animation}],
    }).success).toBe(true);
  });

  it('rejects unknown pose ids and too many overlays', () => {
    expect(AvatarAnimationSchema.safeParse({
      ...animation, overlayingPoses: [{...animation.overlayingPoses[0]!, pose: 'dance'}],
    }).success).toBe(false);
    const many = Array.from({length: MAX_OVERLAY_POSES + 1}, (_, i) => ({
      id: `o${i}`, pose: OVERLAY_POSE_IDS[0], maskedBodyParts: ['leftArm'] as const, weight: 1,
    }));
    expect(AvatarAnimationSchema.safeParse({...animation, overlayingPoses: many}).success).toBe(false);
  });

  it('rejects setAvatarAnimation on a non-avatar only at session apply; schema still needs entityId', () => {
    expect(ScenePatchSchema.safeParse({
      sceneId: 'scene_smoke', expectedRevision: 0,
      operations: [{kind: 'setAvatarAnimation', entityId: 'camera', animation}],
    }).success).toBe(true);
  });
});
