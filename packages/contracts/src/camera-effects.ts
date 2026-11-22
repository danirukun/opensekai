import { z } from "zod";
// Camera effects (CAM-15, B37 R1–R2). Labels, defaults, and ranges come from Warudo 0.15.1.
const unit = z.number().finite().min(0).max(1);
// The same rules as `IdSchema` and `LightColorSchema`; schema.ts imports this file, so it cannot import them back.
const IdSchema = z.string().min(1).max(256);
const LightColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export const CameraLensDirtSchema = z.strictObject({
    assetId: IdSchema.nullable(),
    intensity: unit,
    threshold: unit,
});
export const CameraVignettingSchema = z.strictObject({
    enabled: z.boolean(),
    color: LightColorSchema,
    alpha: unit,
    fadeOut: unit,
    blink: unit,
});
export const CameraNightVisionSchema = z.strictObject({
    enabled: z.boolean(),
    color: LightColorSchema,
    alpha: unit,
});
export const CameraBlurSchema = z.strictObject({
    enabled: z.boolean(),
    intensity: z.number().finite().min(0).max(4),
});
export const CameraPixelateSchema = z.strictObject({
    enabled: z.boolean(),
    intensity: z.number().int().min(1).max(256),
});
// Look-stack effect groups (#343 R14-R17). Nested here, not in a separate `lensLook` schema (D9), so
// they share one `setCameraEffects` patch with the B37 groups above.
export const CameraDepthOfFieldSchema = z.strictObject({
    enabled: z.boolean(),
    highQuality: z.boolean(),
    focusSpeed: unit,
});
export const CameraLensFlareSchema = z.strictObject({
    enabled: z.boolean(),
    highQuality: z.boolean(),
    threshold: unit,
    intensity: z.number().finite().min(0).max(4),
});
export const CameraAnamorphicFlareSchema = z.strictObject({
    enabled: z.boolean(),
    highQuality: z.boolean(),
    intensity: unit,
    spread: unit,
    vertical: z.boolean(),
});
export const CameraFilmGrainSchema = z.strictObject({
    enabled: z.boolean(),
    intensity: unit,
});
export const CameraEffectsSchema = z.strictObject({
    lensDirt: CameraLensDirtSchema.optional(),
    vignetting: CameraVignettingSchema.optional(),
    nightVision: CameraNightVisionSchema.optional(),
    blur: CameraBlurSchema.optional(),
    pixelate: CameraPixelateSchema.optional(),
    depthOfField: CameraDepthOfFieldSchema.optional(),
    lensFlare: CameraLensFlareSchema.optional(),
    anamorphicFlare: CameraAnamorphicFlareSchema.optional(),
    filmGrain: CameraFilmGrainSchema.optional(),
});
export type CameraLensDirt = z.infer<typeof CameraLensDirtSchema>;
export type CameraVignetting = z.infer<typeof CameraVignettingSchema>;
export type CameraNightVision = z.infer<typeof CameraNightVisionSchema>;
export type CameraBlur = z.infer<typeof CameraBlurSchema>;
export type CameraPixelate = z.infer<typeof CameraPixelateSchema>;
export type CameraDepthOfField = z.infer<typeof CameraDepthOfFieldSchema>;
export type CameraLensFlare = z.infer<typeof CameraLensFlareSchema>;
export type CameraAnamorphicFlare = z.infer<typeof CameraAnamorphicFlareSchema>;
export type CameraFilmGrain = z.infer<typeof CameraFilmGrainSchema>;
export type CameraEffects = z.infer<typeof CameraEffectsSchema>;
export type CameraEffectName = keyof CameraEffects;
export const DEFAULT_CAMERA_EFFECTS: Required<CameraEffects> = Object.freeze({
    lensDirt: Object.freeze({ assetId: null, intensity: 0.9, threshold: 0.5 }),
    vignetting: Object.freeze({ enabled: false, color: "#4c4c4c", alpha: 0.051, fadeOut: 0, blink: 0 }),
    nightVision: Object.freeze({ enabled: false, color: "#80ff80", alpha: 0.502 }),
    blur: Object.freeze({ enabled: false, intensity: 1 }),
    pixelate: Object.freeze({ enabled: false, intensity: 16 }),
    depthOfField: Object.freeze({ enabled: false, highQuality: true, focusSpeed: 0.35 }),
    lensFlare: Object.freeze({ enabled: false, highQuality: true, threshold: 0.5, intensity: 1 }),
    anamorphicFlare: Object.freeze({ enabled: false, highQuality: true, intensity: 0.5, spread: 0.5, vertical: false }),
    filmGrain: Object.freeze({ enabled: false, intensity: 0.15 }),
});
