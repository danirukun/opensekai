import { EXPRESSION_STEPS, type ArkitName, type TrackingMapping } from '@opensekai/contracts';
import { RELAX_MS, RISE, SETTLE_MS, type GuideState } from './tracking-guide';

const unit = (value: number) => Math.min(1, Math.max(0, value));

export const relaxSecondsLeft = (state: GuideState, nowMs: number): number =>
 state.relaxStartMs === null ? RELAX_MS / 1000 : Math.max(0, Math.ceil((state.relaxStartMs + RELAX_MS - nowMs) / 1000));

// The coach ring fills while the risen peak holds; the step ends as 'done' when it is full.
export function stepProgress(state: GuideState, nowMs: number): number {
 const id = state.step === 'expressions' ? state.preset?.steps[state.index] : undefined;
 if (id === undefined || state.lastRiseMs === null) return 0;
 const neutral = Math.max(0, ...EXPRESSION_STEPS[id].main.map(name => state.neutral[name] ?? 0));
 return state.stepPeak > neutral + RISE ? unit((nowMs - state.lastRiseMs) / SETTLE_MS) : 0;
}

// lookAround with gaze only as eye bones cannot end by itself.
export function waitsForNext(state: GuideState): boolean {
 const id = state.step === 'expressions' ? state.preset?.steps[state.index] : undefined;
 const probe = state.previous;
 return id === 'lookAround' && probe !== null && probe.eyeBones && !EXPRESSION_STEPS.lookAround.main.some(name => probe.presentChannels.includes(name));
}

// The strongest channel of a group after the source's ranges and sensitivity, as the character receives it.
export function groupLevel(values: Partial<Record<ArkitName, number>>, names: readonly ArkitName[], mapping: TrackingMapping | undefined): number {
 const level = (name: ArkitName) => {
  const value = values[name] ?? 0;
  const range = mapping?.blendShapes[name];
  const mapped = range ? range.outputMin + unit((value - range.inputMin) / (range.inputMax - range.inputMin)) * (range.outputMax - range.outputMin) : value;
  return unit(mapped * (mapping?.blendShapeSensitivity ?? 1));
 };
 return Math.max(0, ...names.map(level));
}
