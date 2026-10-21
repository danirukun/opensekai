import { EXPRESSION_STEPS, type ArkitName, type ExpressionStepId, type Id, type TrackingPreset, type TrackingProbe } from '@opensekai/contracts';

export type GuideStep = 'pick' | 'connect' | 'relax' | 'expressions' | 'review';
export type StepResult = 'done' | 'notSent' | 'skipped';
type Channels = Partial<Record<ArkitName, number>>;

export interface GuideState {
 step: GuideStep;
 preset: TrackingPreset | null;
 sourceId: Id | null;
 relaxStartMs: number | null;
 neutral: Channels;
 index: number;
 stepPeak: number;
 stepStartMs: number;
 lastRiseMs: number | null;
 lastMainChangeMs: number;
 lastOtherChangeMs: number | null;
 previous: TrackingProbe | null;
 results: Partial<Record<ExpressionStepId, StepResult>>;
 fitError: string | null;
}

export type GuideEvent =
 | { kind: 'pick'; preset: TrackingPreset }
 | { kind: 'connected'; sourceId: Id }
 | { kind: 'probe'; probe: TrackingProbe; nowMs: number }
 | { kind: 'next'; nowMs: number }
 | { kind: 'fitted' }
 | { kind: 'fitFailed'; message: string };

export type GuideEffect =
 | { kind: 'connect'; preset: TrackingPreset }
 | { kind: 'resetPeaks' }
 | { kind: 'calibrate' }
 | { kind: 'fit'; neutral: Channels };

type Out = { state: GuideState; effects: GuideEffect[] };

export const RELAX_MS = 3000;
export const RISE = 0.05;
export const SETTLE_MS = 1000;
const UNCHANGED_MS = 4000;

export const initialGuide = (): GuideState => ({
 step: 'pick', preset: null, sourceId: null, relaxStartMs: null, neutral: {}, index: 0, stepPeak: 0, stepStartMs: 0,
 lastRiseMs: null, lastMainChangeMs: 0, lastOtherChangeMs: null, previous: null, results: {}, fitError: null
});

export const mainValue = (probe: TrackingProbe, step: ExpressionStepId): number =>
 Math.max(0, ...EXPRESSION_STEPS[step].main.map(name => probe.values[name] ?? 0));

const mainNeutral = (neutral: Channels, step: ExpressionStepId): number =>
 Math.max(0, ...EXPRESSION_STEPS[step].main.map(name => neutral[name] ?? 0));

const currentStep = (state: GuideState): ExpressionStepId | undefined => state.preset?.steps[state.index];

// A step with no usable main channel ends at once. Eye bones alone keep lookAround open until Skip.
function absent(probe: TrackingProbe, step: ExpressionStepId): boolean {
 const sent = EXPRESSION_STEPS[step].main.some(name => probe.presentChannels.includes(name));
 return !sent && !(step === 'lookAround' && probe.eyeBones);
}

function enter(state: GuideState, index: number, probe: TrackingProbe | null, nowMs: number): Out {
 let next: GuideState = { ...state, index };
 for (;;) {
  const id = next.preset?.steps[next.index];
  if (id === undefined) return { state: { ...next, previous: probe }, effects: [{ kind: 'fit', neutral: next.neutral }] };
  next = { ...next, stepPeak: 0, stepStartMs: nowMs, lastRiseMs: null, lastMainChangeMs: nowMs, lastOtherChangeMs: null, previous: probe };
  if (probe === null || !absent(probe, id)) return { state: next, effects: [] };
  next = { ...next, results: { ...next.results, [id]: 'notSent' }, index: next.index + 1 };
 }
}

const differs = (a: number | undefined, b: number | undefined): boolean => (a ?? 0) !== (b ?? 0);

