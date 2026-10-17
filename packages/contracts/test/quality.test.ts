import { describe, expect, it } from "vitest";
import validApplied from "../../../fixtures/protocol/valid-applied.json";
import { FrameAppliedSchema, PatchOpSchema, QUALITY_PROFILES, SceneEntitySchema, qualityProfileFromQuery } from "../src/index";
describe("quality profiles", () => {
    it("keeps the frozen v1 values", () => {
        expect(QUALITY_PROFILES).toEqual({
            preview_v1: { id: "preview_v1", resolutionScale: 0.5, maxTextureSize: 1024, msaaSamples: 4 },
            production_v1: { id: "production_v1", resolutionScale: 1, maxTextureSize: 2048, msaaSamples: 4 },
            performance_v1: { id: "performance_v1", resolutionScale: 1, maxTextureSize: 1024, msaaSamples: 0 },
        });
        expect(Object.isFrozen(QUALITY_PROFILES.production_v1)).toBe(true);
    });
    it("reads a query value and falls back to production", () => {
        expect(qualityProfileFromQuery("performance_v1").id).toBe("performance_v1");
        expect(qualityProfileFromQuery("preview_v1").id).toBe("preview_v1");
        for (const value of [null, undefined, "", "ultra_v1", "production_v2"]) expect(qualityProfileFromQuery(value).id).toBe("production_v1");
    });
    it("accepts an acknowledgment with or without a known profile", () => {
        expect(FrameAppliedSchema.safeParse(validApplied).success).toBe(true);
        expect(FrameAppliedSchema.safeParse({ ...validApplied, qualityProfile: "performance_v1" }).success).toBe(true);
        expect(FrameAppliedSchema.safeParse({ ...validApplied, qualityProfile: "ultra_v1" }).success).toBe(false);
    });
});
describe("camera anti-aliasing", () => {
    const camera = { id: "camera_main", name: "Camera", visible: true, transform: { position: [0, 1, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: "camera", lens: { fovDegrees: 40, near: 0.01, far: 100 } };
    it("is optional and limited to the post-process modes", () => {
        expect(SceneEntitySchema.safeParse(camera).success).toBe(true);
        for (const mode of ["none", "fxaa"]) expect(SceneEntitySchema.safeParse({ ...camera, antiAliasing: mode }).success).toBe(true);
        for (const mode of ["smaa", "taa"]) expect(SceneEntitySchema.safeParse({ ...camera, antiAliasing: mode }).success).toBe(false);
    });
    it("has a patch operation", () => {
        expect(PatchOpSchema.safeParse({ kind: "setCameraAntiAliasing", entityId: "camera_main", antiAliasing: "fxaa" }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setCameraAntiAliasing", entityId: "camera_main" }).success).toBe(false);
    });
});
