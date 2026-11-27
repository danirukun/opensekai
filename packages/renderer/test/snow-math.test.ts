import { expect, it, describe } from 'vitest';
import { Matrix4, Vector4 } from 'three/webgpu';
import { SNOW, SNOW_FLAKE_LEVELS, boxYaw, buildUpStep, flakeClock, flakePosition, skyExposure, skyMatrix, snowMask, snowSteps, upFacing, warmAmount, type FlakeClock } from '../src/snow-math';

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
    const size = [6, 4, 6] as const, seed = [0.5, 0.5, 0.5, 0.5] as const;
    type Motion = typeof still;
    const at = (flake: readonly [number, number, number, number], t: number, motion: Motion = still) => flakePosition(flake, flakeClock(t, size, motion), size, motion.flutter);
    it('gives the same position for the same seed and time, in the box, also after 4 hours', () => {
        const motion = { ...still, flutter: 2, windSpeed: 5, windDirection: 30 };
        for (const t of [0, 1, 1000, 14_400]) {
            const p = at(seed, t, motion);
            expect(p).toEqual(at(seed, t, motion));
            p.forEach((value, axis) => { expect(Number.isFinite(value)).toBe(true); expect(Math.abs(value)).toBeLessThanOrEqual(size[axis]! / 2); });
        }
    });
    it('falls by fallSpeed × (0.75 + 0.5 × the speed level) and drifts with the wind', () => {
        const a = at(seed, 0), b = at(seed, 0.1);
        expect(a[1] - b[1]).toBeCloseTo(0.1, 6); expect(b[0]).toBeCloseTo(a[0], 6);
        const c = at(seed, 0.1, { ...still, windDirection: 90, windSpeed: 1 });
        expect(c[0] - a[0]).toBeCloseTo(0.1, 6); expect(c[2]).toBeCloseTo(a[2], 6);
    });
    it('takes the fall speed from the speed seed, not from the place in the box', () => {
        const fall = (flake: readonly [number, number, number, number]) => at(flake, 0)[1] - at(flake, 0.1)[1];
        expect(fall([0.5, 0.5, 0.1, 0.5])).toBeCloseTo(0.1, 6);
        expect(fall([0.5, 0.5, 0.9, 0.5])).toBeCloseTo(0.1, 6);
        expect(fall([0.5, 0.5, 0.5, 0])).toBeCloseTo(0.075, 6);
        expect(fall([0.5, 0.5, 0.5, 0.999])).toBeCloseTo(0.1 * (0.75 + 0.5 * (SNOW_FLAKE_LEVELS - 1) / SNOW_FLAKE_LEVELS), 6);
    });
    it('keeps each time term below its period, so a float32 holds a session of 3 days', () => {
        const motion = { fallSpeed: 3, flutter: 2, windDirection: 30, windSpeed: 5 }, t = 3 * 86_400 + 0.25;
        const single = (clock: FlakeClock) => Object.fromEntries(Object.entries(clock).map(([key, value]) => [key, Math.fround(value)])) as unknown as FlakeClock;
        const clock = flakeClock(t, size, motion), turn = 2 * Math.PI;
        expect(clock.driftX).toBeLessThan(size[0]); expect(clock.driftZ).toBeLessThan(size[2]);
        expect(clock.fall).toBeLessThan(size[1]); expect(clock.fallStep).toBeLessThan(size[1]);
        expect(clock.swayX).toBeLessThan(turn); expect(clock.swayZ).toBeLessThan(turn); expect(clock.swayStep).toBeLessThan(turn);
        // The distance between the double and the float32 result, along the wrap of the box.
        const apart = (a: number, b: number, span: number) => Math.min(Math.abs(a - b), span - Math.abs(a - b));
        for (const flake of [[0.1, 0.2, 0.3, 0.999], [0.9, 0.999, 0.5, 0], [0.5, 0.5, 0.5, 0.5]] as const) {
            const exact = flakePosition(flake, clock, size, motion.flutter), rounded = flakePosition(flake, single(clock), size, motion.flutter);
            exact.forEach((value, axis) => expect(apart(value, rounded[axis]!, size[axis]!)).toBeLessThan(1e-4));
            // One frame later the float32 result moved by the fall of one frame.
            const next = flakePosition(flake, single(flakeClock(t + 1 / 60, size, motion)), size, motion.flutter);
            const speed = motion.fallSpeed * (0.75 + 0.5 * Math.floor(flake[3] * SNOW_FLAKE_LEVELS) / SNOW_FLAKE_LEVELS);
            expect(apart(apart(rounded[1], next[1], size[1]), speed / 60, size[1])).toBeLessThan(2e-4);
        }
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

// Snow cover R7.
it('warm starts at cover × up × sky, which a build-up from 0 reaches while the cover grows and nothing sheds', () => {
    expect(warmAmount(0, 1, 1)).toBe(0);
    expect(warmAmount(0.6, 0.5, 1)).toBeCloseTo(0.3);
    expect(warmAmount(0.6, 1, 0)).toBe(0);
    const settings = { rate: 0.5, buildUpSeconds: 45, meltSeconds: 20 }, up = 0.7, sky = 1;
    let amount = 0;
    for (let tick = 0; tick < 30 * 60; tick++) amount = buildUpStep({ amount, up, sky, speed: 0, ...settings, seconds: 1 / 60 });
    expect(warmAmount(30 * settings.rate / settings.buildUpSeconds, up, sky)).toBeCloseTo(amount, 6);
});
