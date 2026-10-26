import { canonicalArkitName, type Quat, type TrackingSample } from '@opensekai/contracts';
import { eulerToQuat, quatToEuler } from './bone-offsets';

export const EYE_MAX_DEGREES = { horizontal: 20, vertical: 15 } as const;
type Side = 'left' | 'right';
type EyeLook = { in: number; out: number; up: number; down: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const DIRECTIONS = ['In', 'Out', 'Up', 'Down'] as const;
const channel = (direction: typeof DIRECTIONS[number], side: Side) => `eyeLook${direction}${side === 'left' ? 'Left' : 'Right'}`;
const EYE_LOOK_NAMES = new Set((['left', 'right'] as const).flatMap(side => DIRECTIONS.map(direction => channel(direction, side))));
const isEyeLook = (name: string) => EYE_LOOK_NAMES.has(canonicalArkitName(name) ?? '');
const SIDES = [['left', 'leftEye'], ['right', 'rightEye']] as const;

// Eye bones are already scaled by eyeIntensity in applyMapping; this step scales only eyeLook values that it keeps or converts.
// Yaw is positive toward the character's left (+Y rotation of a character that faces +Z). Pitch is positive upward, so it is a negative X rotation.
export function eyeLookToRotation(values: EyeLook, side: Side): Quat {
 const sign = side === 'left' ? 1 : -1;
 const yaw = (values.out - values.in) * sign * EYE_MAX_DEGREES.horizontal;
 const pitch = (values.up - values.down) * EYE_MAX_DEGREES.vertical;
 return eulerToQuat([-pitch, yaw, 0]);
}

export function rotationToEyeLook(rotation: Quat, side: Side): EyeLook {
 const [pitchX, yaw] = quatToEuler(rotation);
 const h = clamp(yaw / EYE_MAX_DEGREES.horizontal, -1, 1) * (side === 'left' ? 1 : -1);
 const v = clamp(-pitchX / EYE_MAX_DEGREES.vertical, -1, 1);
 return { out: Math.max(0, h), in: Math.max(0, -h), up: Math.max(0, v), down: Math.max(0, -v) };
}

export function applyEyeMovement(sample: TrackingSample, useEyeBones: boolean, eyeIntensity = 1): TrackingSample {
 const hasBones = SIDES.some(([, bone]) => sample.bones[bone]);
 const lookEntries = Object.entries(sample.expressions).filter(([name]) => isEyeLook(name));
 if (!hasBones && lookEntries.length === 0) return sample;
 const { leftEye, rightEye, ...otherBones } = sample.bones;
 const withoutLook = Object.fromEntries(Object.entries(sample.expressions).filter(([name]) => !isEyeLook(name)));
 if (useEyeBones) {
  if (hasBones) return { ...sample, expressions: withoutLook };
  const value = (direction: typeof DIRECTIONS[number], side: Side) =>
   eyeIntensity * Math.max(0, ...lookEntries.filter(([name]) => canonicalArkitName(name) === channel(direction, side)).map(([, v]) => v));
  const bones = { ...otherBones };
  for (const [side, bone] of SIDES) {
   const values = { in: value('In', side), out: value('Out', side), up: value('Up', side), down: value('Down', side) };
   bones[bone] = { rotation: eyeLookToRotation(values, side), space: 'normalized' };
  }
  return { ...sample, bones, expressions: withoutLook };
 }
 if (lookEntries.length > 0) {
  const scaled = Object.fromEntries(Object.entries(sample.expressions).map(([name, v]) => [name, isEyeLook(name) ? clamp(v * eyeIntensity, 0, 1) : v]));
  return { ...sample, bones: otherBones, expressions: scaled };
 }
 const expressions = { ...sample.expressions };
 for (const [side, bone] of SIDES) {
  const eye = sample.bones[bone];
  if (!eye) continue;
  const values = rotationToEyeLook(eye.rotation, side);
  for (const direction of DIRECTIONS) expressions[channel(direction, side)] = clamp(values[direction.toLowerCase() as keyof EyeLook], 0, 1);
 }
 return { ...sample, bones: otherBones, expressions };
}
