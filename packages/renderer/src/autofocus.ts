import type { CameraLens, CameraNavigation, Id, Vec3 } from "@opensekai/contracts";

// Autofocus on the Focus Character head (#343 R7). Pure math only; the renderer resolves the VRM head
// bone world position (when present) with Three.js and falls back to this offset otherwise.
export const HEAD_FALLBACK_OFFSET: Vec3 = [0, 1.5, 0];

export const headFallbackPosition = (rootPosition: Vec3): Vec3 => [
    rootPosition[0] + HEAD_FALLBACK_OFFSET[0],
    rootPosition[1] + HEAD_FALLBACK_OFFSET[1],
    rootPosition[2] + HEAD_FALLBACK_OFFSET[2],
];

export const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The Focus Character is the Orbit Character target (#168); other navigation modes have none.
export const focusCharacterId = (navigation: CameraNavigation | undefined): Id | null =>
    navigation?.mode === "orbitCharacter" ? navigation.targetId : null;

/**
 * Moves `current` toward `target` at a `focusSpeed` (0-1) lerp rate scaled to `dtSeconds`, so the same
 * `focusSpeed` reads the same at any frame rate: `1 - (1 - focusSpeed)^(dt*60)` is the rate at 60 Hz.
 */
export const focusedLens = (lens: CameraLens, focusDistance: number | null | undefined): CameraLens =>
    lens.autofocus && focusDistance != null ? { ...lens, focusDistance } : lens;

export function smoothFocusDistance(current: number, target: number, focusSpeed: number, dtSeconds: number): number {
    if (!(dtSeconds > 0)) return current;
    const rate = 1 - (1 - focusSpeed) ** (dtSeconds * 60);
    return current + (target - current) * rate;
}
