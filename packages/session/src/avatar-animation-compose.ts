import type {AvatarAnimation, AvatarPose, Id, OverlayPoseEntry, Quat, SceneView} from '@opensekai/contracts';
import {bodyPartOf} from '@opensekai/contracts';
import {IDENTITY, slerpQuat} from './bone-offsets';
import {evaluateHandPose} from './hand-poses';
import {stepHandPin, type HandPinRuntime} from './hand-pin';
import {blendOverlayBones, evaluateOverlayPose, maskOverlayBones, type OverlayBone} from './overlay-poses';

export interface AvatarAnimationRuntime {
  pins: HandPinRuntime;
  transition?: {from: Record<string, OverlayBone>; startedAtMs: number; key: string};
  displayed?: Record<string, OverlayBone>;
}

export type AnimationRuntimes = Map<Id, AvatarAnimationRuntime>;

const overlayKey = (entries: readonly OverlayPoseEntry[]) =>
  entries.map(e => `${e.id}:${e.pose}:${e.weight}:${e.speed ?? 1}:${e.maskedBodyParts.join(',')}`).join('|');

function applyOverlayList(entries: readonly OverlayPoseEntry[], elapsedMs: number): Record<string, OverlayBone> {
  let bones: Record<string, OverlayBone> = {};
  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    const evaluated = maskOverlayBones(
      evaluateOverlayPose(entry.pose, elapsedMs, entry.speed ?? 1),
      entry.maskedBodyParts.length ? entry.maskedBodyParts : ['leftArm', 'rightArm', 'leftFingers', 'rightFingers'],
    );
    const next: Record<string, OverlayBone> = {...bones};
    for (const [name, bone] of Object.entries(evaluated)) {
      const base = bones[name]?.rotation ?? IDENTITY;
      next[name] = {space: 'normalized', rotation: slerpQuat(base, bone.rotation, entry.weight)};
    }
    bones = next;
  }
  return bones;
}

/** Bones covered by active overlays (for Face-Only writer skip). */
export function animationMaskedBones(animation: AvatarAnimation | undefined): Set<string> {
  const out = new Set<string>();
  if (!animation) return out;
  for (const entry of animation.overlayingPoses) {
    if (entry.weight <= 0) continue;
    const parts = new Set(entry.maskedBodyParts.length ? entry.maskedBodyParts : ['leftArm', 'rightArm', 'leftFingers', 'rightFingers']);
    for (const bone of Object.keys(evaluateOverlayPose(entry.pose, 0, entry.speed ?? 1))) {
      const part = bodyPartOf(bone);
      if (part && parts.has(part)) out.add(bone);
    }
  }
  return out;
}

export function composeAvatarAnimation(
  poses: readonly AvatarPose[],
  scene: SceneView,
  elapsedMs: number,
  runtimes: AnimationRuntimes,
): {poses: AvatarPose[]; runtimes: AnimationRuntimes} {
  const nextRuntimes: AnimationRuntimes = new Map();
  const out = poses.map(pose => {
    const avatar = scene.entities.find(e => e.id === pose.avatarId && e.kind === 'avatar');
    if (!avatar || avatar.kind !== 'avatar' || !avatar.animation) return pose;
    const animation = avatar.animation;
    const prev = runtimes.get(avatar.id) ?? {pins: {}};
    const key = overlayKey(animation.overlayingPoses);
    const targetBones = applyOverlayList(animation.overlayingPoses, elapsedMs);
    let transition = prev.transition;
    if (!transition || transition.key !== key) {
      transition = {from: prev.displayed ?? {}, startedAtMs: elapsedMs, key};
    }
    const span = animation.overlayTransitionSeconds * 1000;
    const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (elapsedMs - transition.startedAtMs) / span));
    const overlayBones = blendOverlayBones(transition.from, targetBones, t) as Record<string, OverlayBone>;

    const bones = {...pose.bones};
    for (const [name, bone] of Object.entries(overlayBones)) {
      const existing = bones[name];
      if (existing?.space === 'raw') continue;
      bones[name] = {
        rotation: bone.rotation,
        space: 'normalized',
        ...(existing?.weight !== undefined ? {weight: existing.weight} : {}),
      };
    }

    for (const side of ['left', 'right'] as const) {
      const hand = animation.overrideHandPoses[side];
      if (!hand?.enabled || hand.weight <= 0) continue;
      const fingers = evaluateHandPose(side, hand.pose);
      for (const [name, bone] of Object.entries(fingers)) {
        const tracked = bones[name];
        if (tracked && !hand.highPriority) continue;
        bones[name] = {
          rotation: tracked ? slerpQuat(tracked.rotation, bone.rotation, hand.weight) : bone.rotation,
          space: 'normalized',
          ...(tracked?.weight !== undefined ? {weight: tracked.weight} : {}),
        };
      }
    }

    type ArmMap = Record<string, {rotation: Quat; space: 'normalized'}>;
    const armOnly = Object.fromEntries(
      Object.entries(bones).filter(([name]) => /^(left|right)(Shoulder|UpperArm|LowerArm|Hand)$/.test(name)),
    ) as ArmMap;
    const overlayArms = Object.fromEntries(
      Object.entries(overlayBones).filter(([name]) => /^(left|right)(Shoulder|UpperArm|LowerArm|Hand)$/.test(name)),
    ) as ArmMap;
    const pinned = stepHandPin(prev.pins, animation.handPin, overlayArms, armOnly);
    for (const [name, bone] of Object.entries(pinned.armBones)) {
      bones[name] = {
        rotation: bone.rotation,
        space: 'normalized',
        ...(bones[name]?.weight !== undefined ? {weight: bones[name]!.weight} : {}),
      };
    }

    nextRuntimes.set(avatar.id, {
      pins: pinned.runtime,
      transition: t >= 1 ? {from: targetBones, startedAtMs: elapsedMs, key} : transition,
      displayed: overlayBones,
    });
    return {...pose, bones};
  });
  return {poses: out, runtimes: nextRuntimes};
}
