import { describe, expect, it } from "vitest";
import { CameraGradingSchema, DEFAULT_CAMERA_GRADING, PatchOpSchema, SceneEntitySchema, gradingChainKey, isNeutralGrading, type CameraGrading } from "../src/index";
const camera = { id: "camera_main", name: "Camera", visible: true, transform: { position: [0, 1, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: "camera", lens: { fovDegrees: 40, near: 0.01, far: 100 } };
const graded = (change: Partial<CameraGrading>): CameraGrading => ({ ...DEFAULT_CAMERA_GRADING, ...change });
describe("camera grading", () => {
    it("is optional on a camera and checks each range", () => {
        expect(SceneEntitySchema.safeParse(camera).success).toBe(true);
        expect(SceneEntitySchema.safeParse({ ...camera, grading: DEFAULT_CAMERA_GRADING }).success).toBe(true);
        expect(CameraGradingSchema.safeParse(graded({ toneMapping: "neutral", exposure: -4, brightness: 1, contrast: -1, vibrance: 1, bloom: { intensity: 4, threshold: 4, radius: 1 } })).success).toBe(true);
        for (const bad of [{ exposure: 4.01 }, { brightness: -1.01 }, { contrast: 1.01 }, { vibrance: Number.NaN }, { tint: "#FFFFFF" }, { tint: "white" }, { toneMapping: "agx" }, { bloom: { intensity: -0.1, threshold: 0.8, radius: 0.4 } }, { bloom: { intensity: 1, threshold: 0.8, radius: 1.1 } }])
            expect(CameraGradingSchema.safeParse({ ...DEFAULT_CAMERA_GRADING, ...bad }).success, JSON.stringify(bad)).toBe(false);
        const { tint: _tint, ...missing } = DEFAULT_CAMERA_GRADING;
        expect(CameraGradingSchema.safeParse(missing).success).toBe(false);
        expect(CameraGradingSchema.safeParse({ ...DEFAULT_CAMERA_GRADING, lut: "x" }).success).toBe(false);
    });
    it("has a patch operation that sets or removes the group", () => {
        expect(PatchOpSchema.safeParse({ kind: "setCameraGrading", entityId: "camera_main", grading: DEFAULT_CAMERA_GRADING }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setCameraGrading", entityId: "camera_main", grading: null }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setCameraGrading", entityId: "camera_main" }).success).toBe(false);
        expect(PatchOpSchema.safeParse({ kind: "setCameraGrading", entityId: "camera_main", grading: graded({ exposure: 9 }) }).success).toBe(false);
    });
    it("keeps frozen defaults that change no pixel", () => {
        expect(DEFAULT_CAMERA_GRADING).toEqual({ toneMapping: "none", exposure: 0, brightness: 0, contrast: 0, vibrance: 0, tint: "#ffffff", bloom: { intensity: 0, threshold: 0.8, radius: 0.4 } });
        expect(Object.isFrozen(DEFAULT_CAMERA_GRADING) && Object.isFrozen(DEFAULT_CAMERA_GRADING.bloom)).toBe(true);
        expect(isNeutralGrading(DEFAULT_CAMERA_GRADING)).toBe(true);
    });
    it("is neutral without a group and while only the unused bloom values change", () => {
        expect(isNeutralGrading(undefined)).toBe(true);
        expect(isNeutralGrading(null)).toBe(true);
        expect(isNeutralGrading(graded({ bloom: { intensity: 0, threshold: 2, radius: 1 } }))).toBe(true);
        for (const change of [{ toneMapping: "aces" }, { exposure: 0.1 }, { brightness: -0.1 }, { contrast: 0.1 }, { vibrance: 0.1 }, { tint: "#fffffe" }, { bloom: { intensity: 0.01, threshold: 0.8, radius: 0.4 } }] as Partial<CameraGrading>[])
            expect(isNeutralGrading(graded(change)), JSON.stringify(change)).toBe(false);
    });
    it("changes the chain key only for the tone mapping mode and the bloom or grading switch", () => {
        expect(gradingChainKey(undefined)).toBe("off");
        expect(gradingChainKey(DEFAULT_CAMERA_GRADING)).toBe("off");
        expect(gradingChainKey(graded({ exposure: 1 }))).toBe("none:clear");
        expect(gradingChainKey(graded({ exposure: -2, contrast: 0.5, tint: "#ff0000" }))).toBe("none:clear");
        expect(gradingChainKey(graded({ toneMapping: "aces" }))).toBe("aces:clear");
        expect(gradingChainKey(graded({ toneMapping: "neutral", bloom: { intensity: 1, threshold: 0.8, radius: 0.4 } }))).toBe("neutral:bloom");
        expect(gradingChainKey(graded({ bloom: { intensity: 2, threshold: 0.1, radius: 1 } }))).toBe("none:bloom");
    });
});
