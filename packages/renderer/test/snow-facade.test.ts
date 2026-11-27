import { it, expect, vi, beforeEach } from 'vitest';
import { Bone, BufferGeometry, Color, Float32BufferAttribute, MeshBasicMaterial, Object3D, Scene, Skeleton, SkinnedMesh, Uint16BufferAttribute, type WebGPURenderer } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DEFAULT_SNOW, type SceneEntity, type SnowSettings } from '@opensekai/contracts';
import type { SnowBuildUp } from '../src/snow-build-up';
const built = vi.hoisted(() => [] as SnowBuildUp[]);
// The real build-up, with spies on its methods: the reset and clear uniforms are inside it, so the tests read the step arguments.
vi.mock('../src/snow-build-up', async original => {
    const actual = await original<typeof import('../src/snow-build-up')>();
    return { ...actual, createSnowBuildUp: vi.fn((...args: Parameters<typeof actual.createSnowBuildUp>) => {
        const buildUp = actual.createSnowBuildUp(...args);
        if (buildUp) { vi.spyOn(buildUp, 'step'); vi.spyOn(buildUp, 'clear'); vi.spyOn(buildUp, 'dispose'); built.push(buildUp); }
        return buildUp;
    }) };
});
import { createSnowBuildUp } from '../src/snow-build-up';
import { CharacterMToonMaterial } from '../src/character-mtoon';
import { SNOW_SKY_LAYER } from '../src/snow-sky';
import { createSnow, type SnowAvatar } from '../src/snow';

type Entity = Extract<SceneEntity, { kind: 'snow' }>;
const entity = (patch: Partial<SnowSettings> = {}, visible = true): Entity => ({ id: 'snow_1', name: 'Snow', visible, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW, ...patch } });
const clock = (tick: number, resets = 0) => ({ sessionId: 'session', tick, elapsedMs: tick * 1000 / 60, resets });
/** A root with one skinned mesh of 3 vertices and one MToon material. */
const avatar = (material = new CharacterMToonMaterial()) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const mesh = new SkinnedMesh(geometry, material), root = new Object3D();
    mesh.bind(new Skeleton([new Bone()]));
    root.add(mesh);
    return { root, mesh, material };
};
const entry = (id: string, { root, material }: ReturnType<typeof avatar>, tick = 1, materials: readonly CharacterMToonMaterial[] | null = null): SnowAvatar => ({ id, root, materials: materials ?? [material], clock: clock(tick) });
const stubRenderer = () => ({
    autoClear: true, compute: vi.fn(), renderAsync: vi.fn(async () => {}), clear: vi.fn(),
    getRenderTarget: vi.fn(() => null), setRenderTarget: vi.fn(), getClearColor: vi.fn((color: Color) => color), getClearAlpha: vi.fn(() => 0), setClearColor: vi.fn(),
});
const asRenderer = (stub: ReturnType<typeof stubRenderer>) => stub as unknown as WebGPURenderer;
const make = (compute = true) => createSnow({ tint: uniform(new Color(1, 1, 1)), compute });
beforeEach(() => { built.length = 0; vi.mocked(createSnowBuildUp).mockClear(); });

