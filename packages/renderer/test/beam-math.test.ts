import { describe, expect, it } from 'vitest';
import type { LightSettings, SceneEntity } from '@opensekai/contracts';
import { BEAM_DEFAULT_LENGTH, BEAM_DEPTH_FADE, BEAM_MAX_GAIN, BEAM_NEAR_FADE, axisFade, beamConeNormal, beamDraws, beamGain, beamShape, depthFade, edgeFade, nearFade } from '../src/beam-math';
import { SPOT_HELPER_LENGTH } from '../src/editor-viewport';

const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const beam = { enabled: true, intensity: 1, softness: 0.5 };
const spot = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ffffff', intensity: 60, range: 12, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 14, penumbra: 0.4 }, beam, ...patch });
const entity = (light: LightSettings, visible = true): SceneEntity => ({ id: 'key', name: 'Light', visible, transform: { position: [0, 3, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light });
const deg = (d: number) => d * Math.PI / 180;

describe('beamDraws (R6)', () => {
    it('draws for a visible spot light with the beam on', () => expect(beamDraws(entity(spot()))).toBe(true));
    it.each([
        ['a hidden light', entity(spot(), false)],
        ['a point light', entity({ ...spot(), type: 'point', beam: { ...beam, enabled: false } })],
        ['a light without the group', entity(spot({ beam: undefined }))],
        ['a beam that is off', entity(spot({ beam: { ...beam, enabled: false } }))],
        ['a light Intensity of 0', entity(spot({ intensity: 0 }))],
        ['a beam intensity of 0', entity(spot({ beam: { ...beam, intensity: 0 } }))],
    ])('does not draw for %s', (_, e) => expect(beamDraws(e)).toBe(false));
    it('does not draw for another entity kind', () => {
        expect(beamDraws({ id: 'm', name: 'm', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'mesh', source: { kind: 'box' } })).toBe(false);
    });
});
describe('beamShape (R7)', () => {
    it('uses the Range and the Angle', () => {
        const shape = beamShape(spot());
        expect(shape.length).toBe(12);
        expect(shape.radius).toBeCloseTo(12 * Math.tan(deg(7)), 10);
    });
    it('uses the default length for a Range of 0', () => {
        expect(beamShape(spot({ range: 0 })).length).toBe(5);
        expect(BEAM_DEFAULT_LENGTH).toBe(SPOT_HELPER_LENGTH);
    });
    it('limits the cone angle to 120 degrees', () => {
        expect(beamShape(spot({ cone: { angleDegrees: 170, penumbra: 0 } })).radius).toBeCloseTo(12 * Math.tan(deg(60)), 10);
    });
});
describe('beamGain (R8)', () => {
    it.each([
        [60, 1, 1],
        [30, 1, 0.5],
        [600, 4, BEAM_MAX_GAIN],
        [0, 2, 0],
    ])('gives %s × %s a gain of %s', (intensity, beamIntensity, gain) => {
        expect(beamGain(spot({ intensity, beam: { ...beam, intensity: beamIntensity } }))).toBeCloseTo(gain, 10);
    });
    it('is 0 without a beam group', () => expect(beamGain(spot({ beam: undefined }))).toBe(0));
});
describe('fades (R9)', () => {
    it('fades along the axis', () => {
        expect(axisFade(0)).toBe(1);
        expect(axisFade(0.5)).toBeCloseTo(0.25, 10);
        expect(axisFade(1)).toBe(0);
        expect(axisFade(1.5)).toBe(0);
    });
    it('fades at the edge by the softness', () => {
        for (const softness of [0, 0.5, 1]) expect(edgeFade(1, softness)).toBe(1);
        expect(edgeFade(0, 0.5)).toBe(0);
        expect(edgeFade(0.5, 0)).toBeCloseTo(0.5 ** 0.25, 10);
        expect(edgeFade(0.5, 1)).toBeCloseTo(0.5 ** 4, 10);
        expect(edgeFade(-0.5, 0)).toBeCloseTo(0.5 ** 0.25, 10);
    });
    it.each([
        ['nearFade', nearFade, BEAM_NEAR_FADE],
        ['depthFade', depthFade, BEAM_DEPTH_FADE],
    ] as const)('%s goes from 0 to 1 over its distance', (_, fade, distance) => {
        expect(fade(0)).toBe(0);
        expect(fade(distance / 2)).toBeCloseTo(0.5, 10);
        expect(fade(distance)).toBe(1);
        expect(fade(distance * 3)).toBe(1);
        expect(fade(-1)).toBe(0);
    });
});

describe('beamConeNormal (R9a)', () => {
    const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, v, i) => sum + v * b[i]!, 0);
    it('is a unit normal of the cone surface that points out of the cone', () => {
        for (const angle of [0, 7.5, 33, 90, 181, 300])
            for (const z of [-0.01, -0.4, -1]) {
                const r = -z, p = [r * Math.cos(deg(angle)), r * Math.sin(deg(angle)), z] as [number, number, number];
                const n = beamConeNormal(p);
                expect(Math.hypot(...n)).toBeCloseTo(1, 12);
                // The generator line from the apex through p lies in the surface.
                expect(dot(n, p)).toBeCloseTo(0, 12);
                expect(dot(n, [p[0], p[1], 0])).toBeGreaterThan(0);
            }
    });
    it('changes continuously around the cone, also across a segment edge', () => {
        const edge = deg(7.5), step = 1e-4;
        const at = (a: number): [number, number, number] => [0.05 * Math.cos(a), 0.05 * Math.sin(a), -0.05];
        expect(Math.acos(Math.min(1, dot(beamConeNormal(at(edge - step)), beamConeNormal(at(edge + step)))))).toBeLessThan(1e-3);
    });
    it('is the axis direction at the apex', () => {
        expect(beamConeNormal([0, 0, 0])).toEqual([0, 0, 1]);
    });
});
