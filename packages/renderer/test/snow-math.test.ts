import { expect, it, describe } from 'vitest';
import { Matrix4, Vector4 } from 'three/webgpu';
import { SNOW, boxYaw, buildUpStep, flakePosition, skyExposure, skyMatrix, snowMask, snowSteps, upFacing } from '../src/snow-math';

const base = { amount: 0, up: 1, sky: 1, speed: 0, rate: 1, buildUpSeconds: 45, meltSeconds: 20, seconds: 1 / 60 };
const still = { fallSpeed: 1, flutter: 0, windDirection: 0, windSpeed: 0 };
const clock = (tick: number, resets = 0, sessionId = 's') => ({ sessionId, tick, elapsedMs: tick * 1000 / 60, resets });

describe('exposure', () => {
    it('ramps the up term from 0.35 to 1', () => {
        expect(upFacing(0.2)).toBe(0); expect(upFacing(SNOW.upStart)).toBe(0); expect(upFacing(1)).toBe(1);
        expect(upFacing(0.7)).toBeGreaterThan(upFacing(0.5));
    });
    it('is 1 at the sky surface and 0 at 2 cm below it', () => {
        expect(skyExposure(1, 1)).toBe(1); expect(skyExposure(1.5, 1)).toBe(1);
        expect(skyExposure(0.98, 1)).toBe(0); expect(skyExposure(0.99, 1)).toBeCloseTo(0.5, 6);
    });
});
describe('build-up step', () => {
    it('grows by rate / buildUpSeconds under open sky and is full after buildUpSeconds', () => {
        expect(buildUpStep(base)).toBeCloseTo(1 / 2700, 9);
        let amount = 0;
        for (let i = 0; i < 2700; i++) amount = buildUpStep({ ...base, amount });
        expect(amount).toBeGreaterThan(0.999);
    });
    it('stays 0 under shelter and on a surface that does not face up', () => {
        expect(buildUpStep({ ...base, sky: 0 })).toBe(0);
        expect(buildUpStep({ ...base, up: 0 })).toBe(0);
    });
    it('slides off a surface that does not face up, with a time constant of 0.5 s', () => {
        expect(buildUpStep({ ...base, amount: 1, up: 0 })).toBeCloseTo(1 - 1 / 30, 6);
        expect(buildUpStep({ ...base, amount: 1, up: 0, seconds: 0.5 })).toBe(0);
    });
    it('keeps snow at the shed start speed and sheds it at the full speed with a time constant of 0.25 s', () => {
        expect(buildUpStep({ ...base, amount: 1, speed: SNOW.shedStart })).toBe(1);
        expect(buildUpStep({ ...base, amount: 1, speed: SNOW.shedFull })).toBeCloseTo(1 + 1 / 2700 - 4 / 60, 6);
        expect(buildUpStep({ ...base, amount: 1, speed: 9 })).toBeCloseTo(1 + 1 / 2700 - 4 / 60, 6);
    });
    it('melts by 1 / meltSeconds while the rate is 0', () => {
        expect(buildUpStep({ ...base, amount: 1, rate: 0, seconds: 1 })).toBeCloseTo(0.95, 6);
        expect(buildUpStep({ ...base, amount: 0.01, rate: 0, seconds: 1 })).toBe(0);
    });
});
describe('mask', () => {
    it('is 0 at amount 0 and 1 at amount 1 for each noise value', () => {
        for (const noise of [0, 0.5, 1]) { expect(snowMask(0, noise)).toBe(0); expect(snowMask(1, noise)).toBe(1); }
        expect(snowMask(0.5, 0.5)).toBeCloseTo(0.5, 6);
    });
});
describe('flakes', () => {
    const size = [6, 4, 6] as const, seed = [0.5, 0.5, 0.5] as const;
    it('gives the same position for the same seed and time, in the box, also after 4 hours', () => {
        for (const t of [0, 1, 1000, 14_400]) {
            const p = flakePosition([...seed], t, [...size], { ...still, flutter: 2, windSpeed: 5, windDirection: 30 });
            expect(p).toEqual(flakePosition([...seed], t, [...size], { ...still, flutter: 2, windSpeed: 5, windDirection: 30 }));
            p.forEach((value, axis) => { expect(Number.isFinite(value)).toBe(true); expect(Math.abs(value)).toBeLessThanOrEqual(size[axis]! / 2); });
        }
    });
    it('falls by fallSpeed × (0.75 + 0.5 × seed z) and drifts with the wind', () => {
        const a = flakePosition([...seed], 0, [...size], still), b = flakePosition([...seed], 0.1, [...size], still);
        expect(a[1] - b[1]).toBeCloseTo(0.1, 6); expect(b[0]).toBeCloseTo(a[0], 6);
        const c = flakePosition([...seed], 0.1, [...size], { ...still, windDirection: 90, windSpeed: 1 });
        expect(c[0] - a[0]).toBeCloseTo(0.1, 6); expect(c[2]).toBeCloseTo(a[2], 6);
    });
});
describe('sky matrix', () => {
    const map = (m: number[], x: number, y: number, z: number) => new Vector4(x, y, z, 1).applyMatrix4(new Matrix4().fromArray(m)).toArray().slice(0, 3);
    it('maps the box to u, v in 0 to 1 and the height above the box bottom', () => {
        const m = skyMatrix([0, 2, 0], 0, [6, 4, 6]);
        expect(map(m, 0, 4, 0)).toEqual([0.5, 0.5, 4]);
        expect(map(m, -3, 0, -3).map(v => +v.toFixed(6))).toEqual([0, 0, 0]);
        expect(map(m, 3, 4, 3).map(v => +v.toFixed(6))).toEqual([1, 1, 4]);
    });
    it('turns with the yaw of the box', () => {
        const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
        expect(boxYaw([...q])).toBeCloseTo(Math.PI / 2, 6);
        // With a yaw of 90°, the box +X axis points to world −Z.
        expect(map(skyMatrix([0, 2, 0], Math.PI / 2, [6, 4, 6]), 0, 0, -3).map(v => +v.toFixed(6))).toEqual([1, 0.5, 0]);
    });
});
describe('steps', () => {
    it('counts ticks as seconds and resets as the spring grid does', () => {
        expect(snowSteps(null, clock(5))).toEqual({ reset: true, seconds: 0 });
        expect(snowSteps(clock(5), clock(6))).toEqual({ reset: false, seconds: 1 / 60 });
        expect(snowSteps(clock(5), clock(8))).toEqual({ reset: false, seconds: 3 / 60 });
        expect(snowSteps(clock(5), clock(21))).toEqual({ reset: true, seconds: 0 });
        expect(snowSteps(clock(5), clock(6, 1))).toEqual({ reset: true, seconds: 1 / 60 });
        expect(snowSteps(clock(5), clock(5))).toEqual({ reset: false, seconds: 0 });
    });
});
