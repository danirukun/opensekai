import { describe, expect, it } from 'vitest';
import { EASINGS, HazeSettingsSchema, LightSettingsSchema, ReflectionsIntensitySchema } from '@opensekai/contracts';
import { ColorWordSchema, DirectionSchema, type Framing, WORDS } from '../src';

const order = <K extends string>(t: Record<K, number>, keys: K[]) => keys.every((k, i) => i === 0 || t[keys[i - 1]!] < t[k]);
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

describe('word tables', () => {
 it('word values keep their order and stay inside the contract ranges', () => {
  expect(order(WORDS.duration, ['quick', 'normal', 'slow', 'verySlow'])).toBe(true);
  expect(order(Object.fromEntries(Object.entries(WORDS.framing).map(([k, v]) => [k, v.distance])) as Record<Framing, number>, ['extremeCloseUp', 'closeUp', 'medium', 'wide'])).toBe(true);
  expect(WORDS.haze.off.density).toBe(0);
  for (const s of Object.values(WORDS.haze)) expect(HazeSettingsSchema.safeParse(s).success).toBe(true);
  expect(order(Object.fromEntries(Object.entries(WORDS.haze).map(([k, v]) => [k, v.density])) as Record<'off' | 'light' | 'medium' | 'thick', number>, ['off', 'light', 'medium', 'thick'])).toBe(true);
  for (const c of Object.values(WORDS.color)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  for (const t of ['directional', 'point', 'spot', 'ambient'] as const) {
   expect(order(Object.fromEntries(Object.entries(WORDS.intensity).map(([k, v]) => [k, v[t]])) as Record<'dim' | 'soft' | 'normal' | 'bright', number>, ['dim', 'soft', 'normal', 'bright'])).toBe(true);
   for (const v of Object.values(WORDS.intensity)) expect(v[t]).toBeGreaterThanOrEqual(0);
   for (const v of Object.values(WORDS.intensity)) expect(v[t]).toBeLessThanOrEqual(1000);
  }
  expect(order(WORDS.height, ['low', 'eye', 'high'])).toBe(true);
  expect(order(WORDS.reflections, ['off', 'low', 'normal', 'high'])).toBe(true);
  expect(order(WORDS.wait, ['short', 'medium', 'long'])).toBe(true);
  for (const r of Object.values(WORDS.reflections)) expect(ReflectionsIntensitySchema.safeParse(r).success).toBe(true);
  for (const e of Object.values(WORDS.easing)) expect(EASINGS).toContain(e);
 });

 it('temperature words run warm to cool: red falls, blue rises', () => {
  const t = (['candle', 'warm', 'neutral', 'daylight', 'cool'] as const).map(k => rgb(WORDS.color[k]));
  for (let i = 1; i < t.length; i++) {
   expect(t[i]![0]).toBeLessThanOrEqual(t[i - 1]![0]);
   expect(t[i]![2]).toBeGreaterThanOrEqual(t[i - 1]![2]);
  }
  expect(t[4]![0]).toBeLessThan(t[0]![0]);
  expect(t[4]![2]).toBeGreaterThan(t[0]![2]);
 });

 it('covers every enum member and builds valid lights', () => {
  expect(Object.keys(WORDS.color).sort()).toEqual([...ColorWordSchema.options].sort());
  expect(Object.keys(WORDS.direction).sort()).toEqual([...DirectionSchema.options].sort());
  for (const d of Object.values(WORDS.direction)) expect(Math.hypot(...d)).toBeCloseTo(1);
  const shadow = { enabled: false, intensity: 1, soft: true, bias: 0, normalBias: 0 };
  const base = { color: WORDS.color.warm, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true };
  for (const type of ['directional', 'point', 'ambient'] as const) {
   const r = LightSettingsSchema.safeParse({ ...base, type, intensity: WORDS.intensity.bright[type], shadow });
   expect(r.error?.issues ?? []).toEqual([]);
  }
 });
});
