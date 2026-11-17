import type { CameraEffects, Id } from "@opensekai/contracts";
import { bloomCompositePixel, type Rgb, type Rgba } from "./grading-math";

// CPU reference of the camera effects (CAM-15, B37 R8–R16). `camera-effects.ts` has the same math as nodes.
// Colours are linear and premultiplied, as in the post chain.

/** The frame height in which the Blur and Pixelate units are given. */
export const EFFECTS_REFERENCE_HEIGHT = 1080;
export const LUMA: Rgb = [0.2126, 0.7152, 0.0722];
/** The size of the dirt light pass as a part of the drawing buffer. */
export const DIRT_RESOLUTION = 0.25;
/**
 * three's GaussianBlurNode uses its `sigma` argument for the tap count (3 + 2σ) and blurs with the Gaussian sigma (3 + 2σ) / 3,
 * in steps of the direction. This gives that real sigma.
 */
export const nodeSigma = (sigmaArgument: number) => (3 + 2 * sigmaArgument) / 3;
/** The Gaussian sigma of the dirt light, in texels of its pass. */
export const DIRT_SIGMA = 6;
/** The `sigma` argument of the dirt blur node, so that `nodeSigma(DIRT_NODE_SIGMA)` is `DIRT_SIGMA`. */
export const DIRT_NODE_SIGMA = (3 * DIRT_SIGMA - 3) / 2;
/** The width of the soft start above the threshold. */
export const DIRT_KNEE = 0.25;
/** The size of the blur pass as a part of the drawing buffer. */
export const BLUR_RESOLUTION = 0.5;
/** The `sigma` argument of the blur node (11 taps on each side). The strength changes the tap distance only. */
export const BLUR_SIGMA = 4;
/** The blur sigma in pixels of a 1080-line frame for Intensity 1. */
export const BLUR_PIXELS_PER_INTENSITY = 3;
/** The start of the vignette for Fade Out 0, as a part of the centre-to-corner distance. */
export const VIGNETTE_INNER = 0.5;
/** The soft edge of the Blink lid, as a part of the half frame height. */
export const BLINK_EDGE = 0.05;

export const EFFECT_ORDER = ["lensDirt", "blur", "nightVision", "pixelate", "vignetting"] as const;
export type EffectName = (typeof EFFECT_ORDER)[number];
export type ActiveEffects = Readonly<Record<EffectName, boolean>>;
export type Uv = readonly [number, number];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
};
const luma = (c: Rgba | Rgb) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** R8: the effects that change pixels. Lens dirt also needs its image to be loaded. */
export const activeEffects = (effects: CameraEffects | null | undefined, dirtReady: boolean): ActiveEffects => ({
    lensDirt: !!effects?.lensDirt && effects.lensDirt.assetId !== null && effects.lensDirt.intensity > 0 && dirtReady,
    blur: !!effects?.blur?.enabled && effects.blur.intensity > 0,
    nightVision: !!effects?.nightVision?.enabled && effects.nightVision.alpha > 0,
    pixelate: !!effects?.pixelate?.enabled && effects.pixelate.intensity > 1,
    vignetting: !!effects?.vignetting?.enabled && (effects.vignetting.alpha > 0 || effects.vignetting.blink > 0),
});

/** R9: the part of the effects that needs a new chain. Numbers are uniforms, so they are not in the key. */
export const effectsKey = (active: ActiveEffects, dirtAssetId: Id | null | undefined): string =>
    EFFECT_ORDER.filter(name => active[name]).map(name => (name === "lensDirt" ? `lensDirt:${dirtAssetId ?? ""}` : name)).join("+");

