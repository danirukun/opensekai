import type { LightSettings, SceneEntity } from "@opensekai/contracts";

// CPU reference of the stage beam (stage beams R6 to R9). `beam.ts` builds the same product in TSL from these constants.

/** The beam pass size as a part of the drawing buffer. */
export const BEAM_RESOLUTION = 0.5;
/** The light Intensity at which the gain equals the beam intensity: the default spot Intensity. */
export const BEAM_REFERENCE_INTENSITY = 60;
export const BEAM_MAX_GAIN = 4;
/** The length for a Range of 0, as the spot helper outline. */
export const BEAM_DEFAULT_LENGTH = 5;
/** The largest full cone angle in degrees. */
export const BEAM_MAX_ANGLE = 120;
export const BEAM_BASE = 0.5;
/** Meters from the camera at which the near fade is 1. */
export const BEAM_NEAR_FADE = 0.5;
/** Meters in front of a scene surface at which the depth fade is 1. */
export const BEAM_DEPTH_FADE = 0.3;

const saturate = (x: number) => Math.min(1, Math.max(0, x));

export const beamGain = (light: LightSettings): number =>
    light.beam ? Math.min(BEAM_MAX_GAIN, (light.beam.intensity * light.intensity) / BEAM_REFERENCE_INTENSITY) : 0;

export const beamDraws = (entity: SceneEntity): boolean =>
    entity.kind === "light" && entity.visible && entity.light.type === "spot" && entity.light.beam?.enabled === true && beamGain(entity.light) > 0;

/** The cone along local −Z from the light: its length and its end radius in meters. */
export const beamShape = (light: LightSettings): { length: number; radius: number } => {
    const length = light.range > 0 ? light.range : BEAM_DEFAULT_LENGTH;
    const angle = Math.min(light.cone?.angleDegrees ?? BEAM_MAX_ANGLE, BEAM_MAX_ANGLE);
    return { length, radius: length * Math.tan((angle / 2) * Math.PI / 180) };
};

/** The radial length below which the cone normal is the axis direction, so the apex has a normal. */
export const BEAM_APEX_RADIUS = 1e-6;
/**
 * The exact outward normal of the cone x² + y² = z² (z ≤ 0) of `beamGeometry` at a local position (R9a). The material
 * uses this instead of the vertex normal, which is discontinuous at each segment edge of a three.js cone with a 0 top radius.
 */
export const beamConeNormal = ([x, y]: readonly [number, number, number]): [number, number, number] => {
    const radial = Math.max(Math.hypot(x, y), BEAM_APEX_RADIUS);
    const length = Math.hypot(x, y, radial);
    return [x / length, y / length, radial / length];
};

/** `t` is 0 at the light and 1 at the end of the cone. */
export const axisFade = (t: number): number => (1 - saturate(t)) ** 2;
/** `c` is the cosine between the surface normal and the view direction; a softer beam fades sooner toward its silhouette. */
export const edgeFade = (c: number, softness: number): number => Math.abs(c) ** (0.25 + 3.75 * softness);
export const nearFade = (d: number): number => saturate(d / BEAM_NEAR_FADE);
/** `g` is the distance from the beam point to the scene surface behind it; a point behind a surface has `g <= 0`. */
export const depthFade = (g: number): number => saturate(g / BEAM_DEPTH_FADE);
