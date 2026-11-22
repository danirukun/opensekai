import type {BodyPart, OverlayPoseId, Quat} from '@opensekai/contracts';
import {bodyPartOf} from '@opensekai/contracts';
import {eulerToQuat, IDENTITY, slerpQuat} from './bone-offsets';

export type OverlayBone = {rotation: Quat; space: 'normalized'};
type BoneMap = Readonly<Record<string, OverlayBone>>;

const deg = (x: number, y: number, z: number): Quat => eulerToQuat([x, y, z]);

const armBones = (left: [number, number, number][], right: [number, number, number][]): BoneMap => {
  const names = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const;
  const out: Record<string, OverlayBone> = {};
  for (let i = 0; i < names.length; i++) {
    const L = left[i] ?? [0, 0, 0];
    const R = right[i] ?? [0, 0, 0];
    out[`left${names[i]}`] = {space: 'normalized', rotation: deg(L[0]!, L[1]!, L[2]!)};
    out[`right${names[i]}`] = {space: 'normalized', rotation: deg(R[0]!, R[1]!, R[2]!)};
  }
  return out;
};

const REST = armBones(
  [[0, 0, -8], [0, 0, -55], [0, 0, -10], [0, 0, 0]],
  [[0, 0, 8], [0, 0, 55], [0, 0, 10], [0, 0, 0]],
);

const SELFIE = armBones(
  [[10, 20, -20], [40, 35, -70], [-20, 10, -50], [0, -20, -15]],
  [[15, -45, 25], [55, -60, 40], [-30, -20, 60], [10, 30, 20]],
);

const MIC = armBones(
  [[5, 5, -15], [20, 10, -40], [-10, 0, -25], [0, 0, 0]],
  [[10, -25, 20], [45, -50, 35], [-40, -15, 55], [5, 15, 10]],
);

const CONTROLLER = armBones(
  [[5, 15, -25], [35, 25, -55], [-25, 5, -40], [0, -10, -5]],
  [[5, -15, 25], [35, -25, 55], [-25, -5, 40], [0, 10, 5]],
);

const held = (pose: Exclude<OverlayPoseId, 'wave'>): BoneMap =>
  ({rest: REST, selfie: SELFIE, mic: MIC, controller: CONTROLLER})[pose];

export function evaluateOverlayPose(pose: OverlayPoseId, elapsedMs: number, speed = 1): BoneMap {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('Animation time must be finite and nonnegative');
  if (pose !== 'wave') return held(pose);
  const rate = Number.isFinite(speed) ? Math.max(0, speed) : 1;
  const phase = (elapsedMs * rate) % 1200 / 1200 * 2 * Math.PI;
  const swing = Math.sin(phase) * 35;
  const flap = Math.cos(phase) * 15;
  return armBones(
    [[0, 0, -8], [0, 0, -50], [0, 0, -8], [0, 0, 0]],
    [[10, -10, 15], [20 + flap, -40, 70 + swing], [-20, -10, 40], [0, 15, 10]],
  );
}

export function blendOverlayBones(from: BoneMap, to: BoneMap, t: number): BoneMap {
  const k = Math.min(1, Math.max(0, t));
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const out: Record<string, OverlayBone> = {};
  for (const bone of keys) {
    const a = from[bone]?.rotation ?? IDENTITY;
    const b = to[bone]?.rotation ?? IDENTITY;
    out[bone] = {space: 'normalized', rotation: slerpQuat(a, b, k)};
  }
  return out;
}

export function maskOverlayBones(bones: BoneMap, maskedBodyParts: readonly BodyPart[]): BoneMap {
  if (maskedBodyParts.length === 0) return bones;
  const allow = new Set(maskedBodyParts);
  return Object.fromEntries(Object.entries(bones).filter(([name]) => {
    const part = bodyPartOf(name);
    return part !== null && allow.has(part);
  }));
}

export function overlayAsTrackingBones(bones: BoneMap): Record<string, {rotation: Quat; space: 'normalized'}> {
  return Object.fromEntries(Object.entries(bones).map(([name, bone]) => [name, {rotation: bone.rotation, space: 'normalized' as const}]));
}
