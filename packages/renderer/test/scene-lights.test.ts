import { describe, expect, it } from 'vitest';
import { DirectionalLight, Group, Mesh, BoxGeometry, MeshBasicMaterial, MeshStandardMaterial, PointLight, Scene, type WebGPURenderer } from 'three/webgpu';
import type { LightSettings, SceneEntity } from '@opensekai/contracts';
import { createSceneLights, lightDirection, lightGroups, lightSignature, shadowsOn, DIRECTIONAL_DISTANCE } from '../src/scene-lights';

const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'directional', color: '#ffffff', intensity: 3, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, ...patch });
const light = (id: string, patch: Partial<LightSettings> = {}, visible = true, rotation: [number, number, number, number] = [0, 0, 0, 1]): SceneEntity => ({ id, name: id, visible, transform: { position: [0, 2, 1], rotation, scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const box: SceneEntity = { id: 'box', name: 'box', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'mesh', source: { kind: 'box' } };
const fake = () => ({ shadowMap: { enabled: false, type: 0 } }) as unknown as WebGPURenderer;
const threeLights = (scene: Scene) => scene.children.filter(c => (c as DirectionalLight).isDirectionalLight || (c as PointLight).isPointLight) as (DirectionalLight | PointLight)[];

describe('pure light functions', () => {
    it('groups lights by their affect flags in scene order (R6)', () => {
        const entities = [box, light('a'), light('b', { affectCharacters: false }), light('c', { affectProps: false, affectEnvironment: false })];
        expect(lightGroups(entities)).toEqual({ characters: ['a', 'c'], props: ['a', 'b'], environment: ['a', 'b'] });
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
    it('places a directional light 50 m against its direction with its target at the origin (R4)', () => {
        const scene = new Scene(), lights = createSceneLights(scene, fake());
        lights.apply([light('a', {}, true, [-0.3890, 0.2648, 0.1178, 0.8745])]);
        const own = threeLights(scene)[1] as DirectionalLight;
        const n = Math.hypot(2, 4, 3);
        expect(own.position.toArray().map(v => v / DIRECTIONAL_DISTANCE)).toEqual([2 / n, 4 / n, 3 / n].map(v => expect.closeTo(v, 3)));
        expect(own.target.position.toArray()).toEqual([0, 0, 0]);
        expect(own.target.parent).toBe(scene);
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
