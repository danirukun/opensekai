// Physical camera lens shape, defaults, and legacy migrate (CAM-16, Task 2). No schema dependency; `schema.ts` validates ranges.
import { SENSOR_PRESETS, focalLengthMmFromVerticalFov, verticalFovDegrees, type SensorPresetId } from "./lens-math";

export interface CameraLens {
    focalLengthMm: number;
    fStop: number;
    focusDistance: number;
    autofocus: boolean;
    sensorPreset: SensorPresetId;
    fovDegrees: number;
    near: number;
    far: number;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const LEGACY_LENS_KEYS = ["fovDegrees", "near", "far"] as const;
const isLegacyLensShape = (v: Record<string, unknown>): boolean =>
    Object.keys(v).length === 3 && LEGACY_LENS_KEYS.every(key => key in v);

// fovDegrees is always derived from the physical fields (D12), so a hand-edited document cannot drift from its lens.
const withRecomputedFov = (lens: Omit<CameraLens, "fovDegrees">): CameraLens => ({
    ...lens,
    fovDegrees: verticalFovDegrees(lens.focalLengthMm, SENSOR_PRESETS[lens.sensorPreset].heightMm)
});

export const DEFAULT_CAMERA_LENS: CameraLens = Object.freeze(withRecomputedFov({
    focalLengthMm: 50,
    fStop: 4,
    focusDistance: 3,
    autofocus: false,
    sensorPreset: "fullFrame",
    near: 0.01,
    far: 100
}));

/**
 * Accepts a full physical lens or a legacy `{fovDegrees,near,far}` triple and always yields the
 * full physical shape (D12). Legacy input migrates once through Full Frame. Returns null for
 * input the schema should reject on its own terms (wrong types, unknown sensor preset, and so on).
 */
export function normalizeLens(input: unknown): CameraLens | null {
    if (!input || typeof input !== "object") return null;
    const v = input as Record<string, unknown>;
    if (isLegacyLensShape(v) && isFiniteNumber(v.fovDegrees) && isFiniteNumber(v.near) && isFiniteNumber(v.far)) {
        const sensorPreset: SensorPresetId = "fullFrame";
        return withRecomputedFov({
            focalLengthMm: focalLengthMmFromVerticalFov(v.fovDegrees, SENSOR_PRESETS[sensorPreset].heightMm),
            fStop: DEFAULT_CAMERA_LENS.fStop,
            focusDistance: DEFAULT_CAMERA_LENS.focusDistance,
            autofocus: DEFAULT_CAMERA_LENS.autofocus,
            sensorPreset,
            near: v.near,
            far: v.far
        });
    }
    const sensorPreset = v.sensorPreset as SensorPresetId;
    if (!isFiniteNumber(v.focalLengthMm) || !(sensorPreset in SENSOR_PRESETS) || !isFiniteNumber(v.near) || !isFiniteNumber(v.far)) return null;
    return withRecomputedFov({
        focalLengthMm: v.focalLengthMm,
        fStop: isFiniteNumber(v.fStop) ? v.fStop : DEFAULT_CAMERA_LENS.fStop,
        focusDistance: isFiniteNumber(v.focusDistance) ? v.focusDistance : DEFAULT_CAMERA_LENS.focusDistance,
        autofocus: typeof v.autofocus === "boolean" ? v.autofocus : DEFAULT_CAMERA_LENS.autofocus,
        sensorPreset,
        near: v.near,
        far: v.far
    });
}

export const lensWithFocalLength = (lens: CameraLens, focalLengthMm: number): CameraLens => withRecomputedFov({ ...lens, focalLengthMm });

export const lensWithFovDegrees = (lens: CameraLens, fovDegrees: number): CameraLens => withRecomputedFov({
    ...lens,
    focalLengthMm: focalLengthMmFromVerticalFov(fovDegrees, SENSOR_PRESETS[lens.sensorPreset].heightMm)
});

// A sensor change keeps the focal length and recomputes fovDegrees for the new sensor (D12).
export const lensWithSensorPreset = (lens: CameraLens, sensorPreset: SensorPresetId): CameraLens => withRecomputedFov({ ...lens, sensorPreset });
