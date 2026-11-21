import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_LENS, LensSchema, lensWithFocalLength, lensWithFovDegrees, normalizeLens, type CameraLens } from "../src/index";

const testLens = (partial?: Partial<CameraLens>): CameraLens => ({ ...DEFAULT_CAMERA_LENS, ...partial });

describe("LensSchema", () => {
    it("migrates a legacy fovDegrees/near/far triple to full Full Frame physical fields", () => {
        const parsed = LensSchema.parse({ fovDegrees: 45, near: 0.01, far: 100 });
        expect(parsed.sensorPreset).toBe("fullFrame");
        expect(parsed.fStop).toBe(DEFAULT_CAMERA_LENS.fStop);
        expect(parsed.focusDistance).toBe(DEFAULT_CAMERA_LENS.focusDistance);
        expect(parsed.autofocus).toBe(false);
        expect(parsed.near).toBe(0.01);
        expect(parsed.far).toBe(100);
        expect(parsed.focalLengthMm).toBeGreaterThan(0);
        expect(parsed.fovDegrees).toBeCloseTo(45, 6);
    });
    it("parses the full default lens unchanged", () => {
        expect(LensSchema.parse(DEFAULT_CAMERA_LENS)).toEqual(DEFAULT_CAMERA_LENS);
    });
    it("rejects an out-of-range fStop", () => {
        expect(() => LensSchema.parse(testLens({ fStop: 64 }))).toThrow();
    });
    it("rejects an out-of-range focal length", () => {
        expect(() => LensSchema.parse(testLens({ focalLengthMm: 500 }))).toThrow();
    });
    it("rejects far not greater than near", () => {
        expect(() => LensSchema.parse(testLens({ near: 100, far: 1 }))).toThrow();
        expect(() => LensSchema.parse({ fovDegrees: 45, near: 100, far: 1 })).toThrow();
    });
    it("rejects an unknown sensor preset", () => {
        expect(() => LensSchema.parse(testLens({ sensorPreset: "medium" as never }))).toThrow();
    });
    it("recomputes fovDegrees from the physical fields even when the input disagrees (D12)", () => {
        const stale = { ...testLens(), fovDegrees: 1 };
        expect(LensSchema.parse(stale).fovDegrees).toBeCloseTo(testLens().fovDegrees, 6);
    });
});

describe("normalizeLens", () => {
    it("returns null for input that is not an object", () => {
        expect(normalizeLens("nope")).toBeNull();
        expect(normalizeLens(null)).toBeNull();
        expect(normalizeLens(undefined)).toBeNull();
    });
    it("accepts a full physical lens and keeps its fields", () => {
        expect(normalizeLens(testLens({ focalLengthMm: 85, fStop: 1.8 }))).toMatchObject({ focalLengthMm: 85, fStop: 1.8, sensorPreset: "fullFrame" });
    });
    it("returns null for an object that is neither legacy nor full", () => {
        expect(normalizeLens({ fovDegrees: 45 })).toBeNull();
    });
});

describe("lensWithFocalLength / lensWithFovDegrees", () => {
    it("changes the focal length and derives a narrower fovDegrees for a longer lens", () => {
        const next = lensWithFocalLength(DEFAULT_CAMERA_LENS, 85);
        expect(next.focalLengthMm).toBe(85);
        expect(next.fovDegrees).toBeLessThan(DEFAULT_CAMERA_LENS.fovDegrees);
    });
    it("changes fovDegrees and derives a longer focal length for a narrower fov", () => {
        const next = lensWithFovDegrees(DEFAULT_CAMERA_LENS, 20);
        expect(next.fovDegrees).toBeCloseTo(20, 6);
        expect(next.focalLengthMm).toBeGreaterThan(DEFAULT_CAMERA_LENS.focalLengthMm);
    });
});
