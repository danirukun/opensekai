import { expect, it } from 'vitest';
import type { AssetRecord, ExpressionView } from '@opensekai/contracts';
import { editSettings, hasTriggerableExpressions } from '../src/editor/expressions';

const record = (id: string, names: string[]): AssetRecord => ({ id, format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name: id, expressions: names.map(name => ({ name, preset: true })) });
const view: ExpressionView = { name: 'happy', preset: true, layer: 0, fadeSeconds: 0.4, suppress: { blink: false, mouth: false, brow: false }, active: false, weight: 0 };

it('shows the Expressions group only for a model with a triggerable expression', () => {
 const assets = [record('avatar_a', ['happy', 'aa']), record('avatar_b', ['aa', 'blink', 'eyeBlinkLeft'])];
 expect(hasTriggerableExpressions('avatar_a', assets)).toBe(true);
 expect(hasTriggerableExpressions('avatar_b', assets)).toBe(false);
 expect(hasTriggerableExpressions('avatar_missing', assets)).toBe(false);
 expect(hasTriggerableExpressions(null, assets)).toBe(false);
});

it('turns one field edit into full settings and rejects out-of-range values', () => {
 expect(editSettings(view, { layer: '3' })).toEqual({ layer: 3, fadeSeconds: 0.4, suppress: { blink: false, mouth: false, brow: false } });
 expect(editSettings(view, { fadeSeconds: '1.5' })?.fadeSeconds).toBe(1.5);
 expect(editSettings(view, { suppress: { mouth: true } })?.suppress).toEqual({ blink: false, mouth: true, brow: false });
 for (const fadeSeconds of ['', '-1', '6', 'x']) expect(editSettings(view, { fadeSeconds })).toBeNull();
 expect(editSettings(view, { layer: '16' })).toBeNull();
});
