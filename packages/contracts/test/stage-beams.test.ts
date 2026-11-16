import { describe, expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/validation-vectors.json';
import { LightSettingsSchema, SceneViewSchema, type LightSettings } from '../src/index';

const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const beam = { enabled: true, intensity: 1, softness: 0.5 };
const spot = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 40, penumbra: 0.3 }, ...patch });
const point = (patch: Partial<LightSettings> = {}): LightSettings => { const { cone: _, ...rest } = spot(); return { ...rest, type: 'point', ...patch }; };
const accepts = (settings: unknown) => LightSettingsSchema.safeParse(settings).success;

describe('light beam group (R1)', () => {
    it('accepts a spot light with the beam on or off, and without the group', () => {
        expect(accepts(spot({ beam }))).toBe(true);
        expect(accepts(spot({ beam: { ...beam, enabled: false } }))).toBe(true);
        expect(accepts(spot({ beam: { enabled: true, intensity: 0, softness: 0 } }))).toBe(true);
        expect(accepts(spot({ beam: { enabled: true, intensity: 4, softness: 1 } }))).toBe(true);
        expect(accepts(spot())).toBe(true);
    });
    it('accepts a point light only with the beam off', () => {
        expect(accepts(point({ beam: { ...beam, enabled: false } }))).toBe(true);
        expect(accepts(point({ beam }))).toBe(false);
        expect(accepts({ ...point(), type: 'directional', beam })).toBe(false);
    });
    it.each([
        ['an intensity of 4.01', { ...beam, intensity: 4.01 }],
        ['a negative intensity', { ...beam, intensity: -0.01 }],
        ['a softness of -0.01', { ...beam, softness: -0.01 }],
        ['a softness above 1', { ...beam, softness: 1.01 }],
        ['a missing field', { enabled: true, intensity: 1 }],
        ['an unknown field', { ...beam, color: '#ffffff' }],
        ['a null group', null],
    ])('rejects a beam with %s', (_, group) => expect(accepts({ ...spot(), beam: group })).toBe(false));
    it('keeps a light without the group unchanged', () => {
        expect('beam' in LightSettingsSchema.parse(spot())).toBe(false);
    });
});
describe('shared beam vectors (R2)', () => {
    const beamVectors = vectors.filter(v => v.name.includes('beam'));
    it('has the vectors of R2', () => {
        expect(beamVectors.map(v => [v.name, v.valid])).toEqual([
            ['light-spot-beam', true],
            ['light-spot-beam-off', true],
            ['light-point-beam-off', true],
            ['light-point-beam', false],
            ['light-beam-intensity-over-limit', false],
            ['light-beam-negative-softness', false],
            ['light-beam-unknown-field', false],
        ]);
    });
    it.each(beamVectors.map(v => [v.name, v] as const))('parses %s as its valid flag says', (_, v) => {
        expect(SceneViewSchema.safeParse(v.payload).success).toBe(v.valid);
    });
});
