import { Color } from 'three';
import type { SceneEntity, Vec3 } from '@opensekai/contracts';
import { isLight, usesFixedAmbient } from './scene-lights';

export const RIM = Object.freeze({ backStart: -0.1, backEnd: 0.6 });
export const EXPONENT = Object.freeze({ narrow: 8, wide: 1.5 });
// The environment fill at environmentFill 1 and a white fill color, in the units of an ambient light intensity.
export const CHARACTER_FILL = 0.5;
// Rec. 709 luminance of linear sRGB, the working color space.
export const LUMINANCE = Object.freeze([0.2126, 0.7152, 0.0722] as const);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const linearstep = (a: number, b: number, x: number): number => clamp01((x - a) / (b - a));
const smoothstep = (a: number, b: number, x: number): number => { const t = linearstep(a, b, x); return t * t * (3 - 2 * t); };

export const toonShading = (dotNL: number, shift: number, toony: number, shadow: number, shadowStrength: number): number => {
    const f = 1 - toony;
    return linearstep(-f, f, dotNL + shift) * mix(1, shadow, shadowStrength);
};

export const rimExponent = (width: number): number => mix(EXPONENT.narrow, EXPONENT.wide, width);

export const rimFactor = (nDotV: number, lDotV: number, width: number): number =>
    Math.pow(clamp01(1 - nDotV), rimExponent(width)) * smoothstep(RIM.backStart, RIM.backEnd, -lDotV);

export const equalize = (sample: Vec3, average: Vec3, factor: number): Vec3 =>
    [mix(sample[0], average[0], factor), mix(sample[1], average[1], factor), mix(sample[2], average[2], factor)];

// Nine RGB triples, in the order of `SphericalHarmonics3.coefficients`.
export type Sh = readonly Vec3[];

// `SphericalHarmonics3.getIrradianceAt` and `getShIrradianceAt` of three r187.
export const shIrradiance = (sh: Sh, [x, y, z]: Vec3): Vec3 => {
    const basis = [0.886227, 2 * 0.511664 * y, 2 * 0.511664 * z, 2 * 0.511664 * x, 2 * 0.429043 * x * y, 2 * 0.429043 * y * z, 0.743125 * z * z - 0.247708, 2 * 0.429043 * x * z, 0.429043 * (x * x - y * y)];
    return [0, 1, 2].map(c => sh.reduce((sum, coefficient, i) => sum + coefficient[c]! * basis[i]!, 0)) as unknown as Vec3;
};

// The room gives direction and tint, not level: the coefficients and the average of the irradiance at world up and world down
// are divided by the luminance of that average.
export const normalizeRoom = (sh: Sh): { sh: Vec3[]; average: Vec3 } => {
    const [up, down] = [shIrradiance(sh, [0, 1, 0]), shIrradiance(sh, [0, -1, 0])];
    const average: Vec3 = [(up[0] + down[0]) / 2, (up[1] + down[1]) / 2, (up[2] + down[2]) / 2];
    const level = Math.max(average[0] * LUMINANCE[0] + average[1] * LUMINANCE[1] + average[2] * LUMINANCE[2], 1e-4);
    const scale = (v: Vec3): Vec3 => [v[0] / level, v[1] / level, v[2] / level];
    return { sh: sh.map(scale), average: scale(average) };
};

// An irradiance of 1 in all directions: only coefficient 0 is non-zero.
export const FLAT_ROOM: { sh: Vec3[]; average: Vec3 } = Object.freeze({
    sh: Array.from({ length: 9 }, (_, i): Vec3 => (i === 0 ? [1 / 0.886227, 1 / 0.886227, 1 / 0.886227] : [0, 0, 0])),
    average: [1, 1, 1] as Vec3,
});

export function characterFill(entities: readonly SceneEntity[]): Vec3 {
    if (usesFixedAmbient(entities)) return [1, 1, 1];
    return entities.filter(isLight).filter(e => e.light.type === 'ambient' && e.visible && e.light.affectCharacters)
        .reduce<Vec3>((sum, e) => { const { r, g, b } = new Color(e.light.color); const k = e.light.intensity; return [sum[0] + r * k, sum[1] + g * k, sum[2] + b * k]; }, [0, 0, 0]);
}
