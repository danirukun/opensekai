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

// The room irradiance divided by the luminance of the room average: the room gives direction and tint, not level.
export const normalizeFill = (sample: Vec3, average: Vec3): Vec3 => {
    const level = Math.max(average[0] * LUMINANCE[0] + average[1] * LUMINANCE[1] + average[2] * LUMINANCE[2], 1e-4);
    return [sample[0] / level, sample[1] / level, sample[2] / level];
};

export function characterFill(entities: readonly SceneEntity[]): Vec3 {
    if (usesFixedAmbient(entities)) return [1, 1, 1];
    return entities.filter(isLight).filter(e => e.light.type === 'ambient' && e.visible && e.light.affectCharacters)
        .reduce<Vec3>((sum, e) => { const { r, g, b } = new Color(e.light.color); const k = e.light.intensity; return [sum[0] + r * k, sum[1] + g * k, sum[2] + b * k]; }, [0, 0, 0]);
}
