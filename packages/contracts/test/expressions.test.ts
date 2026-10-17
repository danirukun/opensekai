import { expect, it } from 'vitest';
import names from '../../../fixtures/protocol/tracked-expressions.json';
import { AssetRecordSchema, effectiveExpressionSettings, isTrackedExpression, ParamSchemas, SceneEntitySchema, trackingGroup, triggerableExpressions, validateCall } from '../src';

const list = (names: [string, boolean][]) => ({ expressions: names.map(([name, preset]) => ({ name, preset })) });

it('excludes the expressions that tracking drives, ignoring case', () => {
 const record = list([['happy', true], ['AA', true], ['Blink_L', false], ['blinkLeft', true], ['LookUp', true], ['Neutral', true], ['eyeBlink_R', false], ['JAWOPEN', false], ['Smirk', false], ['mouthSmileLeft', false]]);
 expect(triggerableExpressions(record).map(entry => entry.name)).toEqual(['happy', 'Blink_L', 'Smirk']);
});

it('matches the tracked names of the Rust contracts, including the OVR visemes', () => {
 expect(names.tracked.filter(name => !isTrackedExpression(name))).toEqual([]);
 expect(names.triggerable.filter(isTrackedExpression)).toEqual([]);
});

it('gives presets layer 0 and each custom expression its own layer up to 15, and keeps stored settings', () => {
 const customs: [string, boolean][] = Array.from({ length: 17 }, (_, i) => [`c${i}`, false]);
 const record = list([['happy', true], ['aa', true], ...customs, ['sad', true]]);
 const stored = { c1: { layer: 0, fadeSeconds: 2, suppress: { blink: true, mouth: false, brow: false } } };
 const settings = effectiveExpressionSettings(record, stored);
 expect(settings.map(entry => [entry.name, entry.layer])).toEqual([['happy', 0], ...customs.map(([name], i) => [name, name === 'c1' ? 0 : Math.min(1 + i, 15)]), ['sad', 0]]);
 expect(settings.find(entry => entry.name === 'happy')).toEqual({ name: 'happy', preset: true, layer: 0, fadeSeconds: 0.4, suppress: { blink: false, mouth: false, brow: false } });
 expect(settings.find(entry => entry.name === 'c1')).toMatchObject({ fadeSeconds: 2, suppress: { blink: true } });
});

it('sorts tracking names into blink, mouth, and brow groups', () => {
 expect(['eyeBlinkLeft', 'Blink', 'blink_r', 'jawOpen', 'mouthSmile_L', 'cheekPuff', 'tongueOut', 'oh', 'PP', 'browInnerUp', 'eyeWideLeft', 'happy'].map(trackingGroup))
  .toEqual(['blink', 'blink', 'blink', 'mouth', 'mouth', 'mouth', 'mouth', 'mouth', 'mouth', 'brow', null, null]);
});

it('validates expression lists, avatar settings, and expression calls', () => {
 const record = { id: 'avatar_x', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name: 'Rem' };
 expect(AssetRecordSchema.safeParse(record).success).toBe(false);
 expect(AssetRecordSchema.safeParse({ ...record, expressions: [] }).success).toBe(true);
 expect(AssetRecordSchema.safeParse({ ...record, expressions: Array.from({ length: 65 }, (_, i) => ({ name: `e${i}`, preset: false })) }).success).toBe(false);
 const avatar = { id: 'a', name: 'A', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'avatar', assetId: null };
 const settings = { layer: 15, fadeSeconds: 5, suppress: { blink: true, mouth: true, brow: true } };
 expect(SceneEntitySchema.safeParse(avatar).success).toBe(true);
 expect(SceneEntitySchema.safeParse({ ...avatar, expressions: { happy: settings } }).success).toBe(true);
 expect(SceneEntitySchema.safeParse({ ...avatar, expressions: { happy: { ...settings, layer: 1.5 } } }).success).toBe(false);
 expect(SceneEntitySchema.safeParse({ ...avatar, expressions: { happy: { ...settings, fadeSeconds: 6 } } }).success).toBe(false);
 expect(validateCall('expressionSet', { avatarId: 'a', name: 'happy', active: true }).ok).toBe(true);
 expect(validateCall('expressionGet', { avatarId: 'a', name: 'x' }).ok).toBe(false);
 expect(ParamSchemas.expressionSet.safeParse({ avatarId: 'a', name: 'x'.repeat(129), active: true }).success).toBe(false);
});
