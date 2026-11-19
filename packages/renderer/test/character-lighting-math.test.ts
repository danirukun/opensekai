import { describe, expect, it } from 'vitest';
import type { LightSettings, SceneEntity } from '@opensekai/contracts';
import { characterFill, equalize, rimFactor, toonShading } from '../src/character-lighting-math';

const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'ambient', color: '#ffffff', intensity: 1, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}, visible = true): SceneEntity => ({ id, name: id, visible, transform: { position: [0, 2, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });

describe('toonShading', () => {
    it('goes to the shade color at full shadow and full strength', () => expect(toonShading(0.5, 0, 0.9, 0, 1)).toBe(0));
    it('keeps the lit value at zero strength', () => expect(toonShading(0.5, 0, 0.9, 0, 0)).toBe(1));
    it('mixes the shade by the strength', () => expect(toonShading(0.5, 0, 0.9, 0, 0.6)).toBeCloseTo(0.4, 10));
    it('is shade on the unlit side', () => expect(toonShading(-0.5, 0, 0.9, 1, 1)).toBe(0));
});

describe('rimFactor', () => {
    it('is strong at a grazing angle from behind', () => expect(rimFactor(0.05, -1, 0.5)).toBeGreaterThan(0.5));
    it('is zero when the light is in front', () => expect(rimFactor(0.05, 1, 0.5)).toBe(0));
    it('is zero at the face center', () => expect(rimFactor(1, -1, 0.5)).toBe(0));
    it('is wider with a larger width', () => expect(rimFactor(0.5, -1, 1)).toBeGreaterThan(rimFactor(0.5, -1, 0)));
});

describe('equalize', () => {
    it('mixes to the average at factor 1', () => expect(equalize([1, 0, 0], [0, 0, 1], 1)).toEqual([0, 0, 1]));
    it('keeps the sample at factor 0', () => expect(equalize([1, 0, 0], [0, 0, 1], 0)).toEqual([1, 0, 0]));
});

describe('characterFill', () => {
    it('is white without a light entity', () => expect(characterFill([])).toEqual([1, 1, 1]));
    it('is the color times the intensity of an ambient light', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 })])).toEqual([0.5, 0, 0]));
    it('is black for a hidden ambient light', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 }, false)])).toEqual([0, 0, 0]));
    it('is black for an ambient light that does not affect characters', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5, affectCharacters: false })])).toEqual([0, 0, 0]));
    it('adds the ambient lights', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 }), light('b', { color: '#0000ff', intensity: 0.25 })])).toEqual([0.5, 0, 0.25]));
});
