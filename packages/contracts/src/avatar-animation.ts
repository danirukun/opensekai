import {z} from 'zod';
import {BODY_PARTS} from './tracking';

export const OVERLAY_POSE_IDS = ['rest', 'selfie', 'wave', 'mic', 'controller'] as const;
export type OverlayPoseId = (typeof OVERLAY_POSE_IDS)[number];

export const HAND_POSE_IDS = [
  'open', 'fist', 'grab', 'hangLoose', 'hold1', 'hold2', 'idle', 'okayDokey', 'peace',
  'pinch1', 'pinch2', 'pistolGrip', 'point1', 'point2', 'rockOn', 'scoop', 'scratch',
  'screwYou', 'splayedOut', 'thumbsUp',
] as const;
export type HandPoseId = (typeof HAND_POSE_IDS)[number];

export const MAX_OVERLAY_POSES = 8;

const n = z.number().finite();
const id = z.string().min(1).max(256);

export interface OverlayPosePresetEntry {
  id: string;
  pose: OverlayPoseId;
  maskedBodyParts: Array<(typeof BODY_PARTS)[number]>;
  weight: number;
  speed?: number;
}

export interface OverlayClipEntry {
  id: string;
  kind: 'clip';
  assetId: string;
  maskedBodyParts: Array<(typeof BODY_PARTS)[number]>;
  weight: number;
  speed?: number;
}

export type OverlayPoseEntry = OverlayPosePresetEntry | OverlayClipEntry;

export const isOverlayClipEntry = (entry: OverlayPoseEntry): entry is OverlayClipEntry =>
  'kind' in entry && entry.kind === 'clip';

export interface HandOverride {
  enabled: boolean;
  pose: HandPoseId;
  weight: number;
  highPriority: boolean;
}

export interface HandPin {
  enabled: boolean;
  mode: 'preset' | 'hold';
}

export interface AvatarAnimation {
  overlayingPoses: OverlayPoseEntry[];
  overlayTransitionSeconds: number;
  overrideHandPoses: {left?: HandOverride; right?: HandOverride};
  handPin: {left?: HandPin; right?: HandPin};
}

export const DEFAULT_AVATAR_ANIMATION: Readonly<AvatarAnimation> = Object.freeze({
  overlayingPoses: Object.freeze([]) as unknown as OverlayPoseEntry[],
  overlayTransitionSeconds: 1,
  overrideHandPoses: Object.freeze({}),
  handPin: Object.freeze({}),
});

const maskedBodyParts = z.array(z.enum(BODY_PARTS)).max(BODY_PARTS.length).refine(v => new Set(v).size === v.length);
const overlayWeight = n.min(0).max(1);
const overlaySpeed = n.min(0).max(4).optional();

export const OverlayPosePresetEntrySchema = z.strictObject({
  id,
  pose: z.enum(OVERLAY_POSE_IDS),
  maskedBodyParts,
  weight: overlayWeight,
  speed: overlaySpeed,
});

export const OverlayClipEntrySchema = z.strictObject({
  id,
  kind: z.literal('clip'),
  assetId: id,
  maskedBodyParts,
  weight: overlayWeight,
  speed: overlaySpeed,
});

export const OverlayPoseEntrySchema = z.union([OverlayClipEntrySchema, OverlayPosePresetEntrySchema]);

export const HandOverrideSchema = z.strictObject({
  enabled: z.boolean(),
  pose: z.enum(HAND_POSE_IDS),
  weight: n.min(0).max(1),
  highPriority: z.boolean(),
});

export const HandPinSchema = z.strictObject({
  enabled: z.boolean(),
  mode: z.enum(['preset', 'hold']),
});

export const AvatarAnimationSchema = z.strictObject({
  overlayingPoses: z.array(OverlayPoseEntrySchema).max(MAX_OVERLAY_POSES)
    .refine(v => new Set(v.map(e => e.id)).size === v.length),
  overlayTransitionSeconds: n.min(0).max(5),
  overrideHandPoses: z.strictObject({
    left: HandOverrideSchema.optional(),
    right: HandOverrideSchema.optional(),
  }),
  handPin: z.strictObject({
    left: HandPinSchema.optional(),
    right: HandPinSchema.optional(),
  }),
});
