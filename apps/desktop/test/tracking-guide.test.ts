import { expect, it } from 'vitest';
import { TRACKING_PRESETS, type ArkitName, type TrackingPreset, type TrackingProbe } from '@opensekai/contracts';
import { guideStep, initialGuide, mainValue, type GuideEffect, type GuideEvent, type GuideState } from '../src/editor/tracking-guide';
import { resolveSetup, type SetupPart } from '../src/editor/tracking-guide-setup';

const selfReflect = TRACKING_PRESETS[0]!;
const ifacial = TRACKING_PRESETS[1]!;
// The one-part form of the old one-preset cases: the part fills the preset slots.
const one = (preset: TrackingPreset): SetupPart[] => [{ preset, roles: [...preset.slots], config: preset.config }];
const pick = (preset: TrackingPreset): GuideEvent => ({ kind: 'pick', parts: one(preset) });
const connected = (...sourceIds: string[]): GuideEvent => ({ kind: 'connected', sourceIds });
const ALL: ArkitName[] = ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthPucker', 'cheekPuff', 'tongueOut', 'eyeLookUpLeft', 'eyeLookInLeft'];

const probe = (values: Partial<Record<ArkitName, number>> = {}, over: Partial<TrackingProbe> = {}): TrackingProbe => ({ sourceId: 'src', generation: 1, state: 'receiving', values, peaks: {}, presentChannels: ALL, eyeBones: false, ...over });
const ev = (p: TrackingProbe, nowMs: number): GuideEvent => ({ kind: 'probe', probe: p, nowMs });

function run(state: GuideState, events: GuideEvent[]) {
 const effects: GuideEffect[] = [];
 for (const event of events) { const out = guideStep(state, event); state = out.state; effects.push(...out.effects); }
 return { state, effects };
}
const toRelax = (preset = selfReflect) => run(initialGuide(), [pick(preset), connected('src'), ev(probe(), 1000)]).state;
const toExpressions = (neutral: Partial<Record<ArkitName, number>> = {}, preset = selfReflect) => {
 const out = run(toRelax(preset), [ev(probe(neutral), 4000)]);
 return { state: out.state, effects: out.effects };
};

it('pick emits connect; connected then a receiving probe enters relax', () => {
 const a = guideStep(initialGuide(), pick(selfReflect));
 expect(a.state.step).toBe('connect');
 expect(a.effects).toEqual([{ kind: 'connect', parts: one(selfReflect) }]);
 const b = guideStep(a.state, connected('src'));
 expect(b.state.step).toBe('connect');
 expect(b.state.faceSourceId).toBe('src');
 const c = guideStep(b.state, ev(probe(), 500));
 expect(c.state.step).toBe('relax');
 expect(c.state.relaxStartMs).toBe(500);
});

it('connect waits until the probe state is receiving', () => {
 let s = run(initialGuide(), [pick(selfReflect), connected('src')]).state;
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
 expect(out.effects).toEqual([{ kind: 'resetPeaks' }, { kind: 'calibrate', sourceId: 'src' }]);
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
 expect(after.effects).toEqual([{ kind: 'fit', sourceId: 'src', neutral: {} }]);
 const neither = run(toLook(), [ev(probe({}, { presentChannels: noLook, eyeBones: false }), 5000)]);
 expect(neither.state.results.lookAround).toBe('notSent');
 expect(neither.effects).toEqual([{ kind: 'fit', sourceId: 'src', neutral: {} }]);
});

it('after the last step: emits fit with neutral; fitted enters review; fitFailed enters review with fitError', () => {
 const out = run(toExpressions({ jawOpen: 0.1 }).state, [ev(probe(), 4100), ...Array.from({ length: 9 }, (_, i): GuideEvent => ({ kind: 'next', nowMs: 5000 + i }))]);
 expect(out.effects).toEqual([{ kind: 'fit', sourceId: 'src', neutral: { jawOpen: 0.1 } }]);
 expect(out.state.step).toBe('expressions');
 expect(guideStep(out.state, ev(probe(), 9000)).effects).toEqual([]);
 expect(guideStep(out.state, { kind: 'fitted' }).state).toMatchObject({ step: 'review', fitError: null });
 expect(guideStep(out.state, { kind: 'fitFailed', message: 'no' }).state).toMatchObject({ step: 'review', fitError: 'no' });
});

it('mainValue is the maximum over the main channels', () => {
 expect(mainValue(probe({ eyeBlinkLeft: 0.2, eyeBlinkRight: 0.7 }), 'blink')).toBe(0.7);
 expect(mainValue(probe({}), 'blink')).toBe(0);
});

it('lookAround with eye bones stays open while other channels change for more than 4000 ms, then next skips it', () => {
 const noLook = ALL.filter(n => !n.startsWith('eyeLook'));
 let s = toLook();
 s = run(s, [0, 1, 2, 3, 4, 5, 6].map(i => ev(probe({ jawOpen: i / 10 }, { presentChannels: noLook, eyeBones: true }), 5000 + i * 1000))).state;
 expect(s.index).toBe(8);
 expect(s.results.lookAround).toBeUndefined();
 expect(guideStep(s, { kind: 'next', nowMs: 12000 }).state.results.lookAround).toBe('skipped');
});

