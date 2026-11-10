import type { CameraGrading, CameraToneMapping } from "@opensekai/contracts";

// CPU reference of the camera grading for one pixel (CAM-06 slice 1, R14). `grading.ts` has the same math in TSL.
// The curves are the three.js 0.187 formulas (`ToneMappingFunctions.js`). Colors are linear sRGB.
export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

/** The pivot of the contrast curve: middle gray in linear light. */
export const CONTRAST_PIVOT = 0.18;
/** Below this alpha a pixel has no color to grade. */
export const ALPHA_EPSILON = 1e-4;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const map = (c: Rgb, f: (x: number) => number): Rgb => [f(c[0]), f(c[1]), f(c[2])];
const mul3 = (m: readonly number[], c: Rgb): Rgb => [m[0] * c[0] + m[1] * c[1] + m[2] * c[2], m[3] * c[0] + m[4] * c[1] + m[5] * c[2], m[6] * c[0] + m[7] * c[1] + m[8] * c[2]];

// Rows of the matrices that three.js writes as `mat3(...)` in row order for the ACES fit.
const ACES_INPUT = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const ACES_OUTPUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const rrtOdtFit = (x: number) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);

export function acesFilmic(color: Rgb, exposure: number): Rgb {
    const scaled = map(color, x => (x * exposure) / 0.6);
    return map(mul3(ACES_OUTPUT, map(mul3(ACES_INPUT, scaled), rrtOdtFit)), clamp01);
}

export function neutral(color: Rgb, exposure: number): Rgb {
    const start = 0.8 - 0.04, desaturation = 0.15;
    const c = map(color, x => x * exposure);
    const low = Math.min(c[0], c[1], c[2]);
    const offset = low < 0.08 ? low - 6.25 * low * low : 0.04;
    const shifted = map(c, x => x - offset);
    const peak = Math.max(shifted[0], shifted[1], shifted[2]);
    if (peak < start) return shifted;
    const d = 1 - start;
    const newPeak = 1 - (d * d) / (peak + d - start);
    const scaled = map(shifted, x => x * (newPeak / peak));
    const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
    return map(scaled, x => x + (newPeak - x) * g);
}

export const toneMap = (mode: CameraToneMapping, color: Rgb, exposure: number): Rgb =>
    mode === "aces" ? acesFilmic(color, exposure) : mode === "neutral" ? neutral(color, exposure) : map(color, x => x * exposure);

/** three.js `vibrance`: moves each channel away from (or toward) the brightest channel by the color's saturation. */
export function vibrance(color: Rgb, adjustment: number): Rgb {
    const average = (color[0] + color[1] + color[2]) / 3;
    const peak = Math.max(color[0], color[1], color[2]);
    const amount = (peak - average) * adjustment * -3;
    return map(color, x => Math.max(0, x + (peak - x) * amount));
}

/** The least base of the contrast power: `pow(0, 0)` has no defined value in a shader. */
export const CONTRAST_FLOOR = 1e-6;
export const contrast = (color: Rgb, amount: number): Rgb =>
    map(color, x => CONTRAST_PIVOT * Math.pow(Math.max(x / CONTRAST_PIVOT, CONTRAST_FLOOR), 1 + amount));

const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
/** `#rrggbb` (sRGB) as a linear color, as three.js `Color.set` gives it. */
export const tintLinear = (hex: string): Rgb => [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as unknown as Rgb;

/** R10 for a color without alpha premultiplication. */
export function gradeColor(color: Rgb, grading: CameraGrading): Rgb {
    const tint = tintLinear(grading.tint);
    const mapped = toneMap(grading.toneMapping, color, Math.pow(2, grading.exposure));
    const bright = map(mapped, x => x * (1 + grading.brightness));
    const vivid = vibrance(contrast(bright, grading.contrast), grading.vibrance);
    // Display-referred color from 0 to 1: a brighter color times a partial alpha is not a valid premultiplied pixel.
    return [clamp01(vivid[0] * tint[0]), clamp01(vivid[1] * tint[1]), clamp01(vivid[2] * tint[2])];
}

/** R10 for a premultiplied pixel: a pixel without coverage stays `0, 0, 0, 0`. */
export function gradePixel(pixel: Rgba, grading: CameraGrading): Rgba {
    const a = pixel[3];
    if (a < ALPHA_EPSILON) return [0, 0, 0, 0];
    const graded = gradeColor([pixel[0] / a, pixel[1] / a, pixel[2] / a], grading);
    return [graded[0] * a, graded[1] * a, graded[2] * a, a];
}

/** R9: the bloom adds light, and its brightest channel becomes coverage. `bloom` already has the strength applied. */
export function bloomCompositePixel(scene: Rgba, bloom: Rgb): Rgba {
    const coverage = clamp01(Math.max(bloom[0], bloom[1], bloom[2]));
    return [scene[0] + bloom[0], scene[1] + bloom[1], scene[2] + bloom[2], scene[3] + (1 - scene[3]) * coverage];
}
