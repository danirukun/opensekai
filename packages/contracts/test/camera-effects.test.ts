import { describe, expect, it } from "vitest";
import vectors from "../../../fixtures/protocol/validation-vectors.json";
import { CameraEffectsSchema, DEFAULT_CAMERA_EFFECTS, PatchOpSchema, SceneEntitySchema, SceneViewSchema, validateCall } from "../src/index";
const camera = { id: "camera_main", name: "Camera", visible: true, transform: { position: [0, 1, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: "camera", lens: { fovDegrees: 40, near: 0.01, far: 100 } };
const D = DEFAULT_CAMERA_EFFECTS;
const accepts = (effects: unknown) => CameraEffectsSchema.safeParse(effects).success && SceneEntitySchema.safeParse({ ...camera, effects }).success;
describe("camera effects schema (R1, R2, R4)", () => {
    it("is optional on a camera", () => {
        expect(SceneEntitySchema.safeParse(camera).success).toBe(true);
        expect("effects" in SceneEntitySchema.parse(camera)).toBe(false);
    });
    it.each([
        ["no group", {}],
        ["each group at its default", D],
        ["Pixelate 1", { pixelate: { enabled: true, intensity: 1 } }],
        ["Pixelate 256", { pixelate: { enabled: true, intensity: 256 } }],
        ["a lens dirt image", { lensDirt: { ...D.lensDirt, assetId: "image_dirt" } }],
        ["the range ends", { vignetting: { enabled: true, color: "#000000", alpha: 1, fadeOut: 1, blink: 1 }, blur: { enabled: true, intensity: 4 }, lensDirt: { assetId: null, intensity: 0, threshold: 1 } }],
    ])("accepts %s", (_, effects) => expect(accepts(effects)).toBe(true));
    it.each([
        ["an unknown key", { bloom: {} }],
        ["an unknown field in a group", { blur: { ...D.blur, radius: 1 } }],
        ["a missing field in a group", { vignetting: { enabled: true, color: "#4c4c4c", alpha: 0.1, fadeOut: 0 } }],
        ["Vignetting alpha 1.01", { vignetting: { ...D.vignetting, alpha: 1.01 } }],
        ["Fade Out -0.01", { vignetting: { ...D.vignetting, fadeOut: -0.01 } }],
        ["Blink 1.01", { vignetting: { ...D.vignetting, blink: 1.01 } }],
        ["Night Vision alpha -0.01", { nightVision: { ...D.nightVision, alpha: -0.01 } }],
        ["Lens Dirt Intensity 1.01", { lensDirt: { ...D.lensDirt, intensity: 1.01 } }],
        ["Threshold -0.01", { lensDirt: { ...D.lensDirt, threshold: -0.01 } }],
        ["an empty dirt ID", { lensDirt: { ...D.lensDirt, assetId: "" } }],
        ["Blur 4.01", { blur: { ...D.blur, intensity: 4.01 } }],
        ["Blur NaN", { blur: { ...D.blur, intensity: Number.NaN } }],
        ["Pixelate 0", { pixelate: { ...D.pixelate, intensity: 0 } }],
        ["Pixelate 257", { pixelate: { ...D.pixelate, intensity: 257 } }],
        ["Pixelate 16.5", { pixelate: { ...D.pixelate, intensity: 16.5 } }],
        ["an upper-case colour", { vignetting: { ...D.vignetting, color: "#4C4C4C" } }],
        ["a colour with alpha", { nightVision: { ...D.nightVision, color: "#4c4c4c80" } }],
        ["a null group", { blur: null }],
    ])("rejects %s", (_, effects) => expect(accepts(effects)).toBe(false));
    it("has frozen defaults with the Warudo values", () => {
        expect(D).toEqual({
            lensDirt: { assetId: null, intensity: 0.9, threshold: 0.5 },
            vignetting: { enabled: false, color: "#4c4c4c", alpha: 0.051, fadeOut: 0, blink: 0 },
            nightVision: { enabled: false, color: "#80ff80", alpha: 0.502 },
            blur: { enabled: false, intensity: 1 },
            pixelate: { enabled: false, intensity: 16 },
        });
        expect(Object.isFrozen(D) && Object.values(D).every(Object.isFrozen)).toBe(true);
        expect(CameraEffectsSchema.safeParse(D).success).toBe(true);
    });
});
describe("setCameraEffects (R3)", () => {
    it("sets or removes the group", () => {
        expect(PatchOpSchema.safeParse({ kind: "setCameraEffects", entityId: "camera_main", effects: D }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setCameraEffects", entityId: "camera_main", effects: null }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setCameraEffects", entityId: "camera_main" }).success).toBe(false);
        expect(PatchOpSchema.safeParse({ kind: "setCameraEffects", entityId: "camera_main", effects: { blur: { enabled: true, intensity: 5 } } }).success).toBe(false);
    });
});
describe("shared camera effects vectors (R4)", () => {
    const effectVectors = vectors.filter(v => v.name.includes("camera-effects"));
    it("has the vectors of R4", () => {
        expect(effectVectors.map(v => [v.name, v.valid])).toEqual([
            ["camera-effects-empty", true],
            ["camera-effects-defaults", true],
            ["camera-effects-pixelate-min", true],
            ["camera-effects-pixelate-max", true],
            ["camera-effects-unknown-key", false],
            ["camera-effects-unknown-field", false],
            ["camera-effects-missing-field", false],
            ["camera-effects-vignetting-alpha-over", false],
            ["camera-effects-fade-out-under", false],
            ["camera-effects-lens-dirt-intensity-over", false],
            ["camera-effects-lens-dirt-threshold-under", false],
            ["camera-effects-blur-over", false],
            ["camera-effects-pixelate-zero", false],
            ["camera-effects-pixelate-over", false],
            ["camera-effects-pixelate-fraction", false],
            ["camera-effects-color-upper-case", false],
            ["camera-effects-color-with-alpha", false],
            ["set-camera-effects", true],
            ["set-camera-effects-null", true],
            ["set-camera-effects-blur-over", false],
        ]);
    });
    it.each(effectVectors.map(v => [v.name, v] as const))("parses %s as its valid flag says", (_, v) => {
        if (v.target === "scene") expect(SceneViewSchema.safeParse(v.payload).success).toBe(v.valid);
        else expect(validateCall("scenePatch", v.payload).ok).toBe(v.valid);
    });
});
