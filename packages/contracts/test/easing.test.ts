import { expect, it } from 'vitest';
import { ARKIT_NAMES, BlueprintNodeSchema, EASINGS, blendShapeNames, ease, type Easing } from '../src';

it('starts at exactly 0 and ends at exactly 1 for each easing, and clamps progress', () => {
 expect(EASINGS).toHaveLength(31);
 for (const name of EASINGS) {
  expect([ease(name, 0), ease(name, 1), ease(name, -0.5), ease(name, 2), ease(name, Number.NaN)], name).toEqual([0, 1, 0, 1, 0]);
 }
});

it('gives the easings.net values at the midpoint and a quarter', () => {
 const half: Partial<Record<Easing, number>> = {
  Linear: 0.5, InSine: 1 - Math.SQRT1_2, OutSine: Math.SQRT1_2, InOutSine: 0.5,
  InQuad: 0.25, OutQuad: 0.75, InCubic: 0.125, OutCubic: 0.875, InQuart: 0.0625, OutQuart: 0.9375, InQuint: 0.03125, OutQuint: 0.96875,
  InExpo: 2 ** -5, OutExpo: 1 - 2 ** -5, InCirc: 1 - Math.sqrt(0.75), OutCirc: Math.sqrt(0.75),
  OutBounce: 0.765625, InBounce: 0.234375,
 };
 for (const [name, value] of Object.entries(half)) expect(ease(name as Easing, 0.5), name).toBeCloseTo(value, 10);
 // Each InOut curve is symmetric: half way at 0.5, and f(t) + f(1 − t) = 1.
 for (const name of EASINGS.filter(item => item.startsWith('InOut'))) {
  expect(ease(name, 0.5), name).toBeCloseTo(0.5, 10);
  expect(ease(name, 0.25) + ease(name, 0.75), name).toBeCloseTo(1, 10);
 }
 expect(ease('InQuad', 0.25)).toBeCloseTo(0.0625, 10);
 expect(ease('InOutCubic', 0.25)).toBeCloseTo(0.0625, 10);
});

it('overshoots with Back and Elastic and stays in range with the other families', () => {
 expect(ease('InBack', 0.2)).toBeLessThan(0);
 expect(ease('OutBack', 0.8)).toBeGreaterThan(1);
 expect(Math.max(...Array.from({ length: 99 }, (_, i) => ease('OutElastic', (i + 1) / 100)))).toBeGreaterThan(1);
 for (const name of EASINGS.filter(item => !item.includes('Back') && !item.includes('Elastic')))
  for (let i = 1; i < 100; i++) { const value = ease(name, i / 100); expect(value >= 0 && value <= 1, `${name} ${i}`).toBe(true); }
});

it('lists the record names, then the tracked VRM presets, then the ARKit names, without duplicates', () => {
 const names = blendShapeNames({ expressions: [{ name: 'Wink', preset: false }, { name: 'happy', preset: true }, { name: 'blink', preset: true }] });
 expect(names.slice(0, 4)).toEqual(['Wink', 'happy', 'blink', 'aa']);
 expect(names).toContain('neutral');
 expect(names.slice(-ARKIT_NAMES.length)).toEqual([...ARKIT_NAMES]);
 expect(new Set(names).size).toBe(names.length);
});

it('accepts a saved node without transition settings and rejects an unknown easing', () => {
 const node = (settings: object) => ({ id: 'set', version: 1, type: 'property.set', position: { x: 0, y: 0 }, settings: { entityId: 'camera_wide', property: 'fovDegrees', ...settings } });
 expect(BlueprintNodeSchema.safeParse(node({})).success).toBe(true);
 expect(BlueprintNodeSchema.safeParse(node({ transitionSeconds: 2, easing: 'InOutSine' })).success).toBe(true);
 expect(BlueprintNodeSchema.safeParse(node({ transitionSeconds: 2, easing: 'EaseInOut' })).success).toBe(false);
 expect(BlueprintNodeSchema.safeParse(node({ transitionSeconds: -1 })).success).toBe(false);
 expect(BlueprintNodeSchema.safeParse(node({ transitionSeconds: 601 })).success).toBe(false);
});
