import { EXPRESSION_STEPS, type ArkitName, type ExpressionStepId, type Id, type TrackingPreset, type TrackingProbe } from '@opensekai/contracts';
import type { SetupPart, SetupRole } from './tracking-guide-setup';

export type GuideStep = 'pick' | 'connect' | 'relax' | 'expressions' | 'review';
export type StepResult = 'done' | 'notSent' | 'skipped';
type Channels = Partial<Record<ArkitName, number>>;

export interface GuidePart { preset: TrackingPreset; roles: SetupRole[]; sourceId: Id | null }

export interface GuideState {
 step: GuideStep;
 parts: GuidePart[];
 faceSourceId: Id | null;
 receiving: Id[];
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
 | { kind: 'pick'; parts: SetupPart[] }
 | { kind: 'connected'; sourceIds: Id[] }
 | { kind: 'probe'; probe: TrackingProbe; nowMs: number }
 | { kind: 'next'; nowMs: number }
 | { kind: 'fitted' }
 | { kind: 'fitFailed'; message: string };

export type GuideEffect =
 | { kind: 'connect'; parts: SetupPart[] }
 | { kind: 'resetPeaks' }
 | { kind: 'calibrate'; sourceId: Id }
 | { kind: 'fit'; sourceId: Id; neutral: Channels };

type Out = { state: GuideState; effects: GuideEffect[] };

export const RELAX_MS = 3000;
export const RISE = 0.05;
export const SETTLE_MS = 1000;
const UNCHANGED_MS = 4000;

export const initialGuide = (): GuideState => ({
 step: 'pick', parts: [], faceSourceId: null, receiving: [], relaxStartMs: null, neutral: {}, index: 0, stepPeak: 0, stepStartMs: 0,
 lastRiseMs: null, lastMainChangeMs: 0, lastOtherChangeMs: null, previous: null, results: {}, fitError: null
});

// The part that drives the expression steps, the coach, and the fit.
export const facePart = (state: GuideState): GuidePart | undefined => state.parts.find(part => part.roles.includes('face'));

export const mainValue = (probe: TrackingProbe, step: ExpressionStepId): number =>
 Math.max(0, ...EXPRESSION_STEPS[step].main.map(name => probe.values[name] ?? 0));

const mainNeutral = (neutral: Channels, step: ExpressionStepId): number =>
 Math.max(0, ...EXPRESSION_STEPS[step].main.map(name => neutral[name] ?? 0));

const currentStep = (state: GuideState): ExpressionStepId | undefined => facePart(state)?.preset.steps[state.index];

// A step with no usable main channel ends at once. Eye bones alone keep lookAround open until Skip.
function absent(probe: TrackingProbe, step: ExpressionStepId): boolean {
 const sent = EXPRESSION_STEPS[step].main.some(name => probe.presentChannels.includes(name));
 return !sent && !(step === 'lookAround' && probe.eyeBones);
}

function enter(state: GuideState, index: number, probe: TrackingProbe | null, nowMs: number): Out {
 let next: GuideState = { ...state, index };
 for (;;) {
  const id = facePart(next)?.preset.steps[next.index];
  if (id === undefined) return { state: { ...next, previous: probe }, effects: next.faceSourceId ? [{ kind: 'fit', sourceId: next.faceSourceId, neutral: next.neutral }] : [] };
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

const awaitingFit = (state: GuideState): boolean => {
 const face = facePart(state);
 return state.step === 'expressions' && face !== undefined && state.index >= face.preset.steps.length;
};

// The end of Relax: each part whose preset calibrates gets one calibrate. Without a face part, the run goes to Review.
function endRelax(state: GuideState, probe: TrackingProbe, nowMs: number): Out {
 const calibrate: GuideEffect[] = state.parts.flatMap(part => part.preset.calibrate && part.sourceId ? [{ kind: 'calibrate' as const, sourceId: part.sourceId }] : []);
 if (state.faceSourceId === null) return { state: { ...state, step: 'review', fitError: null }, effects: calibrate };
 const started = enter({ ...state, step: 'expressions', neutral: { ...probe.values }, results: {} }, 0, probe, nowMs);
 return { state: started.state, effects: [{ kind: 'resetPeaks' }, ...calibrate, ...started.effects] };
}

export function guideStep(state: GuideState, event: GuideEvent): Out {
 switch (event.kind) {
  case 'pick':
   return { state: { ...initialGuide(), step: 'connect', parts: event.parts.map(part => ({ preset: part.preset, roles: [...part.roles], sourceId: null })) }, effects: [{ kind: 'connect', parts: event.parts }] };
  case 'connected': {
   if (state.step !== 'connect' || event.sourceIds.length !== state.parts.length) return { state, effects: [] };
   const parts = state.parts.map((part, index) => ({ ...part, sourceId: event.sourceIds[index] ?? null }));
   return { state: { ...state, parts, faceSourceId: parts.find(part => part.roles.includes('face'))?.sourceId ?? null, receiving: [] }, effects: [] };
  }
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
   const ids = state.parts.flatMap(part => part.sourceId ? [part.sourceId] : []);
   if (!ids.includes(probe.sourceId)) return { state, effects: [] };
   const live = probe.state === 'receiving';
   if (state.step === 'connect') {
    // Connect ends when the last probe of each part is receiving.
    const receiving = live ? [...new Set([...state.receiving, probe.sourceId])] : state.receiving.filter(id => id !== probe.sourceId);
    const all = ids.length === state.parts.length && ids.every(id => receiving.includes(id));
    return { state: all ? { ...state, receiving, step: 'relax', relaxStartMs: nowMs } : { ...state, receiving }, effects: [] };
   }
   // With a face part, only its probes drive Relax and the steps. A body-only run ends Relax on any of its probes.
   const driver = state.faceSourceId ?? probe.sourceId;
   if (probe.sourceId !== driver) return { state, effects: [] };
   // A gap in data breaks the comparison: the next receiving probe restarts the unchanged clocks.
   if (!live) return { state: state.step === 'expressions' ? { ...state, previous: null } : state, effects: [] };
   if (state.step === 'relax') {
    if (state.relaxStartMs === null || nowMs < state.relaxStartMs + RELAX_MS) return { state, effects: [] };
    return endRelax(state, probe, nowMs);
   }
   if (state.step === 'expressions') return expressionProbe(state, probe, nowMs);
   return { state, effects: [] };
  }
 }
}
