import { describe, expect, it } from 'vitest';
import type { Id, LightSettings, SceneEntity, Vec3 } from '@opensekai/contracts';
import { characterRadius, shadowDirty, shadowLights, shadowVolume, shadowVolumeHits, type Caster, type ShadowFrame, type ShadowState, type ShadowVolume } from '../src/shadow-cache';

type Quat = [number, number, number, number];
const IDENTITY: Quat = [0, 0, 0, 1];
// −90° about X: the light shines straight down (−Y).
const DOWN: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
const shadow = { enabled: true, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 40, penumbra: 0 }, ...patch });
const transform = (position: Vec3, rotation: Quat = IDENTITY) => ({ position, rotation, scale: [1, 1, 1] as Vec3 });
const volume = (patch: Partial<LightSettings>, position: Vec3 = [0, 0, 0], rotation: Quat = IDENTITY): ShadowVolume => shadowVolume(settings(patch), transform(position, rotation))!;
const sphere = (center: Vec3, radius: number) => ({ center, radius });
const light = (id: string, position: Vec3, patch: Partial<LightSettings> = {}, rotation: Quat = DOWN): SceneEntity => ({ id, name: id, visible: true, kind: 'light', transform: transform(position, rotation), light: settings(patch) });
// A spot light 3 m above the origin that shines down: its cone covers a disc of about 1.1 m radius on the floor.
const spot = light('spot', [0, 3, 0]);
const prop = (center: Vec3 | null, key = JSON.stringify(center)): Caster => ({ key, sphere: center ? sphere(center, 0.5) : null, moving: false });
const character = (center: Vec3): Caster => ({ key: '', sphere: sphere(center, 2), moving: true });
const frame = (lights: readonly SceneEntity[], casters: Record<Id, Caster>, patch: Partial<ShadowFrame> = {}): ShadowFrame =>
    ({ lights: shadowLights(lights), casters: new Map(Object.entries(casters)), renderEnvironment: true, force: false, ...patch });
// Runs frames in order and gives the dirty light IDs of each frame.
const run = (...frames: ShadowFrame[]): Id[][] => {
    let state: ShadowState | null = null;
    return frames.map(next => { const result = shadowDirty(state, next); state = result.state; return [...result.dirty].sort(); });
};

describe('shadowVolumeHits (R24)', () => {
    it('hits a point light volume within range plus radius, and always when range is 0', () => {
        const point = volume({ type: 'point', range: 5 });
        expect(shadowVolumeHits(point, sphere([0, 0, 5.4], 0.5))).toBe(true);
        expect(shadowVolumeHits(point, sphere([3, 4, 0.1], 0.5))).toBe(true);
        expect(shadowVolumeHits(point, sphere([0, 0, 5.6], 0.5))).toBe(false);
        expect(shadowVolumeHits(volume({ type: 'point', range: 0 }), sphere([0, 0, 900], 0.5))).toBe(true);
    });
    it('hits a spot light volume inside the cone, at the cone edge with the radius, and not behind or beyond range', () => {
        // Shines along −Z, half angle 20°. At 5 m a 0.5 m sphere adds asin(0.1) = 5.74°.
        const cone = volume({});
        const at = (degrees: number, distance: number): Vec3 => [Math.sin(degrees * Math.PI / 180) * distance, 0, -Math.cos(degrees * Math.PI / 180) * distance];
        expect(shadowVolumeHits(cone, sphere([0, 0, -5], 0.1))).toBe(true);
        expect(shadowVolumeHits(cone, sphere(at(25, 5), 0.5))).toBe(true);
        expect(shadowVolumeHits(cone, sphere(at(27, 5), 0.5))).toBe(false);
        expect(shadowVolumeHits(cone, sphere([0, 0, 5], 0.5))).toBe(false);
        expect(shadowVolumeHits(cone, sphere([0, 0, 0.2], 0.5))).toBe(true);
        expect(shadowVolumeHits(cone, sphere([0, 0, -50.4], 0.5))).toBe(true);
        expect(shadowVolumeHits(cone, sphere([0, 0, -50.6], 0.5))).toBe(false);
        const ranged = volume({ range: 3 });
        expect(shadowVolumeHits(ranged, sphere([0, 0, -4], 0.5))).toBe(false);
        expect(shadowVolumeHits(ranged, sphere([0, 0, -4], 1.5))).toBe(true);
    });
    it('hits a directional shadow box within its half side and from near to far along the light', () => {
        // Shines along −Z with the focus at the origin: x and y in ±10 m, z from 49.5 m to −50 m.
        const sun = volume({ type: 'directional' });
        expect(shadowVolumeHits(sun, sphere([9, 0, 0], 0.5))).toBe(true);
        expect(shadowVolumeHits(sun, sphere([10.5, 0, 0], 1))).toBe(true);
        expect(shadowVolumeHits(sun, sphere([12, 0, 0], 1))).toBe(false);
        expect(shadowVolumeHits(sun, sphere([0, -11.2, 0], 1))).toBe(false);
        expect(shadowVolumeHits(sun, sphere([10.5, 10.5, 0], 0.6))).toBe(false);
        expect(shadowVolumeHits(sun, sphere([0, 0, -50.3], 0.4))).toBe(true);
        expect(shadowVolumeHits(sun, sphere([0, 0, -50.5], 0.4))).toBe(false);
        expect(shadowVolumeHits(sun, sphere([0, 0, 49.8], 0.2))).toBe(false);
        // Straight down (the light direction is the camera up axis) with the focus on the floor at x 20.
        const noon = volume({ type: 'directional' }, [20, 0, 0], DOWN);
        expect(shadowVolumeHits(noon, sphere([29, 1, -9], 0.5))).toBe(true);
        expect(shadowVolumeHits(noon, sphere([20, 1, 12], 1))).toBe(false);
        expect(shadowVolumeHits(noon, sphere([8, 1, 0], 1))).toBe(false);
        expect(shadowVolumeHits(noon, sphere([20, -50.5, 0], 0.4))).toBe(false);
    });
});