/** R10: the part of a pixel's light that goes into the dirt glow. */
export const dirtWeight = (lum: number, threshold: number) => smoothstep(threshold, threshold + DIRT_KNEE, lum);
export const dirtBrightPixel = (c: Rgba, threshold: number): Rgb => {
    const w = dirtWeight(luma(c), threshold);
    return [c[0] * w, c[1] * w, c[2] * w];
};
/** R10: a centred cover fit of the dirt image on the frame. */
export const dirtUv = (uv: Uv, frameAspect: number, dirtAspect: number): Uv => {
    const k = frameAspect / dirtAspect;
    return [(uv[0] - 0.5) * Math.min(k, 1) + 0.5, (uv[1] - 0.5) * Math.min(1 / k, 1) + 0.5];
};
/** R10: the dirt light. `dirt` is the linear image colour with straight alpha. */
export const dirtAdd = (dirt: Rgba, glow: Rgb, intensity: number): Rgb =>
    [dirt[0] * dirt[3] * glow[0] * intensity, dirt[1] * dirt[3] * glow[1] * intensity, dirt[2] * dirt[3] * glow[2] * intensity];
/** R10: the dirt light adds coverage with the bloom rule. */
export const dirtCompositePixel = (c: Rgba, add: Rgb): Rgba => bloomCompositePixel(c, add);

/** R11: the blur sigma in drawing-buffer pixels. */
export const blurSigmaPixels = (intensity: number, height: number) => (BLUR_PIXELS_PER_INTENSITY * intensity * height) / EFFECTS_REFERENCE_HEIGHT;
/** R11: the direction scale of the fixed blur kernel, so that the real sigma is `blurSigmaPixels`. */
export const blurStep = (intensity: number, height: number) => (blurSigmaPixels(intensity, height) * BLUR_RESOLUTION) / nodeSigma(BLUR_SIGMA);

/** R12: a mix with the tinted luminance. The alpha does not change. */
export const nightVisionPixel = (c: Rgba, tint: Rgb, alpha: number): Rgba => {
    const lum = luma(c);
    const mix = (x: number, i: number) => x + (lum * tint[i] - x) * alpha;
    return [mix(c[0], 0), mix(c[1], 1), mix(c[2], 2), c[3]];
};

/** R13: the block size in drawing-buffer pixels. */
export const blockSize = (intensity: number, height: number) => Math.max(1, Math.round((intensity * height) / EFFECTS_REFERENCE_HEIGHT));
/** R13: the UV of the block centre, on a pixel centre of the frame, so that a linear filter reads one pixel. */
export const pixelateUv = (uv: Uv, size: Uv, block: number): Uv => {
    const snap = (x: number, n: number) => clamp((Math.floor((x * n) / block) * block + Math.floor(block / 2) + 0.5) / n, 0.5 / n, 1 - 0.5 / n);
    return [snap(uv[0], size[0]), snap(uv[1], size[1])];
};

/** R14: 0 at the centre and 1 at a corner. */
export const vignetteDistance = (uv: Uv, aspect: number) =>
    Math.hypot((uv[0] - 0.5) * aspect, uv[1] - 0.5) / Math.hypot(aspect * 0.5, 0.5);
export const vignetteShape = (uv: Uv, aspect: number, fadeOut: number) =>
    smoothstep(VIGNETTE_INNER * (1 - fadeOut), 1, vignetteDistance(uv, aspect));
/** R14: a lid from the top and the bottom edges. 0 is open; 1 is closed. */
export const blinkLid = (v: number, blink: number) =>
    blink > 0 ? smoothstep(1 - blink - BLINK_EDGE, 1 - blink, Math.abs(2 * v - 1)) : 0;
export const vignetteStrength = (uv: Uv, aspect: number, alpha: number, fadeOut: number, blink: number) =>
    Math.max(alpha * vignetteShape(uv, aspect, fadeOut), blinkLid(uv[1], blink));
/** R14: the pixel goes to the tint at its own coverage. The alpha does not change. */
export const vignettingPixel = (c: Rgba, tint: Rgb, s: number): Rgba =>
    [c[0] * (1 - s) + tint[0] * c[3] * s, c[1] * (1 - s) + tint[1] * c[3] * s, c[2] * (1 - s) + tint[2] * c[3] * s, c[3]];
