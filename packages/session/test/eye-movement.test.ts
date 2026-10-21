import { expect, it } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, TrackingMappingSchema, type Quat, type TrackingSample } from '@opensekai/contracts';
import { eulerToQuat, quatToEuler } from '../src/bone-offsets';
import { applyEyeMovement, eyeLookToRotation, rotationToEyeLook } from '../src/eye-movement';
import { applyMapping } from '../src/tracking-mapping';

// A positive yaw about +Y turns a character that faces +Z to its left.
const LEFT_SIGN = 1;
const eyeQuat = (yawLeft: number, pitchUp: number): Quat => eulerToQuat([-pitchUp, yawLeft * LEFT_SIGN, 0]);
const eye = (yawLeft: number, pitchUp: number) => ({ rotation: eyeQuat(yawLeft, pitchUp), space: 'normalized' as const });
const yawDegrees = (q: Quat) => quatToEuler(q)[1];
const sample = (extra: Partial<TrackingSample>): TrackingSample => ({ sourceId: 'face', generation: 1, receivedAtMs: 0, bones: {}, expressions: {}, ...extra });
const look = { in: 0, out: 0, up: 0, down: 0 };

it('bones mode drops eyeLook channels when the sample has eye bones', () => {
 const out = applyEyeMovement(sample({ bones: { leftEye: eye(10, 0), rightEye: eye(10, 0) }, expressions: { eyeLookOutLeft: .5, jawOpen: .3 } }), true);
 expect(out.expressions).toEqual({ jawOpen: .3 });
 expect(out.bones.leftEye).toBeDefined();
});
it('bones mode converts eyeLook into eye bones when the sample has no eye bones', () => {
 const out = applyEyeMovement(sample({ expressions: { eyeLookOutLeft: 1, eyeLookInRight: 1 } }), true);
 expect(yawDegrees(out.bones.leftEye!.rotation)).toBeCloseTo(20 * LEFT_SIGN, 3);
 expect(yawDegrees(out.bones.rightEye!.rotation)).toBeCloseTo(20 * LEFT_SIGN, 3);
 expect(out.bones.leftEye!.space).toBe('normalized');
 expect(out.expressions.eyeLookOutLeft).toBeUndefined();
});
it('bones mode matches sender names with underscores', () => {
 const out = applyEyeMovement(sample({ expressions: { eyeLookOut_L: 1, eyeLookIn_R: 1 } }), true);
 expect(yawDegrees(out.bones.leftEye!.rotation)).toBeCloseTo(20, 3);
 expect(Object.keys(out.expressions)).toEqual([]);
});
it('blend shape mode converts eye bones into eyeLook and drops the bones', () => {
 const out = applyEyeMovement(sample({ bones: { leftEye: eye(0, 15), rightEye: eye(0, 15) } }), false);
 expect(out.expressions.eyeLookUpLeft).toBeCloseTo(1, 3);
 expect(out.expressions.eyeLookUpRight).toBeCloseTo(1, 3);
 expect(out.bones.leftEye).toBeUndefined();
 expect(out.bones.rightEye).toBeUndefined();
});
it('blend shape mode keeps sent eyeLook and drops the bones', () => {
 const out = applyEyeMovement(sample({ bones: { leftEye: eye(10, 0) }, expressions: { eyeLookOutLeft: .4 } }), false);
 expect(out.expressions).toEqual({ eyeLookOutLeft: .4 });
 expect(out.bones.leftEye).toBeUndefined();
});
it('leaves a sample without eye data and other bones untouched', () => {
 const input = sample({ bones: { head: eye(5, 0) }, expressions: { jawOpen: .3 } });
 expect(applyEyeMovement(input, true)).toBe(input);
 expect(applyEyeMovement(input, false)).toBe(input);
});
it('the conversion clamps past the maximum angle', () => {
 expect(rotationToEyeLook(eyeQuat(40, 0), 'left').out).toBe(1);
 expect(rotationToEyeLook(eyeQuat(-40, 0), 'left').in).toBe(1);
 expect(rotationToEyeLook(eyeQuat(0, -40), 'right').down).toBe(1);
});
it('round trips for both eyes', () => {
 for (const side of ['left', 'right'] as const) for (const values of [{ ...look, in: .5 }, { ...look, down: .25 }, { ...look, out: .75, up: .5 }]) {
  const back = rotationToEyeLook(eyeLookToRotation(values, side), side);
  for (const key of ['in', 'out', 'up', 'down'] as const) expect(back[key]).toBeCloseTo(values[key], 4);
 }
});
it('applyMapping with no mapping applies the eye rule with useEyeBones true', () => {
 const out = applyMapping(sample({ expressions: { eyeLookOutLeft: 1 } }), undefined);
 expect(out.bones.leftEye).toBeDefined();
 expect(out.expressions).toEqual({});
});
it('applyMapping applies the eye intensity once, before the bones become eyeLook', () => {
 const input = sample({ bones: { leftEye: eye(20, 0) } });
 const out = applyMapping(input, { ...DEFAULT_TRACKING_MAPPING, eyeIntensity: .5, useEyeBones: false });
 expect(out.expressions.eyeLookOutLeft).toBeCloseTo(.5, 3);
 expect(out.bones.leftEye).toBeUndefined();
});
it('a mapping without useEyeBones parses and reads as true', () => {
 const parsed = TrackingMappingSchema.parse(DEFAULT_TRACKING_MAPPING);
 expect(parsed.useEyeBones).toBeUndefined();
 expect(parsed.useEyeBones ?? true).toBe(true);
 expect(TrackingMappingSchema.parse({ ...DEFAULT_TRACKING_MAPPING, useEyeBones: false }).useEyeBones).toBe(false);
});
