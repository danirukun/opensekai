import { CALIBRATION_BONES, type Quat, type TrackingCalibration, type TrackingSample } from '@opensekai/contracts';
import { multiplyQuat } from './bone-offsets';

const inverse = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const normalize = (q: Quat): Quat => { const length = Math.hypot(...q); return q.map(value => value / length) as Quat; };

// The neutral is each calibration bone of one sample, with its space.
export function captureCalibration(sample: TrackingSample): TrackingCalibration | null {
 const bones = Object.fromEntries(CALIBRATION_BONES.flatMap(name => {
  const bone = sample.bones[name];
  return bone ? [[name, { rotation: [...bone.rotation] as Quat, space: bone.space }]] : [];
 }));
 return Object.keys(bones).length ? { bones } : null;
}

// Each calibrated bone becomes inverse(neutral) × rotation, so the captured pose reads as identity.
export function applyCalibration(sample: TrackingSample, calibration: TrackingCalibration | undefined): TrackingSample {
 if (!calibration) return sample;
 const bones = structuredClone(sample.bones), neutral = calibration.bones;
 const calibrated = (name: keyof TrackingCalibration['bones'], rotation: Quat): Quat | null => {
  const saved = neutral[name], bone = sample.bones[name];
  return saved && bone && saved.space === bone.space ? normalize(multiplyQuat(inverse(saved.rotation), rotation)) : null;
 };
 for (const name of CALIBRATION_BONES) {
  const rotation = calibrated(name, sample.bones[name]?.rotation ?? [0, 0, 0, 1]);
  if (rotation) bones[name]!.rotation = rotation;
 }
 // A MediaPipe head is relative to its chest. Calibrate the composed face, then express it above the calibrated chest (R4).
 const { chest, head } = sample.bones, chestN = neutral.chest, headN = neutral.head;
 if (chest?.space === 'normalized' && head?.space === 'normalized' && chestN?.space === 'normalized' && headN?.space === 'normalized' && !sample.bones.neck && !sample.bones.upperChest) {
  const face = multiplyQuat(inverse(multiplyQuat(chestN.rotation, headN.rotation)), multiplyQuat(chest.rotation, head.rotation));
  bones.head!.rotation = normalize(multiplyQuat(inverse(bones.chest!.rotation), face));
 }
 return { ...sample, bones };
}
