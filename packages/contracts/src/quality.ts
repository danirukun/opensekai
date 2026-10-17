import { z } from "zod";
export const QualityProfileIdSchema = z.enum(["preview_v1", "production_v1", "performance_v1"]);
export type QualityProfileId = z.infer<typeof QualityProfileIdSchema>;
export interface QualityProfile {
    readonly id: QualityProfileId;
    readonly resolutionScale: 1 | 0.5;
    readonly maxTextureSize: 1024 | 2048;
    readonly msaaSamples: 0 | 4;
}
// A profile is a frozen measurement setting: a changed value needs a new ID.
export const QUALITY_PROFILES: Readonly<Record<QualityProfileId, QualityProfile>> = Object.freeze({
    preview_v1: Object.freeze({ id: "preview_v1", resolutionScale: 0.5, maxTextureSize: 1024, msaaSamples: 4 }),
    production_v1: Object.freeze({ id: "production_v1", resolutionScale: 1, maxTextureSize: 2048, msaaSamples: 4 }),
    performance_v1: Object.freeze({ id: "performance_v1", resolutionScale: 1, maxTextureSize: 1024, msaaSamples: 0 }),
});
export const DEFAULT_QUALITY_PROFILE: QualityProfileId = "production_v1";
export const qualityProfileFromQuery = (value: string | null | undefined): QualityProfile => {
    const parsed = QualityProfileIdSchema.safeParse(value);
    return QUALITY_PROFILES[parsed.success ? parsed.data : DEFAULT_QUALITY_PROFILE];
};
export const CameraAntiAliasingSchema = z.enum(["none", "fxaa"]);
export type CameraAntiAliasing = z.infer<typeof CameraAntiAliasingSchema>;
