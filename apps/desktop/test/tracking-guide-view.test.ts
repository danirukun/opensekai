import { expect, it } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, TRACKING_PRESETS, type TrackingMapping, type TrackingProbe } from '@opensekai/contracts';
import { initialGuide, type GuideState } from '../src/editor/tracking-guide';
import { groupLevel, relaxSecondsLeft, stepProgress, waitsForNext } from '../src/editor/tracking-guide-view';

const preset = TRACKING_PRESETS[0]!;
const probe = (over: Partial<TrackingProbe> = {}): TrackingProbe => ({ sourceId: 'src', generation: 1, state: 'receiving', values: {}, peaks: {}, presentChannels: [], eyeBones: false, ...over });
const at = (over: Partial<GuideState>): GuideState => ({ ...initialGuide(), preset, sourceId: 'src', ...over });

it('counts the relax seconds down from 3 to 0', () => {
 const s = at({ step: 'relax', relaxStartMs: 1000 });
 expect(relaxSecondsLeft(s, 1000)).toBe(3);
 expect(relaxSecondsLeft(s, 2500)).toBe(2);
 expect(relaxSecondsLeft(s, 3999)).toBe(1);
 expect(relaxSecondsLeft(s, 4000)).toBe(0);
 expect(relaxSecondsLeft(s, 9000)).toBe(0);
});

it('fills the step progress only while the risen peak holds', () => {
 const s = at({ step: 'expressions', index: 1, neutral: { jawOpen: 0.02 }, stepPeak: 0.03, lastRiseMs: 5000 });
 expect(stepProgress(s, 5500)).toBe(0);
 const risen = { ...s, stepPeak: 0.2 };
 expect(stepProgress(risen, 5000)).toBe(0);
 expect(stepProgress(risen, 5500)).toBeCloseTo(0.5);
 expect(stepProgress(risen, 7000)).toBe(1);
 expect(stepProgress({ ...risen, step: 'relax' }, 5500)).toBe(0);
});

it('waits for next on lookAround when the sender gives eye bones and no eyeLook channel', () => {
 const look = at({ step: 'expressions', index: preset.steps.indexOf('lookAround'), previous: probe({ eyeBones: true, presentChannels: ['jawOpen'] }) });
 expect(waitsForNext(look)).toBe(true);
 expect(waitsForNext({ ...look, previous: probe({ eyeBones: true, presentChannels: ['eyeLookInLeft'] }) })).toBe(false);
 expect(waitsForNext({ ...look, index: 0 })).toBe(false);
});

it('maps a group level through the source ranges and sensitivity', () => {
 const mapping: TrackingMapping = { ...structuredClone(DEFAULT_TRACKING_MAPPING), blendShapes: { jawOpen: { inputMin: 0.02, inputMax: 0.17, outputMin: 0, outputMax: 1 } } };
 expect(groupLevel({ jawOpen: 0.17 }, ['jawOpen'], mapping)).toBeCloseTo(1);
 expect(groupLevel({ jawOpen: 0.095 }, ['jawOpen'], mapping)).toBeCloseTo(0.5);
 expect(groupLevel({ eyeBlinkLeft: 0.3, eyeBlinkRight: 0.6 }, ['eyeBlinkLeft', 'eyeBlinkRight'], mapping)).toBeCloseTo(0.6);
 expect(groupLevel({ eyeBlinkLeft: 0.6 }, ['eyeBlinkLeft'], { ...mapping, blendShapeSensitivity: 2 })).toBe(1);
 expect(groupLevel({}, ['browInnerUp'], undefined)).toBe(0);
});