it('fitted, fitFailed, and connected are ignored outside their step', () => {
 const early = toExpressions().state;
 expect(guideStep(early, { kind: 'fitted' }).state).toBe(early);
 expect(guideStep(early, { kind: 'fitFailed', message: 'x' }).state).toBe(early);
 expect(guideStep(early, connected('other')).state.faceSourceId).toBe('src');
});

it('a data gap does not cause a false notSent', () => {
 const p = (other: number, t: number, state: TrackingProbe['state'] = 'receiving') => ev(probe({ eyeBlinkLeft: 0, jawOpen: other }, { state }), t);
 let s = run(toExpressions().state, [p(0, 4100), p(0.1, 4200), p(0.2, 4300, 'stale')]).state;
 s = guideStep(s, p(0.3, 9000)).state;
 expect(s.index).toBe(0);
 expect(guideStep(s, p(0.4, 9500)).state.index).toBe(0);
});

// Two parts: iFacialMocap on the face ('face') and SelfReflect on the body ('body').
const twoParts = resolveSetup({ face: 'ifacialmocap', body: 'selfreflect', hands: true });
const at = (sourceId: string, values: Partial<Record<ArkitName, number>> = {}, over: Partial<TrackingProbe> = {}) => probe(values, { sourceId, ...over });
const twoConnected = () => run(initialGuide(), [{ kind: 'pick', parts: twoParts }, connected('face', 'body')]).state;

it('pick with two parts emits one connect with both parts', () => {
 const out = guideStep(initialGuide(), { kind: 'pick', parts: twoParts });
 expect(out.effects).toEqual([{ kind: 'connect', parts: twoParts }]);
 expect(out.state.parts.map(p => [p.preset.id, p.roles, p.sourceId])).toEqual([['ifacialmocap', ['face'], null], ['selfreflect', ['body', 'fingers'], null]]);
 const s = guideStep(out.state, connected('face', 'body')).state;
 expect(s.faceSourceId).toBe('face');
 expect(s.parts.map(p => p.sourceId)).toEqual(['face', 'body']);
});

it('connect stays until each part has a receiving probe', () => {
 let s = twoConnected();
 s = run(s, [ev(at('face'), 100), ev(at('body', {}, { state: 'waiting' }), 110)]).state;
 expect(s.step).toBe('connect');
 s = guideStep(s, ev(at('face', {}, { state: 'stale' }), 200)).state;
 s = guideStep(s, ev(at('body'), 210)).state;
 expect(s.step).toBe('connect');
 s = guideStep(s, ev(at('face'), 300)).state;
 expect(s).toMatchObject({ step: 'relax', relaxStartMs: 300 });
});

it('the end of Relax emits one calibrate for each part that calibrates: iFacialMocap, not SelfReflect', () => {
 const relax = run(twoConnected(), [ev(at('face'), 100), ev(at('body'), 200)]).state;
 expect(relax.step).toBe('relax');
 expect(guideStep(relax, ev(at('body'), 5000)).state.step).toBe('relax');
 const out = guideStep(relax, ev(at('face', { jawOpen: 0.1 }), 5000));
 expect(out.state.step).toBe('expressions');
 expect(out.state.neutral).toEqual({ jawOpen: 0.1 });
 expect(out.effects).toEqual([{ kind: 'resetPeaks' }, { kind: 'calibrate', sourceId: 'face' }]);
});

it('only face probes drive the expression steps; a body probe does not change the peak', () => {
 let s = run(twoConnected(), [ev(at('face'), 100), ev(at('body'), 200), ev(at('face'), 5000)]).state;
 expect(s.step).toBe('expressions');
 s = guideStep(s, ev(at('face', { eyeBlinkLeft: 0.3 }), 5100)).state;
 const body = guideStep(s, ev(at('body', { eyeBlinkLeft: 0.9 }), 5200)).state;
 expect(body).toBe(s);
 expect(body.stepPeak).toBe(0.3);
});

it('a body-only run goes from Relax to Review and sends no fit', () => {
 const parts = resolveSetup({ face: 'none', body: 'webcam', hands: true });
 const relax = run(initialGuide(), [{ kind: 'pick', parts }, connected('cam'), ev(at('cam'), 100)]).state;
 expect(relax).toMatchObject({ step: 'relax', faceSourceId: null });
 const out = guideStep(relax, ev(at('cam'), 3100));
 expect(out.state).toMatchObject({ step: 'review', fitError: null });
 expect(out.effects).toEqual([{ kind: 'calibrate', sourceId: 'cam' }]);
});

it('a probe with an unknown source changes nothing', () => {
 const s = twoConnected();
 expect(guideStep(s, ev(at('stranger'), 100)).state).toBe(s);
 const relax = run(s, [ev(at('face'), 100), ev(at('body'), 200)]).state;
 expect(guideStep(relax, ev(at('stranger'), 9000)).state).toBe(relax);
});
