import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_EFFECTS, type CameraEffects } from "@opensekai/contracts";
import {
    DIRT_KNEE, EFFECT_ORDER, activeEffects, blinkLid, blockSize, blurSigmaPixels, blurStep, dirtAdd, dirtCompositePixel, dirtUv, dirtWeight,
    effectsKey, nightVisionPixel, pixelateUv, vignetteDistance, vignetteShape, vignetteStrength, vignettingPixel, type ActiveEffects,
} from "../src/camera-effects-math";
import { bloomCompositePixel, type Rgb, type Rgba } from "../src/grading-math";

const D = DEFAULT_CAMERA_EFFECTS;
const none: ActiveEffects = { lensDirt: false, blur: false, nightVision: false, pixelate: false, vignetting: false };
const close = (actual: readonly number[], expected: readonly number[], digits = 6) => actual.forEach((x, i) => expect(x).toBeCloseTo(expected[i], digits));
const steps = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
// Valid premultiplied pixels: each channel is at most the alpha.
const premultiplied: Rgba[] = steps(4).flatMap(a => steps(3).flatMap(r => steps(3).flatMap(g => steps(2).map(b => [r * a, g * a, b * a, a] as Rgba))));
const valid = (p: Rgba) => p.slice(0, 3).every(c => c <= p[3] + 1e-9 && c >= -1e-9);

describe("activeEffects (R8)", () => {
    it("has nothing on without a group or with the defaults", () => {
        expect(activeEffects(undefined, true)).toEqual(none);
        expect(activeEffects({}, true)).toEqual(none);
        expect(activeEffects(D, true)).toEqual(none);
    });
    it.each<[string, CameraEffects, boolean, Partial<ActiveEffects>]>([
        ["lens dirt with a loaded image", { lensDirt: { ...D.lensDirt, assetId: "image_a" } }, true, { lensDirt: true }],
        ["lens dirt that has not loaded", { lensDirt: { ...D.lensDirt, assetId: "image_a" } }, false, {}],
        ["lens dirt with Intensity 0", { lensDirt: { ...D.lensDirt, assetId: "image_a", intensity: 0 } }, true, {}],
        ["lens dirt without an image", { lensDirt: D.lensDirt }, true, {}],
        ["Blur on", { blur: { enabled: true, intensity: 1 } }, false, { blur: true }],
        ["Blur 0", { blur: { enabled: true, intensity: 0 } }, false, {}],
        ["Blur off", { blur: { enabled: false, intensity: 4 } }, false, {}],
        ["Night Vision on", { nightVision: { ...D.nightVision, enabled: true } }, false, { nightVision: true }],
        ["Night Vision alpha 0", { nightVision: { ...D.nightVision, enabled: true, alpha: 0 } }, false, {}],
        ["Pixelate 2", { pixelate: { enabled: true, intensity: 2 } }, false, { pixelate: true }],
        ["Pixelate 1", { pixelate: { enabled: true, intensity: 1 } }, false, {}],
        ["Vignetting on", { vignetting: { ...D.vignetting, enabled: true } }, false, { vignetting: true }],
        ["Vignetting alpha 0 with Blink 0.2", { vignetting: { ...D.vignetting, enabled: true, alpha: 0, blink: 0.2 } }, false, { vignetting: true }],
        ["Vignetting alpha 0 and Blink 0", { vignetting: { ...D.vignetting, enabled: true, alpha: 0, blink: 0 } }, false, {}],
        ["Vignetting off", { vignetting: { ...D.vignetting, alpha: 1 } }, false, {}],
    ])("%s", (_, effects, ready, on) => expect(activeEffects(effects, ready)).toEqual({ ...none, ...on }));
});

describe("effectsKey (R9)", () => {
    const all: ActiveEffects = { lensDirt: true, blur: true, nightVision: true, pixelate: true, vignetting: true };
    it("is empty with nothing on", () => expect(effectsKey(none, "image_a")).toBe(""));
    it("names the effects in chain order", () => {
        expect(EFFECT_ORDER).toEqual(["lensDirt", "blur", "nightVision", "pixelate", "vignetting"]);
        const key = effectsKey(all, "image_a");
        const at = (name: string) => key.indexOf(name);
        expect(at("lensDirt") < at("blur") && at("blur") < at("nightVision") && at("nightVision") < at("pixelate") && at("pixelate") < at("vignetting")).toBe(true);
    });
    it("has the dirt ID only while lens dirt is on", () => {
        expect(effectsKey(all, "image_a")).toContain("image_a");
        expect(effectsKey(all, "image_a")).not.toBe(effectsKey(all, "image_b"));
        expect(effectsKey({ ...all, lensDirt: false }, "image_a")).not.toContain("image_a");
        expect(effectsKey({ ...none, blur: true }, "image_a")).toBe(effectsKey({ ...none, blur: true }, null));
    });
    it("does not change for another number", () => {
        const a = activeEffects({ blur: { enabled: true, intensity: 1 }, pixelate: { enabled: true, intensity: 8 } }, false);
        const b = activeEffects({ blur: { enabled: true, intensity: 3.5 }, pixelate: { enabled: true, intensity: 200 } }, false);
        expect(effectsKey(a, null)).toBe(effectsKey(b, null));
    });
});

