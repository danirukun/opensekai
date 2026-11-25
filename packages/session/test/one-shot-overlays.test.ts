import {describe, expect, it} from 'vitest';
import type {AssetRecord, AvatarPose, SceneView} from '@opensekai/contracts';
import {makeSmokeScene} from '@opensekai/contracts';
import {composeAvatarAnimation} from '../src/avatar-animation-compose';
import {evaluateAvatarClipOnce} from '../src/idle';
import {
  advanceOneShots,
  evaluateOneShotBones,
  oneShotEnvelope,
  startOneShot,
  type OneShotEntry,
} from '../src/one-shot-overlays';

const clipId = 'animation_' + 'd'.repeat(64);
const clip = {
  durationMs: 1000,
  bones: {chest: {times: [0, 1], rotations: [0, 0, 0, 1, 0, 0, Math.SQRT1_2, Math.SQRT1_2]}},
};
const clipRecord: AssetRecord = {
  id: clipId, format: 'vrma', sha256: 'd'.repeat(64), bytes: 64, sourceUrl: null,
  licenseLabel: 'User supplied', importerVersion: 1, name: 'dance', expressions: [], animation: clip,
};
const record = (id: string) => id === clipId ? clipRecord : undefined;

const pose = (avatarId = 'performer'): AvatarPose => ({avatarId, bones: {}, expressions: {}});

const withAnimation = (scene: SceneView): SceneView => ({
  ...scene,
  entities: scene.entities.map(e => e.kind === 'avatar' && e.id === 'performer'
    ? {
      ...e,
      animation: {
        overlayingPoses: [],
        overlayTransitionSeconds: 0,
        overrideHandPoses: {},
        handPin: {},
      },
    }
    : e),
});

describe('oneShotEnvelope', () => {
  it('blends in, holds, and blends out', () => {
    expect(oneShotEnvelope(0, 1000, 200, 200)).toBe(0);
    expect(oneShotEnvelope(100, 1000, 200, 200)).toBeCloseTo(0.5);
    expect(oneShotEnvelope(500, 1000, 200, 200)).toBe(1);
    expect(oneShotEnvelope(900, 1000, 200, 200)).toBeCloseTo(0.5);
    expect(oneShotEnvelope(1000, 1000, 200, 200)).toBe(0);
  });

  it('compresses when in+out exceed length', () => {
    expect(oneShotEnvelope(250, 1000, 800, 800)).toBeCloseTo(0.5);
    expect(oneShotEnvelope(500, 1000, 800, 800)).toBeCloseTo(1);
    expect(oneShotEnvelope(750, 1000, 800, 800)).toBeCloseTo(0.5);
  });
});

describe('evaluateAvatarClipOnce', () => {
  it('clamps at the end instead of looping', () => {
    const mid = evaluateAvatarClipOnce(clip, 500);
    const end = evaluateAvatarClipOnce(clip, 1000);
    const past = evaluateAvatarClipOnce(clip, 2500);
    expect(past.chest!.rotation).toEqual(end.chest!.rotation);
    expect(mid.chest!.rotation).not.toEqual(end.chest!.rotation);
  });
});

describe('startOneShot / advance', () => {
  it('rejects a missing animation asset', () => {
    const scene = makeSmokeScene();
    const reply = startOneShot(new Map(), scene, record, {
      kind: 'playOneShotOverlay',
      entityId: 'performer',
      assetId: 'missing',
      maskedBodyParts: ['body'],
      weight: 1,
      speed: 1,
      blendInSeconds: 0,
      blendOutSeconds: 0,
    }, 0);
    expect(reply.ok).toBe(false);
  });

  it('replaces an active play and clears when finished', () => {
    const scene = makeSmokeScene();
    const first = startOneShot(new Map(), scene, record, {
      kind: 'playOneShotOverlay',
      entityId: 'performer',
      assetId: clipId,
      maskedBodyParts: ['body'],
      weight: 1,
      speed: 1,
      blendInSeconds: 0,
      blendOutSeconds: 0,
    }, 0);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = startOneShot(first.data, scene, record, {
      kind: 'playOneShotOverlay',
      entityId: 'performer',
      assetId: clipId,
      maskedBodyParts: ['body'],
      weight: 1,
      speed: 1,
      blendInSeconds: 0,
      blendOutSeconds: 0,
    }, 100);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.get('performer')!.startedAtMs).toBe(100);
    const mid = advanceOneShots(second.data, scene, record, 500);
    expect(mid.has('performer')).toBe(true);
    const done = advanceOneShots(second.data, scene, record, 1100);
    expect(done.has('performer')).toBe(false);
  });
});

describe('compose one-shot', () => {
  it('applies a one-shot over the pose and skips raw tracked bones', () => {
    const scene = withAnimation(makeSmokeScene());
    const entry: OneShotEntry = {
      assetId: clipId,
      maskedBodyParts: ['body'],
      weight: 1,
      speed: 1,
      blendInMs: 0,
      blendOutMs: 0,
      startedAtMs: 0,
    };
    const oneShots = new Map([['performer', entry]]);
    const hit = composeAvatarAnimation([pose()], scene, 500, new Map(), record, oneShots);
    expect(hit.poses[0]!.bones.chest).toBeDefined();
    const tracked: AvatarPose = {
      avatarId: 'performer',
      bones: {chest: {rotation: [0, 0, 0, 1], space: 'raw', weight: 1}},
      expressions: {},
    };
    const skipped = composeAvatarAnimation([tracked], scene, 500, new Map(), record, oneShots);
    expect(skipped.poses[0]!.bones.chest!.space).toBe('raw');
    expect(skipped.poses[0]!.bones.chest!.rotation).toEqual([0, 0, 0, 1]);
  });

  it('evaluates contribution during blend-in', () => {
    const entry: OneShotEntry = {
      assetId: clipId,
      maskedBodyParts: ['body'],
      weight: 1,
      speed: 1,
      blendInMs: 200,
      blendOutMs: 0,
      startedAtMs: 0,
    };
    const mid = evaluateOneShotBones(entry, 100, record);
    expect(mid?.contribution).toBeCloseTo(0.5);
    expect(Object.keys(mid?.bones ?? {})).toContain('chest');
  });
});
