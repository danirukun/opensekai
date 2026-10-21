import { expect, it } from 'vitest';
import { TRACKING_PRESETS, type ArkitName, type TrackingProbe } from '@opensekai/contracts';
import { guideStep, initialGuide, mainValue, type GuideEffect, type GuideEvent, type GuideState } from '../src/editor/tracking-guide';

const selfReflect = TRACKING_PRESETS[0]!;
const ifacial = TRACKING_PRESETS[1]!;
const ALL: ArkitName[] = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'cheekPuff', 'tongueOut', 'eyeLookUpLeft', 'eyeLookInLeft'];

const probe = (values: Partial<Record<ArkitName, number>> = {}, over: Partial<TrackingProbe> = {}): TrackingProbe => ({ sourceId: 'src', generation: 1, state: 'receiving', values, peaks: {}, presentChannels: ALL, eyeBones: false, ...over });
const ev = (p: TrackingProbe, nowMs: number): GuideEvent => ({ kind: 'probe', probe: p, nowMs });

function run(state: GuideState, events: GuideEvent[]) {
 const effects: GuideEffect[] = [];
 for (const event of events) { const out = guideStep(state, event); state = out.state; effects.push(...out.effects); }
 return { state, effects };
}
const toRelax = (preset = selfReflect) => run(initialGuide(), [{ kind: 'pick', preset }, { kind: 'connected', sourceId: 'src' }, ev(probe(), 1000)]).state;
const toExpressions = (neutral: Partial<Record<ArkitName, number>> = {}, preset = selfReflect) => {
 const out = run(toRelax(preset), [ev(probe(neutral), 4000)]);
 return { state: out.state, effects: out.effects };
};

it('pick emits connect; connected then a receiving probe enters relax', () => {
 const a = guideStep(initialGuide(), { kind: 'pick', preset: selfReflect });
 expect(a.state.step).toBe('connect');
 expect(a.effects).toEqual([{ kind: 'connect', preset: selfReflect }]);
 const b = guideStep(a.state, { kind: 'connected', sourceId: 'src' });
 expect(b.state.step).toBe('connect');
 expect(b.state.sourceId).toBe('src');
 const c = guideStep(b.state, ev(probe(), 500));
 expect(c.state.step).toBe('relax');
 expect(c.state.relaxStartMs).toBe(500);
});

it('connect waits until the probe state is receiving', () => {
 let s = run(initialGuide(), [{ kind: 'pick', preset: selfReflect }, { kind: 'connected', sourceId: 'src' }]).state;
 for (const state of ['waiting', 'stale', 'stopped', 'error'] as const) s = guideStep(s, ev(probe({}, { state }), 10)).state;
 expect(s.step).toBe('connect');
 s = guideStep(s, ev(probe({}, { sourceId: 'other' }), 20)).state;
 expect(s.step).toBe('connect');
});

it('relax captures probe.values as neutral at 3000 ms and emits resetPeaks', () => {
 let s = toRelax();
 s = guideStep(s, ev(probe({ jawOpen: 0.9 }), 3999)).state;
 expect(s.step).toBe('relax');
 const out = guideStep(s, ev(probe({ jawOpen: 0.1 }), 4000));
 expect(out.state.step).toBe('expressions');
 expect(out.state.neutral).toEqual({ jawOpen: 0.1 });
 expect(out.effects).toEqual([{ kind: 'resetPeaks' }]);
});

it('relax with iFacialMocap also emits calibrate', () => {
 const out = toExpressions({}, ifacial);
 expect(out.effects).toEqual([{ kind: 'resetPeaks' }, { kind: 'calibrate' }]);
});

it('relax does not capture while the probe is stale; it captures at the first receiving probe after 3000 ms', () => {
 let r = run(toRelax(), [ev(probe({}, { state: 'stale' }), 4000), ev(probe({}, { state: 'stale' }), 5000)]);
 expect(r.state.step).toBe('relax');
 expect(r.effects).toEqual([]);
 r = run(r.state, [ev(probe({ jawOpen: 0.2 }), 6000)]);
 expect(r.state.step).toBe('expressions');
 expect(r.state.neutral).toEqual({ jawOpen: 0.2 });
});

it('a step is done 1000 ms after the peak stops rising above neutral + .05', () => {
 const blink = (v: number, t: number) => ev(probe({ eyeBlinkLeft: v }), t);
 let s = toExpressions().state;
 s = run(s, [blink(0, 4100), blink(0.5, 4200), blink(0.8, 4300)]).state;
 expect(s.index).toBe(0);
 s = guideStep(s, blink(0.8, 5299)).state;
 expect(s.index).toBe(0);
 s = guideStep(s, blink(0.8, 5300)).state;
 expect(s.results.blink).toBe('done');
 expect(s.index).toBe(1);
});