describe("lens dirt (R10)", () => {
    it("starts at the threshold with a soft knee", () => {
        expect(DIRT_KNEE).toBe(0.25);
        expect(dirtWeight(0.5, 0.5)).toBe(0);
        expect(dirtWeight(0.3, 0.5)).toBe(0);
        expect(dirtWeight(0.75, 0.5)).toBeCloseTo(1, 9);
        expect(dirtWeight(0.625, 0.5)).toBeCloseTo(0.5, 9);
    });
    it("fits the dirt image to cover the frame", () => {
        close(dirtUv([0.2, 0.7], 16 / 9, 16 / 9), [0.2, 0.7]);
        close(dirtUv([0.2, 0.7], 16 / 9, 1), [0.2, 0.5 + 0.2 * (9 / 16)]);
        close(dirtUv([0.2, 0.9], 16 / 9, 0.5), [0.2, 0.5 + 0.4 * (9 / 16) * 0.5]);
        close(dirtUv([0, 1], 16 / 9, 0.5), [0, 0.5 + 0.5 * (9 / 32)]);
    });
    it("composites with the bloom rule", () => {
        const add: Rgb = [0.2, 0.1, 0.05];
        for (const c of [[0, 0, 0, 0], [0.3, 0.2, 0.1, 0.5], [0.8, 0.8, 0.8, 1]] as Rgba[]) close(dirtCompositePixel(c, add), bloomCompositePixel(c, add));
        expect(dirtCompositePixel([0, 0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0, 0]);
    });
    it("adds the dirt light with the straight dirt alpha", () => {
        close(dirtAdd([1, 0.5, 0, 0.5], [0.4, 0.4, 0.4], 0.5), [0.1, 0.05, 0]);
        close(dirtAdd([1, 1, 1, 0], [1, 1, 1], 1), [0, 0, 0]);
    });
});

describe("blur (R11, R22)", () => {
    it("gives the sigma in pixels of the drawing buffer", () => {
        expect(blurSigmaPixels(1, 1080)).toBeCloseTo(3, 9);
        expect(blurStep(1, 1080)).toBeCloseTo(0.375, 9);
        expect(blurSigmaPixels(4, 540)).toBeCloseTo(6, 9);
        expect(blurSigmaPixels(0, 1080)).toBe(0);
        expect(blurStep(0, 1080)).toBe(0);
    });
});

describe("night vision (R12)", () => {
    it("mixes the tinted luminance by alpha", () => {
        expect(nightVisionPixel([0.3, 0.2, 0.1, 0.6], [0.2, 1, 0.2], 0)).toEqual([0.3, 0.2, 0.1, 0.6]);
        close(nightVisionPixel([0.5, 0.5, 0.5, 0.5], [0.2, 1, 0.2], 1), [0.1, 0.5, 0.1, 0.5]);
        expect(nightVisionPixel([0, 0, 0, 0], [0.2, 1, 0.2], 1)).toEqual([0, 0, 0, 0]);
    });
});

describe("pixelate (R13, R22)", () => {
    it("scales the block with the frame height", () => {
        expect(blockSize(16, 1080)).toBe(16);
        expect(blockSize(16, 540)).toBe(8);
        expect(blockSize(1, 1080)).toBe(1);
        expect(blockSize(1, 540)).toBe(1);
    });
    it("reads each pixel of a block at the block centre", () => {
        const size = [1920, 1080] as const;
        const centre = pixelateUv([(64 + 0.5) / 1920, (128 + 0.5) / 1080], size, 64);
        for (const [x, y] of [[64, 128], [100, 150], [127, 191]])
            close(pixelateUv([(x + 0.5) / 1920, (y + 0.5) / 1080], size, 64), centre);
        close(centre, [96 / 1920, 160 / 1080]);
    });
    it("stays inside the frame", () => {
        const size = [1920, 1080] as const;
        for (const u of steps(20)) for (const v of steps(20)) {
            const [a, b] = pixelateUv([u, v], size, 64);
            expect(a >= 0 && a <= 1 && b >= 0 && b <= 1).toBe(true);
        }
    });
});

describe("vignetting (R14)", () => {
    const aspect = 16 / 9;
    it("measures 0 at the centre and 1 at a corner", () => {
        expect(vignetteDistance([0.5, 0.5], aspect)).toBe(0);
        expect(vignetteDistance([0, 0], aspect)).toBeCloseTo(1, 9);
        expect(vignetteDistance([1, 1], aspect)).toBeCloseTo(1, 9);
        expect(vignetteShape([0.5, 0.5], aspect, 0)).toBe(0);
        expect(vignetteShape([0, 1], aspect, 0)).toBeCloseTo(1, 9);
    });
    it("starts at half the distance for Fade Out 0 and at the centre for Fade Out 1", () => {
        const at = (d: number): [number, number] => [0.5 + d * 0.5, 0.5 + d * 0.5];
        for (const d of [0, 0.1, 0.25, 0.4, 0.5]) expect(vignetteShape(at(d), aspect, 0)).toBe(0);
        expect(vignetteShape(at(0.25), aspect, 1)).toBeGreaterThan(0);
    });
    it("closes a lid from the top and the bottom", () => {
        for (const v of steps(10)) {
            expect(blinkLid(v, 0)).toBe(0);
            expect(blinkLid(v, 1)).toBe(1);
        }
        expect(blinkLid(0.5, 0.5)).toBe(0);
        expect(blinkLid(0, 0.5)).toBe(1);
        expect(blinkLid(1, 0.5)).toBe(1);
    });
    it("takes the stronger of the vignette and the lid", () => {
        expect(vignetteStrength([0.5, 0.5], aspect, 1, 0, 0)).toBe(0);
        expect(vignetteStrength([0, 0], aspect, 0.051, 0, 0)).toBeCloseTo(0.051, 9);
        expect(vignetteStrength([0.5, 0.5], aspect, 0, 0, 1)).toBe(1);
    });
    it("goes to the tint times the alpha and keeps the alpha", () => {
        const tint: Rgb = [0.3, 0.3, 0.3];
        close(vignettingPixel([0.6, 0.4, 0.2, 0.8], tint, 1), [0.24, 0.24, 0.24, 0.8]);
        expect(vignettingPixel([0.6, 0.4, 0.2, 0.8], tint, 0)).toEqual([0.6, 0.4, 0.2, 0.8]);
        for (const s of steps(4)) expect(vignettingPixel([0, 0, 0, 0], tint, s)).toEqual([0, 0, 0, 0]);
    });
});

describe("alpha rules (R15)", () => {
    const tints: Rgb[] = [[0, 0, 0], [1, 1, 1], [0.2, 1, 0.2], [0.07, 0.07, 0.07]];
    it("keeps each pixel valid and its alpha for night vision and vignetting", () => {
        for (const p of premultiplied) for (const tint of tints) for (const k of steps(4)) {
            const n = nightVisionPixel(p, tint, k);
            const v = vignettingPixel(p, tint, k);
            expect(n[3]).toBe(p[3]);
            expect(v[3]).toBe(p[3]);
            expect(valid(n) && valid(v), JSON.stringify([p, tint, k])).toBe(true);
        }
    });
    it("gives pixelate a sample of a valid input pixel", () => {
        const size = [8, 8] as const;
        const image = Array.from({ length: 64 }, (_, i) => premultiplied[(i * 37) % premultiplied.length]);
        const read = ([u, v]: readonly [number, number]) => image[Math.min(7, Math.floor(v * 8)) * 8 + Math.min(7, Math.floor(u * 8))];
        for (const u of steps(16)) for (const v of steps(16)) {
            const p = read(pixelateUv([u, v], size, 3));
            expect(image).toContain(p);
            expect(valid(p)).toBe(true);
        }
    });
    it("keeps a transparent pixel transparent", () => {
        const zero: Rgba = [0, 0, 0, 0];
        for (const tint of tints) {
            expect(nightVisionPixel(zero, tint, 1)).toEqual(zero);
            expect(vignettingPixel(zero, tint, 1)).toEqual(zero);
        }
        expect(dirtCompositePixel(zero, [0, 0, 0])).toEqual(zero);
    });
});
