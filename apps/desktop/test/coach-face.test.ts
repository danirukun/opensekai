import { expect, it } from 'vitest';
import { EXPRESSION_STEPS, type ExpressionStepId } from '@opensekai/contracts';
import { COACH_LOOPS, coachShape, coachTarget, sampleLoop } from '../src/editor/coach-face';

it('shows the performer mirrored: the left blink closes the left lid on screen', () => {
 const shape = coachShape({ eyeBlinkLeft: 1 });
 expect(shape.lidScreenLeft).toBe(1);
 expect(shape.lidScreenRight).toBe(0);
});

it('opens the jaw fully at jawOpen 1', () => {
 expect(coachShape({ jawOpen: 1 }).jaw).toBe(1);
});

it('moves the pupils to the screen left when the performer looks to their left', () => {
 expect(coachShape({ eyeLookOutLeft: 1, eyeLookInRight: 1 }).pupil[0]).toBeLessThan(0);
 expect(coachShape({ eyeLookInLeft: 1, eyeLookOutRight: 1 }).pupil[0]).toBeGreaterThan(0);
});

it('keeps every shape value in range for out-of-range input', () => {
 const shape = coachShape({ jawOpen: 3, mouthSmileLeft: 2, mouthSmileRight: 2, browInnerUp: -1, eyeLookOutLeft: 5, eyeLookInRight: 5 });
 for (const [key, value] of Object.entries(shape)) {
  if (key === 'pupil') for (const axis of value as number[]) { expect(axis).toBeGreaterThanOrEqual(-1); expect(axis).toBeLessThanOrEqual(1); }
  else { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1); }
 }
});

it('interpolates a loop linearly and wraps at loopMs', () => {
 const loop = { loopMs: 1000, frames: [{ atMs: 0, values: { jawOpen: 0 } }, { atMs: 1000, values: { jawOpen: 1 } }] };
 expect(sampleLoop(loop, 500).jawOpen).toBeCloseTo(0.5);
 expect(sampleLoop(loop, 1010).jawOpen).toBeCloseTo(sampleLoop(loop, 10).jawOpen!);
 expect(sampleLoop(loop, 10).jawOpen).toBeCloseTo(0.01);
});

it('wraps from the last frame back to the first', () => {
 const loop = { loopMs: 1000, frames: [{ atMs: 0, values: { jawOpen: 0 } }, { atMs: 500, values: { jawOpen: 1 } }] };
 expect(sampleLoop(loop, 750).jawOpen).toBeCloseTo(0.5);
 expect(sampleLoop(loop, -250).jawOpen).toBeCloseTo(0.5);
});

it('reaches 1 on each main channel in each step loop', () => {
 for (const step of Object.keys(EXPRESSION_STEPS) as ExpressionStepId[]) {
  for (const name of EXPRESSION_STEPS[step].main) {
   expect(COACH_LOOPS[step].frames.some(frame => frame.values[name] === 1), `${step} ${name}`).toBe(true);
  }
 }
});

it('takes the target pose from the frame with the strongest main channels', () => {
 const target = coachTarget('mouthWide');
 expect(target.jawOpen).toBe(1);
});
