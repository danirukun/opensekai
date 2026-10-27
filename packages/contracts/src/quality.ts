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
// Output formats of output_main (B22 R1). The simulation stays at 60 Hz; a frame limit is a render limit.
export const OUTPUT_SIZES: readonly Readonly<{ width: number; height: number }>[] = Object.freeze([
    Object.freeze({ width: 1920, height: 1080 }),
    Object.freeze({ width: 1600, height: 900 }),
    Object.freeze({ width: 1280, height: 720 }),
    Object.freeze({ width: 960, height: 540 }),
]);
export const OUTPUT_FRAME_LIMITS = Object.freeze([30, 60] as const);
export const OUTPUT_RENDER_SCALES = Object.freeze([0.5, 0.75, 1] as const);
export type OutputFrameLimit = (typeof OUTPUT_FRAME_LIMITS)[number];
export type OutputRenderScale = (typeof OUTPUT_RENDER_SCALES)[number];
export const isOutputSize = ({ width, height }: { width: number; height: number }): boolean =>
    OUTPUT_SIZES.some(size => size.width === width && size.height === height);
export const isDefaultOutputFormat = (output: { width: number; height: number; fps: number; renderScale?: number }): boolean =>
    output.width === 1920 && output.height === 1080 && output.fps === 60 && (output.renderScale ?? 1) === 1;
