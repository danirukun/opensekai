import {
  BODY_PARTS,
  DEFAULT_AVATAR_ANIMATION,
  DEFAULT_OVERLAY_MASK,
  HAND_POSE_IDS,
  isOverlayClipEntry,
  MAX_OVERLAY_POSES,
  OVERLAY_POSE_IDS,
  type AvatarAnimation,
  type BodyPart,
  type HandOverride,
  type HandPin,
  type HandPoseId,
  type OverlayClipEntry,
  type OverlayPoseEntry,
  type OverlayPoseId,
  type OverlayPosePresetEntry,
} from '@opensekai/contracts';

export const overlayPoseOptions = OVERLAY_POSE_IDS.map(value => ({value, label: value[0]!.toUpperCase() + value.slice(1)}));
export const handPoseOptions = HAND_POSE_IDS.map(value => ({value, label: value}));
export const handSideLabels = {left: 'Left Hand', right: 'Right Hand'} as const;

// Plain copies: entity.animation can be a Svelte state proxy, which structuredClone rejects.
const plainHand = (hand: HandOverride): HandOverride => ({enabled: hand.enabled, pose: hand.pose, weight: hand.weight, highPriority: hand.highPriority});
const plainPin = (pin: HandPin): HandPin => ({enabled: pin.enabled, mode: pin.mode});
const plainOverlay = (entry: OverlayPoseEntry): OverlayPoseEntry => {
  if (isOverlayClipEntry(entry)) {
    return {
      id: entry.id,
      kind: 'clip',
      assetId: entry.assetId,
      weight: entry.weight,
      maskedBodyParts: [...entry.maskedBodyParts],
      ...(entry.speed !== undefined ? {speed: entry.speed} : {}),
    };
  }
  return {
    id: entry.id,
    pose: entry.pose,
    weight: entry.weight,
    maskedBodyParts: [...entry.maskedBodyParts],
    ...(entry.speed !== undefined ? {speed: entry.speed} : {}),
  };
};

export const animationOf = (animation: AvatarAnimation | undefined): AvatarAnimation => {
  const source = animation ?? DEFAULT_AVATAR_ANIMATION;
  return {
    overlayingPoses: source.overlayingPoses.map(plainOverlay),
    overlayTransitionSeconds: source.overlayTransitionSeconds,
    overrideHandPoses: {
      ...(source.overrideHandPoses.left ? {left: plainHand(source.overrideHandPoses.left)} : {}),
      ...(source.overrideHandPoses.right ? {right: plainHand(source.overrideHandPoses.right)} : {}),
    },
    handPin: {
      ...(source.handPin.left ? {left: plainPin(source.handPin.left)} : {}),
      ...(source.handPin.right ? {right: plainPin(source.handPin.right)} : {}),
    },
  };
};

export const defaultHandOverride = (): HandOverride => ({enabled: false, pose: 'open', weight: 1, highPriority: true});
export const defaultHandPin = (): HandPin => ({enabled: false, mode: 'hold'});

export function newOverlayEntry(existing: readonly OverlayPoseEntry[]): OverlayPosePresetEntry | null {
  if (existing.length >= MAX_OVERLAY_POSES) return null;
  let n = 1;
  while (existing.some(entry => entry.id === `overlay-${n}`)) n += 1;
  return {id: `overlay-${n}`, pose: 'rest', weight: 1, maskedBodyParts: [...DEFAULT_OVERLAY_MASK]};
}

export const withOverlayPose = (animation: AvatarAnimation, entryId: string, pose: OverlayPoseId): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.map(entry => {
    if (entry.id !== entryId) return entry;
    const next: OverlayPosePresetEntry = {
      id: entry.id,
      pose,
      weight: entry.weight,
      maskedBodyParts: [...entry.maskedBodyParts],
      ...(entry.speed !== undefined ? {speed: entry.speed} : {}),
    };
    return next;
  }),
});

export const withOverlayClip = (animation: AvatarAnimation, entryId: string, assetId: string): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.map(entry => {
    if (entry.id !== entryId) return entry;
    const next: OverlayClipEntry = {
      id: entry.id,
      kind: 'clip',
      assetId,
      weight: entry.weight,
      maskedBodyParts: [...entry.maskedBodyParts],
      ...(entry.speed !== undefined ? {speed: entry.speed} : {speed: 1}),
    };
    return next;
  }),
});

export const withOverlayWeight = (animation: AvatarAnimation, entryId: string, weight: number): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.map(entry => entry.id === entryId ? {...entry, weight} : entry),
});

export const withOverlaySpeed = (animation: AvatarAnimation, entryId: string, speed: number): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.map(entry => entry.id === entryId ? {...entry, speed} : entry),
});

export const withOverlayPart = (animation: AvatarAnimation, entryId: string, part: BodyPart, on: boolean): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.map(entry => {
    if (entry.id !== entryId) return entry;
    const parts = new Set(entry.maskedBodyParts);
    if (on) parts.add(part); else parts.delete(part);
    return {...entry, maskedBodyParts: BODY_PARTS.filter(item => parts.has(item))};
  }),
});

export const removeOverlay = (animation: AvatarAnimation, entryId: string): AvatarAnimation => ({
  ...animation,
  overlayingPoses: animation.overlayingPoses.filter(entry => entry.id !== entryId),
});

export const moveOverlay = (animation: AvatarAnimation, entryId: string, delta: -1 | 1): AvatarAnimation => {
  const index = animation.overlayingPoses.findIndex(entry => entry.id === entryId);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= animation.overlayingPoses.length) return animation;
  const overlayingPoses = [...animation.overlayingPoses];
  const [item] = overlayingPoses.splice(index, 1);
  overlayingPoses.splice(next, 0, item!);
  return {...animation, overlayingPoses};
};

export const withHandOverride = (animation: AvatarAnimation, side: 'left' | 'right', change: Partial<HandOverride>): AvatarAnimation => {
  const current = animation.overrideHandPoses[side] ?? defaultHandOverride();
  return {...animation, overrideHandPoses: {...animation.overrideHandPoses, [side]: {...current, ...change}}};
};

export const withHandPin = (animation: AvatarAnimation, side: 'left' | 'right', change: Partial<HandPin>): AvatarAnimation => {
  const current = animation.handPin[side] ?? defaultHandPin();
  return {...animation, handPin: {...animation.handPin, [side]: {...current, ...change}}};
};

export const isHandPoseId = (value: string): value is HandPoseId => (HAND_POSE_IDS as readonly string[]).includes(value);
export const isOverlayPoseId = (value: string): value is OverlayPoseId => (OVERLAY_POSE_IDS as readonly string[]).includes(value);
export {isOverlayClipEntry};
