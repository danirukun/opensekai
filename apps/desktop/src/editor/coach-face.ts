import { EXPRESSION_STEPS, type ArkitName, type ExpressionStepId } from '@opensekai/contracts';

type Channels = Partial<Record<ArkitName, number>>;

// mouthCurve and the brows rest at 0.5: up is toward 1, down toward 0. pupil[1] is positive downward, as SVG y.
export interface CoachShape { jaw: number; mouthWidth: number; mouthCurve: number; pucker: number; lidScreenLeft: number; lidScreenRight: number; browScreenLeft: number; browScreenRight: number; cheekPuff: number; tongue: number; pupil: [number, number] }
export interface CoachFrame { atMs: number; values: Channels }
export interface CoachLoop { loopMs: number; frames: readonly CoachFrame[] }

const unit = (value: number) => Math.min(1, Math.max(0, value));
const signed = (value: number) => Math.min(1, Math.max(-1, value));

// Mirror view: the performer's left side draws on the screen's left.
export function coachShape(values: Channels): CoachShape {
 const v = (name: ArkitName) => unit(values[name] ?? 0);
 const pair = (left: ArkitName, right: ArkitName) => (v(left) + v(right)) / 2;
 const smile = pair('mouthSmileLeft', 'mouthSmileRight'), frown = pair('mouthFrownLeft', 'mouthFrownRight');
 const pucker = Math.max(v('mouthPucker'), v('mouthFunnel'));
 const toScreenLeft = pair('eyeLookOutLeft', 'eyeLookInRight'), toScreenRight = pair('eyeLookInLeft', 'eyeLookOutRight');
 const brow = (outerUp: ArkitName, down: ArkitName) => unit(0.5 + 0.5 * Math.max(v('browInnerUp'), v(outerUp)) - 0.5 * v(down));
 return {
  jaw: v('jawOpen'),
  mouthWidth: unit(0.5 + 0.5 * Math.max(smile, pair('mouthStretchLeft', 'mouthStretchRight')) - 0.5 * pucker),
  mouthCurve: unit(0.5 + 0.5 * smile - 0.5 * frown),
  pucker,
  lidScreenLeft: v('eyeBlinkLeft'),
  lidScreenRight: v('eyeBlinkRight'),
  browScreenLeft: brow('browOuterUpLeft', 'browDownLeft'),
  browScreenRight: brow('browOuterUpRight', 'browDownRight'),
  cheekPuff: v('cheekPuff'),
  tongue: v('tongueOut'),
  pupil: [signed(toScreenRight - toScreenLeft), signed(pair('eyeLookDownLeft', 'eyeLookDownRight') - pair('eyeLookUpLeft', 'eyeLookUpRight'))]
 };
}

const mix = (a: Channels, b: Channels, k: number): Channels => {
 const names = new Set([...Object.keys(a), ...Object.keys(b)] as ArkitName[]);
 return Object.fromEntries([...names].map(name => [name, (a[name] ?? 0) + ((b[name] ?? 0) - (a[name] ?? 0)) * k]));
};

export function sampleLoop(loop: CoachLoop, tMs: number): Channels {
 const { loopMs, frames } = loop;
 if (frames.length === 0) return {};
 const t = ((tMs % loopMs) + loopMs) % loopMs;
 const at = frames.reduce((last, frame, index) => frame.atMs <= t ? index : last, -1);
 // Before the first frame, the segment starts at the last frame of the previous loop.
 const from = at === -1 ? { ...frames.at(-1)!, atMs: frames.at(-1)!.atMs - loopMs } : frames[at]!;
 const to = at === -1 ? frames[0]! : at + 1 < frames.length ? frames[at + 1]! : { ...frames[0]!, atMs: frames[0]!.atMs + loopMs };
 const span = to.atMs - from.atMs;
 return mix(from.values, to.values, span > 0 ? (t - from.atMs) / span : 0);
}

const all = (names: readonly ArkitName[], value: number): Channels => Object.fromEntries(names.map(name => [name, value]));
// Rest, move, hold, and back to rest.
const pulse = (values: Channels, loopMs = 2400): CoachLoop => ({ loopMs, frames: [{ atMs: 0, values: {} }, { atMs: loopMs * 0.25, values }, { atMs: loopMs * 0.7, values }, { atMs: loopMs * 0.9, values: {} }] });
const main = (step: ExpressionStepId) => all(EXPRESSION_STEPS[step].main, 1);

export const COACH_LOOPS: Record<ExpressionStepId, CoachLoop> = {
 blink: { loopMs: 1600, frames: [{ atMs: 0, values: {} }, { atMs: 500, values: {} }, { atMs: 650, values: main('blink') }, { atMs: 900, values: main('blink') }, { atMs: 1050, values: {} }] },
 mouthWide: pulse({ jawOpen: 1, mouthLowerDownLeft: 0.6, mouthLowerDownRight: 0.6 }),
 browsUp: pulse({ browInnerUp: 1, browOuterUpLeft: 0.8, browOuterUpRight: 0.8 }),
 smile: pulse({ ...main('smile'), cheekSquintLeft: 0.5, cheekSquintRight: 0.5 }),
 frown: pulse({ ...main('frown'), browDownLeft: 0.7, browDownRight: 0.7 }),
 pucker: pulse({ mouthPucker: 1 }),
 puffCheeks: pulse({ cheekPuff: 1 }),
 tongueOut: pulse({ tongueOut: 1, jawOpen: 0.4 }),
 lookAround: {
  loopMs: 4000,
  frames: [
   { atMs: 0, values: {} },
   { atMs: 300, values: { eyeLookOutLeft: 1, eyeLookInRight: 1 } },
   { atMs: 900, values: { eyeLookOutLeft: 1, eyeLookInRight: 1 } },
   { atMs: 1300, values: { eyeLookInLeft: 1, eyeLookOutRight: 1 } },
   { atMs: 1900, values: { eyeLookInLeft: 1, eyeLookOutRight: 1 } },
   { atMs: 2300, values: { eyeLookUpLeft: 1, eyeLookUpRight: 1 } },
   { atMs: 2900, values: { eyeLookUpLeft: 1, eyeLookUpRight: 1 } },
   { atMs: 3300, values: { eyeLookDownLeft: 1, eyeLookDownRight: 1 } },
   { atMs: 3700, values: { eyeLookDownLeft: 1, eyeLookDownRight: 1 } }
  ]
 }
};

// The pose that the reduced-motion coach shows: the frame with the strongest main channels.
export function coachTarget(step: ExpressionStepId): Channels {
 const strength = (frame: CoachFrame) => EXPRESSION_STEPS[step].main.reduce((sum, name) => sum + (frame.values[name] ?? 0), 0);
 return COACH_LOOPS[step].frames.reduce((best, frame) => strength(frame) > strength(best) ? frame : best).values;
}
