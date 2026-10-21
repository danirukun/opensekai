import { canonicalArkitName, type Quat, type TrackingMapping, type TrackingSample } from '@opensekai/contracts';
import { eulerToQuat, multiplyQuat } from './bone-offsets';
import { applyEyeMovement } from './eye-movement';

const clamp = (value: number) => Math.min(1, Math.max(0, value));

// Scales the angle of q about its own axis. It starts from the shortest arc; a scaled angle above 180° keeps the axis.
export function scaleRotation(q: Quat, factor: number): Quat {
 const sign = q[3] < 0 ? -1 : 1, half = Math.acos(Math.min(1, Math.max(-1, q[3] * sign)));
 if (half < .000001) return [0, 0, 0, 1];
 const s = Math.sin(half * factor) / Math.sin(half);
 return [q[0] * sign * s, q[1] * sign * s, q[2] * sign * s, Math.cos(half * factor)];
}

export function applyMapping(sample: TrackingSample, mapping: TrackingMapping | undefined): TrackingSample {
 if (!mapping) return applyEyeMovement(sample, true);
 const bones = structuredClone(sample.bones);
 const { head } = bones;
 if (head) {
  const scaled = mapping.headIntensity === 1 ? head.rotation : scaleRotation(head.rotation, mapping.headIntensity);
  head.rotation = mapping.headOffset.every(value => value === 0) ? scaled : multiplyQuat(eulerToQuat(mapping.headOffset), scaled);
 }
 if (mapping.eyeIntensity !== 1) for (const name of ['leftEye', 'rightEye']) { const eye = bones[name]; if (eye) eye.rotation = scaleRotation(eye.rotation, mapping.eyeIntensity); }
 const ranges = new Map(Object.entries(mapping.blendShapes));
 const expressions = Object.fromEntries(Object.entries(sample.expressions).map(([name, value]) => {
  const range = ranges.get(canonicalArkitName(name) ?? '');
  const mapped = range ? range.outputMin + clamp((value - range.inputMin) / (range.inputMax - range.inputMin)) * (range.outputMax - range.outputMin) : value;
  return [name, clamp(mapped * mapping.blendShapeSensitivity)];
 }));
 if (mapping.linkedBlink) {
  // A sender can send two names for one channel (eyeBlink_L and eyeBlinkLeft); link each of them.
  const blinks = Object.keys(expressions).filter(name => ['eyeBlinkLeft', 'eyeBlinkRight'].includes(canonicalArkitName(name) ?? ''));
  if (new Set(blinks.map(canonicalArkitName)).size === 2) { const value = Math.max(...blinks.map(name => expressions[name]!)); for (const name of blinks) expressions[name] = value; }
 }
 return applyEyeMovement({ ...sample, bones, expressions }, mapping.useEyeBones ?? true);
}