describe('characterRadius (R25)', () => {
    it('is the distance from the root to the farthest corner of the rest-pose box plus 1 m', () => {
        expect(characterRadius([-0.3, 0, -0.2], [0.3, 1.6, 0.2])).toBeCloseTo(Math.hypot(0.3, 1.6, 0.2) + 1, 6);
        expect(characterRadius([-2, -1, 0], [0.5, 0.5, 0.5])).toBeCloseTo(Math.hypot(2, 1, 0.5) + 1, 6);
    });
});

describe('shadowDirty (R23, R25, R26)', () => {
    it('marks a new light, a light whose shadow turned on, and a moved or changed light', () => {
        const far = { crate: prop([30, 0, 0]) };
        const lamp = light('lamp', [5, 3, 0], { type: 'point', range: 4 });
        expect(run(frame([spot], far), frame([spot, lamp], far), frame([spot, lamp], far))).toEqual([['spot'], ['lamp'], []]);
        const off = light('lamp', [5, 3, 0], { type: 'point', range: 4, shadow: { ...shadow, enabled: false } });
        expect(run(frame([spot, off], far), frame([spot, lamp], far))).toEqual([['spot'], ['lamp']]);
        const moved = light('spot', [0, 3, 0.1]), turned = light('spot', [0, 3, 0], {}, IDENTITY), wider = light('spot', [0, 3, 0], { cone: { angleDegrees: 60, penumbra: 0 } });
        const softer = light('spot', [0, 3, 0], { shadow: { ...shadow, soft: false } }), ranged = light('spot', [0, 3, 0], { range: 8 });
        for (const changed of [moved, turned, wider, softer, ranged])
            expect(run(frame([spot], far), frame([changed], far), frame([changed], far))).toEqual([['spot'], ['spot'], []]);
    });
    it('marks a light in each frame while a character sphere is in its volume, and one more frame after it leaves', () => {
        const inside = { cat: character([0.5, 0, 0]) }, outside = { cat: character([8, 0, 0]) };
        expect(run(frame([spot], inside), frame([spot], inside), frame([spot], inside))).toEqual([['spot'], ['spot'], ['spot']]);
        expect(run(frame([spot], outside), frame([spot], outside), frame([spot], outside))).toEqual([['spot'], [], []]);
        expect(run(frame([spot], inside), frame([spot], outside), frame([spot], outside))).toEqual([['spot'], ['spot'], []]);
    });
    it('marks a light when a prop that is or was in its volume moves, hides, shows, gets a new model, or goes', () => {
        const at = (center: Vec3 | null, key?: string) => frame([spot], { crate: prop(center, key) });
        // Out (static), into, inside, inside (static), out, further out.
        expect(run(at([5, 0, 0]), at([5, 0, 0]), at([0.5, 0, 0]), at([0, 0, 0]), at([0, 0, 0]), at([5, 0, 0]), at([7, 0, 0])))
            .toEqual([['spot'], [], ['spot'], ['spot'], [], ['spot'], []]);
        // Hidden inside, shown inside, a new model inside; a hidden prop outside changes nothing.
        expect(run(at([0, 0, 0]), at(null, 'hidden'), at([0, 0, 0]), at([0, 0, 0], 'new model'), at([0, 0, 0], 'new model'))).toEqual([['spot'], ['spot'], ['spot'], ['spot'], []]);
        expect(run(at([5, 0, 0]), at(null, 'hidden'), at([5, 0, 0]))).toEqual([['spot'], [], []]);
        expect(run(at([0, 0, 0]), frame([spot], {}), frame([spot], {}))).toEqual([['spot'], ['spot'], []]);
        expect(run(frame([spot], {}), at([5, 0, 0]), at([0, 0, 0]))).toEqual([['spot'], [], ['spot']]);
    });
    it('marks each light when renderEnvironment changes and when the frame is forced (rebuild, screenshot, capture)', () => {
        const lamp = light('lamp', [20, 3, 0], { type: 'point', range: 2 }), far = { crate: prop([-30, 0, 0]) };
        expect(run(frame([spot, lamp], far), frame([spot, lamp], far, { renderEnvironment: false }), frame([spot, lamp], far, { renderEnvironment: false }), frame([spot, lamp], far)))
            .toEqual([['lamp', 'spot'], ['lamp', 'spot'], [], ['lamp', 'spot']]);
        expect(run(frame([spot, lamp], far), frame([spot, lamp], far, { force: true }), frame([spot, lamp], far))).toEqual([['lamp', 'spot'], ['lamp', 'spot'], []]);
    });
    it('builds no volume for an ambient light or a light without a shadow', () => {
        const ambient = light('fill', [0, 0, 0], { type: 'ambient', shadow: { ...shadow, enabled: false } });
        const plain = light('plain', [0, 3, 0], { shadow: { ...shadow, enabled: false } });
        expect([...shadowLights([ambient, plain, spot]).keys()]).toEqual(['spot']);
        expect(shadowVolume(settings({ type: 'ambient' }), transform([0, 0, 0]))).toBeNull();
    });
});
