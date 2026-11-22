import type { Id, LightSettings, SceneEntity, Transform, Vec3 } from "@opensekai/contracts";
import { DIRECTIONAL_DISTANCE, SHADOW_BOX, SPOT_SHADOW_FAR, isLight, lightDirection, spotAngle } from "./scene-lights";

/** The near and far planes of the directional shadow camera in `scene-lights.ts`; a scene-lights test pins both. */
export const DIRECTIONAL_NEAR = 0.5, DIRECTIONAL_FAR = 100;
/** The margin around the rest-pose box of a character for tracking and spring motion (light scale R25, TB6 (a)). */
export const CHARACTER_MARGIN = 1;

export interface Sphere { center: Vec3; radius: number }
/** The space that a shadow map holds. Only a caster inside it draws into the map (light scale R24). */
export type ShadowVolume =
    | { type: "point"; position: Vec3; range: number }
    | { type: "spot"; position: Vec3; direction: Vec3; angle: number; range: number }
    | { type: "directional"; focus: Vec3; direction: Vec3 };
/** A light with a shadow. `key` changes when its type, place, direction, range, cone, or shadow settings change. */
export interface ShadowLight { key: string; volume: ShadowVolume }
/** An object that casts a shadow. `key` changes when its transform, model, or visibility changes; a moving caster changes in each frame. `sphere` is null while it is hidden. */
export interface Caster { key: string; sphere: Sphere | null; moving: boolean }
export interface ShadowFrame { lights: ReadonlyMap<Id, ShadowLight>; casters: ReadonlyMap<Id, Caster>; renderEnvironment: boolean; force: boolean }
/** The last frame, and for each light the casters that were in its volume when its map was last marked. */
export interface ShadowState { frame: ShadowFrame; drawn: ReadonlyMap<Id, ReadonlySet<Id>> }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function shadowVolume(light: LightSettings, transform: Transform): ShadowVolume | null {
    const position = [...transform.position] as Vec3, direction = lightDirection(transform.rotation);
    if (light.type === "point") return { type: "point", position, range: light.range };
    if (light.type === "spot") return { type: "spot", position, direction, angle: spotAngle(light.cone?.angleDegrees ?? 40), range: light.range };
    if (light.type === "directional") return { type: "directional", focus: position, direction };
    return null;
}

// The x and y axes of the directional shadow camera, as `Matrix4.lookAt` builds them with the default up axis.
const boxAxes = (direction: Vec3): [Vec3, Vec3] => {
    const up: Vec3 = [0, 1, 0];
    let z = normalize([-direction[0], -direction[1], -direction[2]]);
    if (length(cross(up, z)) === 0) z = normalize([z[0], z[1], z[2] + 0.0001]);
    const x = normalize(cross(up, z));
    return [x, cross(z, x)];
};

export function shadowVolumeHits(volume: ShadowVolume, sphere: Sphere): boolean {
    const { center, radius } = sphere;
    if (volume.type === "point") return volume.range === 0 || length(sub(center, volume.position)) <= volume.range + radius;
    if (volume.type === "spot") {
        const offset = sub(center, volume.position), distance = length(offset);
        if (distance > (volume.range || SPOT_SHADOW_FAR) + radius) return false;
        if (distance <= radius) return true;
        const angle = Math.acos(clamp(dot(offset, volume.direction) / (distance * length(volume.direction)), -1, 1));
        return angle <= volume.angle + Math.asin(radius / distance);
    }
    const direction = normalize(volume.direction);
    const eye = sub(volume.focus, [direction[0] * DIRECTIONAL_DISTANCE, direction[1] * DIRECTIONAL_DISTANCE, direction[2] * DIRECTIONAL_DISTANCE]);
    const local = sub(center, eye), [x, y] = boxAxes(direction);
    const gaps = [[dot(local, x), -SHADOW_BOX, SHADOW_BOX], [dot(local, y), -SHADOW_BOX, SHADOW_BOX], [dot(local, direction), DIRECTIONAL_NEAR, DIRECTIONAL_FAR]]
        .map(([value, min, max]) => value! - clamp(value!, min!, max!));
    return Math.hypot(...gaps) <= radius;
}

/** The sphere radius of a character around its root: the farthest corner of its rest-pose box from the root, plus the margin. */
export const characterRadius = (min: Vec3, max: Vec3): number =>
    Math.hypot(...[0, 1, 2].map(i => Math.max(Math.abs(min[i]!), Math.abs(max[i]!)))) + CHARACTER_MARGIN;

/** Each light entity with a shadow, with its volume and key. */
export function shadowLights(entities: readonly SceneEntity[]): Map<Id, ShadowLight> {
    const out = new Map<Id, ShadowLight>();
    for (const entity of entities) {
        if (!isLight(entity) || !entity.light.shadow.enabled) continue;
        const volume = shadowVolume(entity.light, entity.transform);
        if (!volume) continue;
        const { type, range, cone, shadow } = entity.light;
        out.set(entity.id, { key: JSON.stringify([type, entity.transform.position, entity.transform.rotation, range, cone ?? null, shadow]), volume });
    }
    return out;
}

/**
 * The lights whose shadow map must be drawn in this frame (light scale R23). A light is dirty when the frame is forced, when it
 * is new or its key changed, when `renderEnvironment` changed, or when a caster changed that is in its volume now or was at
 * its last mark. A moving caster (a character) changes in each frame.
 */
export function shadowDirty(previous: ShadowState | null, next: ShadowFrame): { dirty: ReadonlySet<Id>; state: ShadowState } {
    const before = previous?.frame;
    const changed = new Set<Id>();
    for (const [id, caster] of next.casters) if (caster.moving || before?.casters.get(id)?.key !== caster.key) changed.add(id);
    for (const id of before?.casters.keys() ?? []) if (!next.casters.has(id)) changed.add(id);
    const all = next.force || !before || before.renderEnvironment !== next.renderEnvironment;
    const dirty = new Set<Id>(), drawn = new Map<Id, ReadonlySet<Id>>();
    for (const [id, light] of next.lights) {
        const hits = new Set([...next.casters].flatMap(([caster, { sphere }]) => sphere && shadowVolumeHits(light.volume, sphere) ? [caster] : []));
        const last = previous?.drawn.get(id);
        const marked = all || !last || before?.lights.get(id)?.key !== light.key || [...changed].some(caster => hits.has(caster) || last.has(caster));
        if (marked) dirty.add(id);
        drawn.set(id, marked ? hits : last!);
    }
    return { dirty, state: { frame: next, drawn } };
}
