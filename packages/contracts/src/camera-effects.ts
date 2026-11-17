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
export const CameraEffectsSchema = z.strictObject({
    lensDirt: CameraLensDirtSchema.optional(),
    vignetting: CameraVignettingSchema.optional(),
    nightVision: CameraNightVisionSchema.optional(),
    blur: CameraBlurSchema.optional(),
    pixelate: CameraPixelateSchema.optional(),
});
export type CameraLensDirt = z.infer<typeof CameraLensDirtSchema>;
export type CameraVignetting = z.infer<typeof CameraVignettingSchema>;
export type CameraNightVision = z.infer<typeof CameraNightVisionSchema>;
export type CameraBlur = z.infer<typeof CameraBlurSchema>;
export type CameraPixelate = z.infer<typeof CameraPixelateSchema>;
export type CameraEffects = z.infer<typeof CameraEffectsSchema>;
export type CameraEffectName = keyof CameraEffects;
export const DEFAULT_CAMERA_EFFECTS: Required<CameraEffects> = Object.freeze({
    lensDirt: Object.freeze({ assetId: null, intensity: 0.9, threshold: 0.5 }),
    vignetting: Object.freeze({ enabled: false, color: "#4c4c4c", alpha: 0.051, fadeOut: 0, blink: 0 }),
    nightVision: Object.freeze({ enabled: false, color: "#80ff80", alpha: 0.502 }),
    blur: Object.freeze({ enabled: false, intensity: 1 }),
    pixelate: Object.freeze({ enabled: false, intensity: 16 }),
});
