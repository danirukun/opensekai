import { z } from "zod";
// Camera color grading, tone mapping, and bloom (CAM-06 slice 1, R1–R6).
const n = z.number().finite();
export const CameraToneMappingSchema = z.enum(["none", "aces", "neutral"]);
export type CameraToneMapping = z.infer<typeof CameraToneMappingSchema>;
export const CameraBloomSchema = z.strictObject({
    intensity: n.min(0).max(4),
    threshold: n.min(0).max(4),
    radius: n.min(0).max(1),
});
export type CameraBloom = z.infer<typeof CameraBloomSchema>;
export const CameraGradingSchema = z.strictObject({
    toneMapping: CameraToneMappingSchema,
    /** In stops: the linear color is multiplied by 2^exposure. */
    exposure: n.min(-4).max(4),
    brightness: n.min(-1).max(1),
    contrast: n.min(-1).max(1),
    vibrance: n.min(-1).max(1),
    tint: z.string().regex(/^#[0-9a-f]{6}$/),
    bloom: CameraBloomSchema,
});
export type CameraGrading = z.infer<typeof CameraGradingSchema>;
export const DEFAULT_CAMERA_GRADING: CameraGrading = Object.freeze({
    toneMapping: "none",
    exposure: 0,
    brightness: 0,
    contrast: 0,
    vibrance: 0,
    tint: "#ffffff",
    bloom: Object.freeze({ intensity: 0, threshold: 0.8, radius: 0.4 }),
}) as CameraGrading;
/** True when the group changes no pixel. The bloom threshold and radius do not count while the intensity is 0 (R6). */
export const isNeutralGrading = (grading: CameraGrading | null | undefined): boolean =>
    !grading || (grading.toneMapping === "none" && grading.exposure === 0 && grading.brightness === 0 && grading.contrast === 0
        && grading.vibrance === 0 && grading.tint === "#ffffff" && grading.bloom.intensity === 0);
/** The part of a grading that needs a new post-processing chain when it changes; numbers are uniforms (R11). */
export const gradingChainKey = (grading: CameraGrading | null | undefined): string =>
    !grading || isNeutralGrading(grading) ? "off" : `${grading.toneMapping}:${grading.bloom.intensity > 0 ? "bloom" : "clear"}`;
