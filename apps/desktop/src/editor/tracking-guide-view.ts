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

// A phone on the home network most likely reaches a 192.168, 10, or 172.16–31 address. A VPN (100.64/10) or a
// virtual bridge network address (x.x.x.0) comes last. The sort is stable, so the host order breaks ties.
function addressRank(address: string): number {
 const [a = 0, b = 0, , d = 0] = address.split('.').map(Number);
 if (d === 0) return 5;
 if (a === 192 && b === 168) return 0;
 if (a === 10) return 1;
 if (a === 172 && b >= 16 && b <= 31) return 2;
 if (a === 100 && b >= 64 && b <= 127) return 4;
 return 3;
}
export const rankAddresses = (addresses: readonly string[]): string[] => [...addresses].sort((x, y) => addressRank(x) - addressRank(y));
