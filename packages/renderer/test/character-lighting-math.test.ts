import { describe, expect, it } from 'vitest';
import type { LightSettings, SceneEntity, Vec3 } from '@opensekai/contracts';
import { CHARACTER_FILL, characterFill, equalize, FLAT_ROOM, normalizeRoom, rimFactor, shIrradiance, toonShading, type Sh } from '../src/character-lighting-math';

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

describe('room irradiance', () => {
    const close = (actual: readonly number[], expected: readonly number[]) => actual.forEach((x, i) => expect(x).toBeCloseTo(expected[i]!, 6));
    const luminance = (v: readonly number[]) => v[0]! * 0.2126 + v[1]! * 0.7152 + v[2]! * 0.0722;
    const zero = (): [number, number, number][] => Array.from({ length: 9 }, () => [0, 0, 0]);
    // A bright top and a dim bottom: band 0 plus a +Y band-1 term, with tint.
    const room: Sh = zero().map((c, i) => (i === 0 ? [2, 1.5, 1] : i === 1 ? [0.5, 0.4, 0.3] : c) as [number, number, number]);
    it('is a flat fill of 1 in all directions for FLAT_ROOM', () => {
        for (const n of [[1, 0, 0], [0, -1, 0], [0, 0, 1]] as Vec3[]) close(shIrradiance(FLAT_ROOM.sh, n), [1, 1, 1]);
        expect(FLAT_ROOM.average).toEqual([1, 1, 1]);
    });
    it('is brighter at +Y than at -Y for a positive +Y band-1 term', () => expect(shIrradiance(room, [0, 1, 0])[0]).toBeGreaterThan(shIrradiance(room, [0, -1, 0])[0]!));
    it('gives an average of luminance 1 after normalization', () => expect(luminance(normalizeRoom(room).average)).toBeCloseTo(1, 6));
    it('keeps the up and down ratio and the tint after normalization', () => {
        const raw = [shIrradiance(room, [0, 1, 0]), shIrradiance(room, [0, -1, 0])], {sh} = normalizeRoom(room);
        const [up, down] = [shIrradiance(sh, [0, 1, 0]), shIrradiance(sh, [0, -1, 0])];
        for (let i = 0; i < 3; i++) expect(up[i]! / down[i]!).toBeCloseTo(raw[0]![i]! / raw[1]![i]!, 6);
        expect(up[0]! / up[2]!).toBeCloseTo(raw[0]![0]! / raw[0]![2]!, 6);
    });
    it('does not change with the room level', () => close(normalizeRoom(room.map(c => c.map(x => x * 10) as [number, number, number])).average, normalizeRoom(room).average));
    it('gives finite numbers for a black room', () => {
        const { sh, average } = normalizeRoom(zero());
        for (const x of [...sh.flat(), ...average]) expect(Number.isFinite(x)).toBe(true);
    });
});

describe('CHARACTER_FILL', () => {
    it('has the level of half an ambient light', () => expect(CHARACTER_FILL).toBe(0.5));
});

describe('characterFill', () => {
    it('is white without a light entity', () => expect(characterFill([])).toEqual([1, 1, 1]));
    it('is the color times the intensity of an ambient light', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 })])).toEqual([0.5, 0, 0]));
    it('is black for a hidden ambient light', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 }, false)])).toEqual([0, 0, 0]));
    it('is black for an ambient light that does not affect characters', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5, affectCharacters: false })])).toEqual([0, 0, 0]));
    it('adds the ambient lights', () => expect(characterFill([light('a', { color: '#ff0000', intensity: 0.5 }), light('b', { color: '#0000ff', intensity: 0.25 })])).toEqual([0.5, 0, 0.25]));
});