function expressionProbe(state: GuideState, probe: TrackingProbe, nowMs: number): Out {
 const id = currentStep(state);
 if (id === undefined) return { state, effects: [] };
 if (absent(probe, id)) return enter({ ...state, results: { ...state.results, [id]: 'notSent' } }, state.index + 1, probe, nowMs);
 const main = EXPRESSION_STEPS[id].main;
 if (id === 'lookAround' && !main.some(name => probe.presentChannels.includes(name))) return { state: { ...state, previous: probe }, effects: [] };
 const prev = state.previous;
 const names = new Set<ArkitName>([...Object.keys(probe.values), ...Object.keys(prev?.values ?? {})] as ArkitName[]);
 const mainChanged = prev !== null && main.some(name => differs(probe.values[name], prev.values[name]));
 const otherChanged = prev !== null && [...names].some(name => !main.includes(name) && differs(probe.values[name], prev.values[name]));
 const value = mainValue(probe, id);
 const rose = value > state.stepPeak;
 const tracked: GuideState = {
  ...state,
  previous: probe,
  stepPeak: rose ? value : state.stepPeak,
  lastRiseMs: rose ? nowMs : state.lastRiseMs,
  lastMainChangeMs: mainChanged || prev === null ? nowMs : state.lastMainChangeMs,
  lastOtherChangeMs: mainChanged || prev === null ? null : otherChanged ? nowMs : state.lastOtherChangeMs
 };
 const finish = (result: StepResult): Out => enter({ ...tracked, results: { ...tracked.results, [id]: result } }, tracked.index + 1, probe, nowMs);
 const risen = tracked.stepPeak > mainNeutral(state.neutral, id) + RISE;
 if (risen && tracked.lastRiseMs !== null && nowMs - tracked.lastRiseMs >= SETTLE_MS) return finish('done');
 if (nowMs - tracked.lastMainChangeMs >= UNCHANGED_MS && tracked.lastOtherChangeMs !== null) return finish('notSent');
 return { state: tracked, effects: [] };
}

const awaitingFit = (state: GuideState): boolean => state.step === 'expressions' && state.preset !== null && state.index >= state.preset.steps.length;

export function guideStep(state: GuideState, event: GuideEvent): Out {
 switch (event.kind) {
  case 'pick':
   return { state: { ...initialGuide(), step: 'connect', preset: event.preset }, effects: [{ kind: 'connect', preset: event.preset }] };
  case 'connected':
   return state.step === 'connect' ? { state: { ...state, sourceId: event.sourceId }, effects: [] } : { state, effects: [] };
  case 'fitted':
   return awaitingFit(state) ? { state: { ...state, step: 'review', fitError: null }, effects: [] } : { state, effects: [] };
  case 'fitFailed':
   return awaitingFit(state) ? { state: { ...state, step: 'review', fitError: event.message }, effects: [] } : { state, effects: [] };
  case 'next':
   if (state.step !== 'expressions') return { state, effects: [] };
   {
    const id = currentStep(state);
    if (id === undefined) return { state, effects: [] };
    return enter({ ...state, results: { ...state.results, [id]: 'skipped' } }, state.index + 1, state.previous, event.nowMs);
   }
  case 'probe': {
   const { probe, nowMs } = event;
   if (probe.sourceId !== state.sourceId) return { state, effects: [] };
   // A gap in data breaks the comparison: the next receiving probe restarts the unchanged clocks.
   if (probe.state !== 'receiving') return { state: state.step === 'expressions' ? { ...state, previous: null } : state, effects: [] };
   if (state.step === 'connect') return { state: { ...state, step: 'relax', relaxStartMs: nowMs }, effects: [] };
   if (state.step === 'relax') {
    if (state.relaxStartMs === null || nowMs < state.relaxStartMs + RELAX_MS) return { state, effects: [] };
    const effects: GuideEffect[] = [{ kind: 'resetPeaks' }];
    if (state.preset?.id === 'ifacialmocap') effects.push({ kind: 'calibrate' });
    const started = enter({ ...state, step: 'expressions', neutral: { ...probe.values }, results: {} }, 0, probe, nowMs);
    return { state: started.state, effects: [...effects, ...started.effects] };
   }
   if (state.step === 'expressions') return expressionProbe(state, probe, nowMs);
   return { state, effects: [] };
  }
 }
}
