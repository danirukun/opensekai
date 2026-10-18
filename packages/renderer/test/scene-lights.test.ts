import { describe, expect, it } from 'vitest';
import { AmbientLight, BackSide, DirectionalLight, DoubleSide, FrontSide, Group, Mesh, BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, PointLight, Scene, SpotLight, type PerspectiveCamera, type WebGPURenderer } from 'three/webgpu';
import type { LightSettings, SceneEntity } from '@opensekai/contracts';
import { createSceneLights, lightDirection, lightGroups, lightSignature, scattersInHaze, shadowsOn, spotAngle, usesFixedAmbient, withDrafts, DIRECTIONAL_DISTANCE, SPOT_SHADOW_FAR } from '../src/scene-lights';

const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'directional', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}, visible = true, rotation: [number, number, number, number] = [0, 0, 0, 1]): SceneEntity => ({ id, name: id, visible, transform: { position: [0, 2, 1], rotation, scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const box: SceneEntity = { id: 'box', name: 'box', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'mesh', source: { kind: 'box' } };
const fake = () => ({ shadowMap: { enabled: false, type: 0 } }) as unknown as WebGPURenderer;
const threeLights = (scene: Scene) => scene.children.filter(c => (c as DirectionalLight).isDirectionalLight || (c as PointLight).isPointLight) as (DirectionalLight | PointLight)[];

describe('pure light functions', () => {
    it('groups lights by their affect flags in scene order (R6)', () => {
        const entities = [box, light('a'), light('b', { affectCharacters: false }), light('c', { affectProps: false, affectEnvironment: false })];
        expect(lightGroups(entities)).toEqual({ characters: ['a', 'c'], props: ['a', 'b'], environment: ['a', 'b'], haze: [] });
    });
    it('keeps the signature for visibility, color, intensity, range, and transform changes (R7)', () => {
        const base = lightSignature([light('a')]);
        expect(lightSignature([light('a', {}, false)])).toBe(base);
        expect(lightSignature([light('a', { color: '#ff0000', intensity: 9, range: 4 })])).toBe(base);
        expect(lightSignature([light('a', {}, true, [0, 1, 0, 0])])).toBe(base);
        expect(lightSignature([light('a', { shadow: { ...settings().shadow, bias: 0.001, soft: false } })])).toBe(base);
    });
    it('changes the signature for type, affect flags, shadow switch, and light count (R7)', () => {
        const base = lightSignature([light('a')]);
        for (const changed of [[light('a', { type: 'point' })], [light('a', { affectProps: false })], [light('a', { shadow: { ...settings().shadow, enabled: true } })], [light('a'), light('b')], []])
            expect(lightSignature(changed)).not.toBe(base);
        expect(lightSignature([box])).toBe('builtin');
    });
    it('reports shadows when one light has a shadow', () => {
        expect(shadowsOn([light('a')])).toBe(false);
        expect(shadowsOn([light('a'), light('b', { shadow: { ...settings().shadow, enabled: true } })])).toBe(true);
    });
    it('shines along local −Z (R4)', () => {
        expect(lightDirection([0, 0, 0, 1])).toEqual([0, 0, -1]);
        const [x, y, z] = lightDirection([-0.3890, 0.2648, 0.1178, 0.8745]);
        const n = Math.hypot(2, 4, 3);
        expect(x).toBeCloseTo(-2 / n, 3); expect(y).toBeCloseTo(-4 / n, 3); expect(z).toBeCloseTo(-3 / n, 3);
    });
});

describe('scene light reconcile', () => {
    it('uses the built-in light only when the scene has no light entity (R5)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        expect(lights.apply([box])).toBe(true);
        expect(threeLights(scene).map(l => l.intensity)).toEqual([3]);
        lights.apply([box, light('a', { intensity: 5 })]);
        const [builtin, own] = threeLights(scene);
        expect(builtin!.intensity).toBe(0);
        expect(own!.intensity).toBe(5);
        lights.apply([box]);
        expect(threeLights(scene).map(l => l.intensity)).toEqual([3]);
    });
    it('places a directional light 50 m against its direction with its target at the entity position (R4, B12 R9)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a', {}, true, [-0.3890, 0.2648, 0.1178, 0.8745])]);
        const own = threeLights(scene)[1] as DirectionalLight;
        const n = Math.hypot(2, 4, 3);
        expect(own.position.toArray().map((v, i) => (v - [0, 2, 1][i]!) / DIRECTIONAL_DISTANCE)).toEqual([2 / n, 4 / n, 3 / n].map(v => expect.closeTo(v, 3)));
        expect(own.target.position.toArray()).toEqual([0, 2, 1]);
        expect(own.target.parent).toBe(scene);
    });
    it('moves the light and the directional shadow focus on the next apply (B12 R7, R9)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        const moved = (entity: SceneEntity, position: [number, number, number]): SceneEntity => ({ ...entity, transform: { ...entity.transform, position } });
        const sun = light('sun'), lamp = light('lamp', { type: 'point' });
        lights.apply([sun, lamp]);
        expect(lights.apply([moved(sun, [5, 1, -3]), moved(lamp, [4, 3, 2])])).toBe(false);
        const [, directional, point] = threeLights(scene) as [DirectionalLight, DirectionalLight, PointLight];
        expect(point.position.toArray()).toEqual([4, 3, 2]);
        expect(directional.target.position.toArray()).toEqual([5, 1, -3]);
        expect(directional.position.toArray()).toEqual([5, 1, -3 + DIRECTIONAL_DISTANCE]);
        expect(directional.target.matrixWorld.elements.slice(12, 15)).toEqual([5, 1, -3]);
    });
    it('draws an entity with a draft at its draft transform (B12 R7)', () => {
        const draft = { position: [9, 9, 9] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
        const entities = [box, light('a')];
        const drawn = withDrafts(entities, id => id === 'a' ? draft : null);
        expect(drawn[0]).toBe(box);
        expect(drawn[1]!.transform).toEqual(draft);
        expect(entities[1]!.transform.position).toEqual([0, 2, 1]);
    });
    it('maps point light, color, and shadow values (R4, R8)', () => {
        const scene = new Scene(), renderer = fake(), lights = createSceneLights(scene, renderer);
        lights.apply([light('p', { type: 'point', color: '#ff0000', intensity: 20, range: 10, shadow: { enabled: true, intensity: 0.5, soft: false, bias: 0.001, normalBias: 0.1 } })]);
        const point = threeLights(scene)[1] as PointLight;
        expect(point.isPointLight).toBe(true);
        expect([point.distance, point.decay, point.castShadow, point.shadow.intensity, point.shadow.bias, point.shadow.normalBias, point.shadow.radius]).toEqual([10, 2, true, 0.5, 0.001, 0.1, 1]);
        expect(point.position.toArray()).toEqual([0, 2, 1]);
        expect(point.color.getHexString()).toBe('ff0000');
        expect(point.shadow.mapSize.toArray()).toEqual([1024, 1024]);
        expect(renderer.shadowMap.enabled).toBe(true);
    });
    it('keeps a hidden light in its node sets with intensity 0 and its shadow (R7)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a', { shadow: { ...settings().shadow, enabled: true } })]);
        const signature = lights.signature();
        expect(lights.apply([light('a', { shadow: { ...settings().shadow, enabled: true } }, false)])).toBe(false);
        expect(lights.signature()).toBe(signature);
        const own = threeLights(scene)[1]!;
        expect(own.intensity).toBe(0);
        expect(own.castShadow).toBe(true);
    });
    it('replaces the three.js light when the type changes and removes it with the entity', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a')]);
        lights.apply([light('a', { type: 'point' })]);
        expect(threeLights(scene).filter(l => (l as PointLight).isPointLight)).toHaveLength(1);
        expect(threeLights(scene)).toHaveLength(2);
        lights.apply([]);
        expect(threeLights(scene)).toHaveLength(1);
        lights.dispose();
        expect(scene.children).toHaveLength(0);
    });
    it('assigns the group node set to lit materials only and the shadow flags to meshes (R6, R8)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        const lit = new MeshStandardMaterial(), unlit = new MeshBasicMaterial();
        const root = new Group(); root.add(new Mesh(new BoxGeometry(), lit), new Mesh(new BoxGeometry(), unlit));
        lights.apply([light('a', { affectProps: false, shadow: { ...settings().shadow, enabled: true } })]);
        const version = lit.version;
        lights.assign(root, 'props');
        const props = (lit as unknown as { lightsNode: unknown }).lightsNode;
        expect(props).toBeTruthy();
        expect(lit.version).toBeGreaterThan(version);
        expect((unlit as unknown as { lightsNode?: unknown }).lightsNode).toBeUndefined();
        expect(root.children.every(c => c.castShadow && c.receiveShadow)).toBe(true);
        const other = new Group(); const second = new MeshStandardMaterial(); other.add(new Mesh(new BoxGeometry(), second));
        lights.assign(other, 'characters');
        expect((second as unknown as { lightsNode: unknown }).lightsNode).not.toBe(props);
        const again = lit.version;
        lights.assign(root, 'props');
        expect(lit.version).toBe(again);
    });
});
describe('node-set generation', () => {
    it('increases on each rebuild, also when the signature comes back (A → B → A)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a')]);
        const first = lights.generation(), signature = lights.signature();
        lights.apply([light('a', { type: 'point' })]);
        lights.apply([light('a')]);
        expect(lights.signature()).toBe(signature);
        expect(lights.generation()).toBe(first + 2);
        lights.apply([light('a', {}, false)]);
        expect(lights.generation()).toBe(first + 2);
    });
});
describe('material refresh', () => {
    it('disposes a lit material when its node set changes after first use, so a plain material rebuilds (owner QA finding 1)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        const lit = new MeshStandardMaterial();
        const root = new Group(); root.add(new Mesh(new BoxGeometry(), lit));
        let disposed = 0; lit.addEventListener('dispose', () => { disposed++; });
        lights.apply([light('a')]);
        lights.assign(root, 'environment');
        expect(disposed).toBe(0);
        lights.apply([light('a', { affectEnvironment: false })]);
        lights.assign(root, 'environment');
        expect(disposed).toBe(1);
        lights.assign(root, 'environment');
        expect(disposed).toBe(1);
    });
});
describe('shadow side of a multi-material mesh', () => {
    it('casts every group with the shadow side of the first material, so the shared shadow material does not flip (R8a)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        const base = new MeshStandardMaterial({ side: DoubleSide }), outline = new MeshStandardMaterial({ side: BackSide });
        const single = new MeshStandardMaterial({ side: FrontSide });
        const root = new Group(); root.add(new Mesh(new BoxGeometry(), [base, outline]), new Mesh(new BoxGeometry(), single));
        lights.apply([light('a', { shadow: { ...settings().shadow, enabled: true } })]);
        lights.assign(root, 'characters');
        const side = (m: MeshStandardMaterial) => m.shadowSide ?? m.side;
        expect(side(outline)).toBe(DoubleSide);
        expect(side(base)).toBe(DoubleSide);
        expect(outline.side).toBe(BackSide);
        expect(single.shadowSide).toBeNull();
    });
});
describe('soft shadow radius', () => {
    it('uses PCF radius 2 for soft shadows and 1 for hard shadows (owner decision on #202)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a', { shadow: { ...settings().shadow, enabled: true, soft: true } })]);
        expect(threeLights(scene)[1]!.shadow.radius).toBe(2);
        lights.apply([light('a', { shadow: { ...settings().shadow, enabled: true, soft: false } })]);
        expect(threeLights(scene)[1]!.shadow.radius).toBe(1);
    });
});