it('gives each avatar its own share and sets it on eligible MToon materials only', () => {
    const snow = make(), a = avatar(), b = avatar();
    const outline = new CharacterMToonMaterial(), blended = new CharacterMToonMaterial(), lilToon = new MeshBasicMaterial();
    outline.isOutline = true;
    blended.transparent = true;
    snow.update(entity(), 0, [{ ...entry('a', a), materials: [a.material, outline, blended, lilToon] }, entry('b', b)], [a.root, b.root]);
    expect(a.material.snow).not.toBeNull(); expect(b.material.snow).not.toBeNull();
    expect(a.material.snow).not.toBe(b.material.snow);
    expect(a.material.snow!.state).not.toBe(b.material.snow!.state);
    expect(a.material.snow).toMatchObject({ state: built[0]!.state, count: 3 });
    expect(a.material.snow!.thickness).toBe(b.material.snow!.thickness);
    expect(a.material.snow!.noise).toBe(b.material.snow!.noise);
    expect(outline.snow).toBeNull(); expect(blended.snow).toBeNull(); expect('snow' in lilToon).toBe(false);
    expect(a.mesh.layers.isEnabled(SNOW_SKY_LAYER)).toBe(true);
    expect(snow.warnings()).toEqual([]);
    snow.dispose();
});
it('reports a material that two avatars use', () => {
    const snow = make(), a = avatar(), b = avatar();
    const avatars = [entry('a', a), entry('b', b, 1, [b.material, a.material])];
    snow.update(entity(), 0, avatars, []);
    expect(() => snow.update(entity(), 0, avatars, [])).not.toThrow();
    expect(a.material.snow!.state).toBe(built[0]!.state);
    expect(b.material.snow!.state).toBe(built[1]!.state);
    expect(snow.warnings()).toEqual([{ code: 'UNSUPPORTED', message: 'Snow build-up shares a material', ids: ['b'] }]);
    snow.dispose();
});
it('steps each build-up by the clock of its avatar and resets on a teleport', async () => {
    const snow = make(), stub = stubRenderer(), renderer = asRenderer(stub), a = avatar(), b = avatar(), scene = new Scene();
    snow.update(entity(), 0, [entry('a', a, 5), entry('b', b, 5)], []);
    await snow.render(renderer, scene);
    const [stepA, stepB] = built.map(buildUp => vi.mocked(buildUp.step));
    expect(stepA).toHaveBeenLastCalledWith(renderer, 0, true);
    stub.compute.mockClear();
    snow.update(entity(), 0.1, [entry('a', a, 6), entry('b', b, 6)], []);
    await snow.render(renderer, scene);
    expect(stub.compute).toHaveBeenCalledTimes(2);
    expect(stepA).toHaveBeenLastCalledWith(renderer, 1 / 60, false);
    expect(stepB).toHaveBeenLastCalledWith(renderer, 1 / 60, false);
    // The sky pass draws before the steps.
    expect(stub.renderAsync.mock.invocationCallOrder.at(-1)).toBeLessThan(stub.compute.mock.invocationCallOrder[0]!);
    stub.compute.mockClear();
    snow.update(entity(), 0.2, [{ ...entry('a', a), clock: clock(7, 1) }, entry('b', b, 7)], []);
    await snow.render(renderer, scene);
    expect(stub.compute).toHaveBeenCalledTimes(2);
    expect(stepA).toHaveBeenLastCalledWith(renderer, 1 / 60, true);
    expect(stepB).toHaveBeenLastCalledWith(renderer, 1 / 60, false);
    snow.dispose();
});
it('clears the materials and the buffers when an avatar leaves, when the root of an avatar changes, and on dispose', () => {
    const snow = make(), scene = new Scene(), a = avatar(), b = avatar(), c = avatar();
    scene.add(snow.flakes);
    snow.update(entity(), 0, [entry('a', a), entry('b', b)], []);
    const [buildUpA, buildUpB] = built;
    // The material lets go of the state buffer before the buffer is disposed.
    let heldAtDispose: unknown = 'not disposed';
    const disposeA = buildUpA!.dispose;
    buildUpA!.dispose = () => { heldAtDispose = a.material.snow; disposeA(); };
    const versionA = a.material.version;
    snow.update(entity(), 0, [entry('b', b)], []);
    expect(heldAtDispose).toBeNull();
    expect(a.material.snow).toBeNull(); expect(a.material.version).toBeGreaterThan(versionA);
    expect(a.mesh.userData.snowOffset).toBeUndefined();
    expect(b.material.snow).not.toBeNull();
    const versionB = b.material.version;
    snow.update(entity(), 0, [entry('b', c)], []);
    expect(buildUpB!.dispose).toHaveBeenCalledTimes(1);
    expect(b.material.snow).toBeNull(); expect(b.material.version).toBeGreaterThan(versionB);
    expect(b.mesh.userData.snowOffset).toBeUndefined();
    expect(c.material.snow!.state).toBe(built[2]!.state); expect(c.mesh.userData.snowOffset).toBe(0);
    const versionC = c.material.version;
    snow.dispose();
    expect(built[2]!.dispose).toHaveBeenCalledTimes(1);
    expect(c.material.snow).toBeNull(); expect(c.material.version).toBeGreaterThan(versionC);
    expect(c.mesh.userData.snowOffset).toBeUndefined();
    expect(snow.flakes.parent).toBeNull();
});
it('sets each amount to 0 when the entity is not visible', async () => {
    const snow = make(), stub = stubRenderer(), renderer = asRenderer(stub), a = avatar(), scene = new Scene();
    snow.update(entity(), 0, [entry('a', a, 1)], []);
    await snow.render(renderer, scene);
    const buildUp = built[0]!;
    expect(stub.renderAsync).toHaveBeenCalledTimes(1);
    snow.update(entity({}, false), 0.1, [entry('a', a, 2)], []);
    expect(snow.flakes.visible).toBe(false);
    stub.compute.mockClear();
    await snow.render(renderer, scene);
    expect(buildUp.clear).toHaveBeenCalledTimes(1);
    expect(buildUp.step).toHaveBeenLastCalledWith(renderer, 0, false);
    expect(vi.mocked(buildUp.clear).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(buildUp.step).mock.invocationCallOrder.at(-1)!);
    expect(stub.compute).toHaveBeenCalledTimes(1);
    expect(stub.renderAsync).toHaveBeenCalledTimes(1);
    snow.update(entity({}, false), 0.2, [entry('a', a, 3)], []);
    await snow.render(renderer, scene);
    expect(stub.compute).toHaveBeenCalledTimes(1); expect(stub.renderAsync).toHaveBeenCalledTimes(1);
    // Visible again: the sky pass draws, and the first step resets.
    snow.update(entity(), 0.3, [entry('a', a, 4)], []);
    await snow.render(renderer, scene);
    expect(stub.renderAsync).toHaveBeenCalledTimes(2);
    expect(buildUp.step).toHaveBeenLastCalledWith(renderer, 0, true);
    snow.dispose();
});
it('makes no build-up and no share without compute, and still draws the sky pass and the flakes', async () => {
    const snow = make(false), stub = stubRenderer(), a = avatar();
    snow.update(entity(), 0, [entry('a', a)], [a.root]);
    await snow.render(asRenderer(stub), new Scene());
    expect(createSnowBuildUp).not.toHaveBeenCalled();
    expect(a.material.snow).toBeNull();
    expect(stub.renderAsync).toHaveBeenCalledTimes(1); expect(stub.compute).not.toHaveBeenCalled();
    expect(snow.flakes.visible).toBe(true);
    snow.dispose();
});
it('keeps the share and stops the build-up when snow does not settle on characters, so no material builds again', async () => {
    const snow = make(), stub = stubRenderer(), renderer = asRenderer(stub), a = avatar(), scene = new Scene();
    snow.update(entity(), 0, [entry('a', a)], []);
    await snow.render(renderer, scene);
    const buildUp = built[0]!, share = a.material.snow, version = a.material.version;
    stub.compute.mockClear();
    expect(snow.update(entity({ settleOnCharacters: false }), 0.1, [entry('a', a, 2)], [])).toBe(false);
    expect(buildUp.dispose).not.toHaveBeenCalled();
    expect(a.material.snow).toBe(share); expect(a.material.version).toBe(version);
    await snow.render(renderer, scene);
    // One step sets each amount to 0. Then the build-up does no work.
    expect(buildUp.clear).toHaveBeenCalledTimes(1);
    expect(buildUp.step).toHaveBeenLastCalledWith(renderer, 0, false);
    expect(stub.compute).toHaveBeenCalledTimes(1);
    snow.update(entity({ settleOnCharacters: false }), 0.2, [entry('a', a, 3)], []);
    await snow.render(renderer, scene);
    expect(stub.compute).toHaveBeenCalledTimes(1);
    // The flakes and the sky pass continue.
    expect(snow.flakes.visible).toBe(true); expect(stub.renderAsync).toHaveBeenCalledTimes(3);
    // On again: the same share, and the first step resets.
    expect(snow.update(entity(), 0.3, [entry('a', a, 4)], [])).toBe(false);
    await snow.render(renderer, scene);
    expect(a.material.snow).toBe(share); expect(a.material.version).toBe(version);
    expect(buildUp.step).toHaveBeenLastCalledWith(renderer, 0, true);
    snow.dispose();
});
it('makes no build-up while snow never settled on characters, and makes it when the setting goes on', () => {
    const snow = make(), a = avatar();
    expect(snow.update(entity({ settleOnCharacters: false }), 0, [entry('a', a)], [])).toBe(false);
    expect(createSnowBuildUp).not.toHaveBeenCalled();
    expect(a.material.snow).toBeNull();
    expect(snow.update(entity(), 0.1, [entry('a', a, 2)], [])).toBe(true);
    expect(a.material.snow).not.toBeNull();
    snow.dispose();
});
it('draws no sky pass at rate 0, and still steps the build-up with current world matrices', async () => {
    const snow = make(), stub = stubRenderer(), renderer = asRenderer(stub), a = avatar(), scene = new Scene();
    const matrices = vi.spyOn(scene, 'updateMatrixWorld');
    snow.update(entity(), 0, [entry('a', a, 1)], []);
    await snow.render(renderer, scene);
    expect(stub.renderAsync).toHaveBeenCalledTimes(1);
    stub.compute.mockClear(); matrices.mockClear();
    snow.update(entity({ rate: 0 }), 0.1, [entry('a', a, 2)], []);
    await snow.render(renderer, scene);
    expect(stub.renderAsync).toHaveBeenCalledTimes(1);
    expect(matrices).toHaveBeenCalledTimes(1);
    expect(built[0]!.step).toHaveBeenLastCalledWith(renderer, 1 / 60, false);
    expect(matrices.mock.invocationCallOrder[0]).toBeLessThan(stub.compute.mock.invocationCallOrder[0]!);
    snow.update(entity({ rate: 0.5 }), 0.2, [entry('a', a, 3)], []);
    await snow.render(renderer, scene);
    expect(stub.renderAsync).toHaveBeenCalledTimes(2);
    snow.dispose();
});
it('lists the ids of the materials whose pipelines are snow pipelines', () => {
    const snow = make(), a = avatar(), other = new CharacterMToonMaterial();
    expect(snow.materialIds().has(a.material.id)).toBe(false);
    snow.update(entity(), 0, [entry('a', a)], []);
    const ids = snow.materialIds();
    expect(ids.has(a.material.id)).toBe(true);
    expect(ids.has((snow.flakes as unknown as { material: { id: number } }).material.id)).toBe(true);
    expect(ids.has(other.id)).toBe(false);
    // The flakes, the sky pass, and one character material.
    expect(ids.size).toBe(3);
    snow.dispose();
});
it('gives an avatar without a skinned vertex no share and no error, and does not collect it again', async () => {
    const snow = make(), stub = stubRenderer(), root = new Object3D(), material = new CharacterMToonMaterial();
    snow.update(entity(), 0, [{ id: 'a', root, materials: [material], clock: clock(1) }], []);
    snow.update(entity(), 0, [{ id: 'a', root, materials: [material], clock: clock(2) }], []);
    await snow.render(asRenderer(stub), new Scene());
    expect(createSnowBuildUp).toHaveBeenCalledTimes(1);
    expect(material.snow).toBeNull(); expect(stub.compute).not.toHaveBeenCalled();
    expect(snow.warnings()).toEqual([]);
    snow.dispose();
});
it('keeps no build-up for an avatar whose materials cannot take the share', async () => {
    const snow = make(), a = avatar(), lilToon = new MeshBasicMaterial(), renderer = stubRenderer();
    expect(snow.update(entity(), 0, [{ ...entry('a', a), materials: [lilToon] }], [a.root])).toBe(false);
    expect(built[0]!.dispose).toHaveBeenCalledTimes(1);
    await snow.render(asRenderer(renderer), new Scene());
    expect(built[0]!.step).not.toHaveBeenCalled();
    expect(renderer.compute).not.toHaveBeenCalled();
    // The avatar is not settled again on the next frame.
    snow.update(entity(), 1 / 60, [{ ...entry('a', a, 2), materials: [lilToon] }], [a.root]);
    expect(createSnowBuildUp).toHaveBeenCalledTimes(1);
    snow.dispose();
});
it('reports a frame in which a material got or lost its share', () => {
    const snow = make(), a = avatar();
    expect(snow.update(entity(), 0, [entry('a', a)], [a.root])).toBe(true);
    expect(snow.update(entity(), 1 / 60, [entry('a', a, 2)], [a.root])).toBe(false);
    // The avatar leaves: its material loses the share.
    expect(snow.update(entity(), 2 / 60, [], [])).toBe(true);
    expect(snow.update(entity(), 3 / 60, [], [])).toBe(false);
    snow.dispose();
});

