import type { Quat, SnowSettings, Vec3 } from '@opensekai/contracts';
import { planSpringSteps, type SpringClock } from './spring-grid';

export const SNOW = { upStart: 0.35, skyBand: 0.02, slideSeconds: 0.5, shedStart: 0.6, shedFull: 2, shedSeconds: 0.25, maskEdge: 0.1 } as const;
export const SNOW_FLAKES = 12_000;
export const SNOW_SKY_SIZE = 512;
/** Linear RGB. */
export const SNOW_COLOR: Vec3 = [0.92, 0.95, 1];
/** Linear RGB. */
export const SNOW_SHADE: Vec3 = [0.62, 0.7, 0.85];

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};
export const upFacing = (normalY: number): number => smoothstep(SNOW.upStart, 1, normalY);
export const skyExposure = (height: number, skyHeight: number): number => smoothstep(skyHeight - SNOW.skyBand, skyHeight, height);

export interface BuildUpInput { amount: number; up: number; sky: number; speed: number; rate: number; buildUpSeconds: number; meltSeconds: number; seconds: number }
export const buildUpStep = ({ amount, up, sky, speed, rate, buildUpSeconds, meltSeconds, seconds }: BuildUpInput): number => {
    const grow = rate / buildUpSeconds * up * sky;
    const melt = rate === 0 ? 1 / meltSeconds : 0;
    const decay = (up === 0 ? 1 / SNOW.slideSeconds : 0) + smoothstep(SNOW.shedStart, SNOW.shedFull, speed) / SNOW.shedSeconds;
    return Math.min(1, Math.max(0, amount + seconds * (grow - melt) - amount * Math.min(1, seconds * decay)));
};
export const snowMask = (amount: number, noise: number): number =>
    smoothstep(noise - SNOW.maskEdge, noise + SNOW.maskEdge, amount * (1 + 2 * SNOW.maskEdge) - SNOW.maskEdge);

export type FlakeMotion = Pick<SnowSettings, 'fallSpeed' | 'flutter' | 'windDirection' | 'windSpeed'>;
/** Box-local metres, each axis in [-size/2, size/2). `seed` has three values in [0, 1). */
export const flakePosition = (seed: Vec3, t: number, size: Vec3, { fallSpeed, flutter, windDirection, windSpeed }: FlakeMotion): Vec3 => {
    const angle = windDirection * Math.PI / 180, sway = 0.15 * flutter, turn = 2 * Math.PI;
    const wrap = (value: number, span: number) => ((value % span) + span) % span - span / 2;
    return [
        wrap(seed[0] * size[0] + Math.sin(angle) * windSpeed * t + Math.sin(t * (0.7 + seed[1]) + seed[2] * turn) * sway, size[0]),
        wrap(seed[1] * size[1] - fallSpeed * (0.75 + 0.5 * seed[2]) * t, size[1]),
        wrap(seed[2] * size[2] + Math.cos(angle) * windSpeed * t + Math.cos(t * (0.5 + seed[0]) + seed[1] * turn) * sway, size[2]),
    ];
};

/** The yaw of an entity rotation, in radians. */
export const boxYaw = ([x, y, z, w]: Quat): number => Math.atan2(2 * (w * y - x * z), 1 - 2 * (y * y + z * z));

/** Column-major 4 × 4: world → (u, v, height above the box bottom in metres, 1). */
export const skyMatrix = (position: Vec3, yaw: number, scale: Vec3): number[] => {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const ux = cos / scale[0], uz = -sin / scale[0], vx = sin / scale[2], vz = cos / scale[2];
    return [
        ux, vx, 0, 0,
        0, 0, 1, 0,
        uz, vz, 0, 0,
        0.5 - ux * position[0] - uz * position[2], 0.5 - vx * position[0] - vz * position[2], scale[1] / 2 - position[1], 1,
    ];
};

export const snowSteps = (previous: SpringClock | null, current: SpringClock): { reset: boolean; seconds: number } => {
    const plan = planSpringSteps(previous, current);
    return { reset: plan.reset, seconds: plan.fractions.length / 60 };
};