describe('stage lights (B13)', () => {
    const cone = { angleDegrees: 40, penumbra: 0.3 };
    const spot = (id: string, patch: Partial<LightSettings> = {}) => light(id, { type: 'spot', intensity: 60, range: 15, cone, ...patch });
    const lightsOf = (node: unknown) => (node as { getLights(): unknown[] }).getLights();
    it('maps the full cone angle to the three.js half angle', () => {
        expect(spotAngle(40)).toBeCloseTo(Math.PI / 9, 9);
        expect(spotAngle(170)).toBeLessThan(Math.PI / 2);
    });
    it('lets only point and spot lights with volumetric on scatter in haze (R1, R7)', () => {
        expect(scattersInHaze(settings({ type: 'spot', cone, volumetric: true }))).toBe(true);
        expect(scattersInHaze(settings({ type: 'point', volumetric: true }))).toBe(true);
        expect(scattersInHaze(settings({ type: 'point' }))).toBe(false);
        expect(scattersInHaze(settings({ type: 'directional', volumetric: true }))).toBe(false);
        expect(lightGroups([spot('s', { volumetric: true }), light('p', { type: 'point' }), light('d')]).haze).toEqual(['s']);
    });
    it('rebuilds the node sets when volumetric changes, not when the cone changes (R5)', () => {
        const base = lightSignature([spot('s')]);
        expect(lightSignature([spot('s', { volumetric: true })])).not.toBe(base);
        expect(lightSignature([spot('s', { cone: { angleDegrees: 90, penumbra: 1 } })])).toBe(base);
    });
    it('places a spot light at its position, aimed along −Z, with its cone, range, and shadow camera (R3)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([spot('s', { shadow: { ...settings().shadow, enabled: true } })]);
        const own = scene.children.find(c => (c as SpotLight).isSpotLight) as SpotLight;
        expect(own.position.toArray()).toEqual([0, 2, 1]);
        expect(own.target.position.toArray()).toEqual([0, 2, 0]);
        expect(own.target.parent).toBe(scene);
        expect([own.distance, own.decay, own.penumbra, own.castShadow]).toEqual([15, 2, 0.3, true]);
        expect(own.angle).toBeCloseTo(spotAngle(40), 9);
        expect(own.shadow.mapSize.toArray()).toEqual([1024, 1024]);
        expect([(own.shadow.camera as PerspectiveCamera).near, (own.shadow.camera as PerspectiveCamera).far, own.shadow.focus]).toEqual([0.1, SPOT_SHADOW_FAR, 1]);
    });
    it('replaces the fixed ambient light with ambient entities by their affect flags (R4)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        const ambient = light('amb', { type: 'ambient', color: '#203040', intensity: 0.3, affectProps: false });
        expect(usesFixedAmbient([light('d')])).toBe(true);
        expect(usesFixedAmbient([light('d'), ambient])).toBe(false);
        lights.apply([light('d'), ambient]);
        const own = scene.children.filter(c => (c as AmbientLight).isAmbientLight) as AmbientLight[];
        const entityAmbient = own.find(a => a.color.getHexString() === '203040')!;
        expect(entityAmbient.intensity).toBe(0.3);
        const fixed = own.find(a => a !== entityAmbient)!;
        expect(lightsOf(lights.node('characters'))).toContain(entityAmbient);
        expect(lightsOf(lights.node('characters'))).not.toContain(fixed);
        expect(lightsOf(lights.node('props'))).not.toContain(entityAmbient);
        expect(lightsOf(lights.node('props'))).not.toContain(fixed);
        lights.apply([light('d')]);
        expect(lightsOf(lights.node('characters'))).toContain(fixed);
    });
    it('gives the haze set only the volumetric lights, with no ambient light (R7)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('d'), spot('s', { volumetric: true }), light('p', { type: 'point' })]);
        const set = lightsOf(lights.node('haze'));
        expect(set).toHaveLength(1);
        expect((set[0] as SpotLight).isSpotLight).toBe(true);
    });
});
