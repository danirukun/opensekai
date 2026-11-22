// Physical lens math (CAM-16, Task 1). Pure functions, no schema or renderer dependency.

export type SensorPresetId = "fullFrame" | "super35" | "apsC" | "mft";

// Sizes in mm. Full Frame = 36x24 (ARRI/Sony standard). Super 35 = 24.89x18.66 (ARRI Alexa active area).
// APS-C = 23.6x15.6 (Sony/Nikon DX). MFT = 17.3x13 (Micro Four Thirds standard).
export const SENSOR_PRESETS: Readonly<Record<SensorPresetId, { widthMm: number; heightMm: number; label: string }>> = Object.freeze({
  fullFrame: Object.freeze({ widthMm: 36, heightMm: 24, label: "Full Frame" }),
  super35: Object.freeze({ widthMm: 24.89, heightMm: 18.66, label: "Super 35" }),
  apsC: Object.freeze({ widthMm: 23.6, heightMm: 15.6, label: "APS-C" }),
  mft: Object.freeze({ widthMm: 17.3, heightMm: 13, label: "MFT" }),
});

const MIN_FOV_DEGREES = 1;
const MAX_FOV_DEGREES = 179;

export function verticalFovDegrees(focalLengthMm: number, sensorHeightMm: number): number {
  return 2 * Math.atan(sensorHeightMm / 2 / focalLengthMm) * (180 / Math.PI);
}

export function focalLengthMmFromVerticalFov(fovDegrees: number, sensorHeightMm: number): number {
  const clamped = Math.min(Math.max(fovDegrees, MIN_FOV_DEGREES), MAX_FOV_DEGREES);
  return sensorHeightMm / 2 / Math.tan((clamped * (Math.PI / 180)) / 2);
}

// three.js `filmGauge` is the sensor width when aspect >= 1 (landscape).
export function filmGaugeMm(preset: SensorPresetId): number {
  return SENSOR_PRESETS[preset].widthMm;
}

export const BOKEH_K_FULL = 0.17;
export const BOKEH_K_CHEAP = 0.06;
export const BOKEH_MAX_FULL = 8;
export const BOKEH_MAX_CHEAP = 3;

// Heuristic bokeh circle-of-confusion scale, tuned in Task 6 against the concert fixture (Portrait 85mm f/1.8 full ≈ clamp).
export function bokehScale(focalLengthMm: number, fStop: number, quality: "full" | "cheap"): number {
  const k = quality === "cheap" ? BOKEH_K_CHEAP : BOKEH_K_FULL;
  const max = quality === "cheap" ? BOKEH_MAX_CHEAP : BOKEH_MAX_FULL;
  return Math.min(Math.max((focalLengthMm / fStop) * k, 0), max);
}

// World-unit falloff start for the DoF node's `focalLength` slot (not a focal length in mm).
export function dofFocalRangeWorld(focusDistance: number, fStop: number, quality: "full" | "cheap"): number {
  const cheapFactor = quality === "cheap" ? 1.5 : 1;
  return Math.max(0.05, focusDistance * (fStop / 32) * cheapFactor);
}

// Full Frame 85mm vertical FOV is about 16°, well under the 35° "too wide for a concert stage" threshold.
export function concertFocalLengthMm(): number {
  return 85;
}