it('a step that never rises above neutral + .05 is not done', () => {
 let s = toExpressions({ eyeBlinkLeft: 0.1 }).state;
 s = run(s, [ev(probe({ eyeBlinkLeft: 0.12 }), 4100), ev(probe({ eyeBlinkLeft: 0.14 }), 4200), ev(probe({ eyeBlinkLeft: 0.14 }), 9000)]).state;
 expect(s.index).toBe(0);
});

it('a step whose main channels are absent from presentChannels is notSent at once', () => {
 const present = ALL.filter(n => n !== 'jawOpen');
 const { state } = toExpressions();
 const s = run(state, [ev(probe({}, { presentChannels: present }), 4100)]).state;
 expect(s.results.blink).toBeUndefined();
 const s2 = run(state, [ev(probe({ eyeBlinkLeft: 0.9 }, { presentChannels: present }), 4100), ev(probe({ eyeBlinkLeft: 0.9 }, { presentChannels: present }), 5200)]).state;
 expect(s2.results).toEqual({ blink: 'done', mouthWide: 'notSent' });
 expect(s2.index).toBe(2);
});

it('a step whose main value is unchanged for 4000 ms while another channel changes is notSent', () => {
 let s = toExpressions().state;
 const p = (other: number, t: number) => ev(probe({ eyeBlinkLeft: 0, jawOpen: other }), t);
 s = run(s, [p(0, 4100), p(0.1, 5000), p(0.2, 7000), p(0.3, 7999)]).state;
 expect(s.index).toBe(0);
 s = guideStep(s, p(0.4, 8000)).state;
 expect(s.results.blink).toBe('notSent');
 expect(s.index).toBe(1);
});

it('a step whose main value is unchanged while no channel changes stays open', () => {
 let s = toExpressions().state;
 s = run(s, [ev(probe({ eyeBlinkLeft: 0.02 }), 4100), ev(probe({ eyeBlinkLeft: 0.02 }), 20000)]).state;
 expect(s.index).toBe(0);
 expect(s.results).toEqual({});
});

it('next skips a step', () => {
 const s = run(toExpressions().state, [ev(probe(), 4100), { kind: 'next', nowMs: 4200 }]).state;
 expect(s.results.blink).toBe('skipped');
 expect(s.index).toBe(1);
});

const toLook = () => {
 let s = toExpressions().state;
 for (let i = 0; i < 8; i++) s = guideStep(s, { kind: 'next', nowMs: 4100 + i }).state;
 return s;
};

it('lookAround with only eye bones waits for next; with neither eyeLook nor eye bones it is notSent', () => {
 const noLook = ALL.filter(n => !n.startsWith('eyeLook'));
 const bones = run(toLook(), [ev(probe({}, { presentChannels: noLook, eyeBones: true }), 5000), ev(probe({}, { presentChannels: noLook, eyeBones: true }), 30000)]);
 expect(bones.state.index).toBe(8);
 expect(bones.state.step).toBe('expressions');
 expect(bones.effects).toEqual([]);
 const after = guideStep(bones.state, { kind: 'next', nowMs: 31000 });
 expect(after.state.results.lookAround).toBe('skipped');
 expect(after.effects).toEqual([{ kind: 'fit', neutral: {} }]);
 const neither = run(toLook(), [ev(probe({}, { presentChannels: noLook, eyeBones: false }), 5000)]);
 expect(neither.state.results.lookAround).toBe('notSent');
 expect(neither.effects).toEqual([{ kind: 'fit', neutral: {} }]);
});

it('after the last step: emits fit with neutral; fitted enters review; fitFailed enters review with fitError', () => {
 const out = run(toExpressions({ jawOpen: 0.1 }).state, [ev(probe(), 4100), ...Array.from({ length: 9 }, (_, i): GuideEvent => ({ kind: 'next', nowMs: 5000 + i }))]);
 expect(out.effects).toEqual([{ kind: 'fit', neutral: { jawOpen: 0.1 } }]);
 expect(out.state.step).toBe('expressions');
 expect(guideStep(out.state, ev(probe(), 9000)).effects).toEqual([]);
 expect(guideStep(out.state, { kind: 'fitted' }).state).toMatchObject({ step: 'review', fitError: null });
 expect(guideStep(out.state, { kind: 'fitFailed', message: 'no' }).state).toMatchObject({ step: 'review', fitError: 'no' });
});

it('mainValue is the maximum over the main channels', () => {
 expect(mainValue(probe({ eyeBlinkLeft: 0.2, eyeBlinkRight: 0.7 }), 'blink')).toBe(0.7);
 expect(mainValue(probe({}), 'blink')).toBe(0);
});
