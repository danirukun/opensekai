import { it, expect, vi, beforeEach } from 'vitest';
import { Bone, BufferGeometry, Float32BufferAttribute, Object3D, OrthographicCamera, Skeleton, SkinnedMesh, Uint16BufferAttribute, type Camera, type Scene } from 'three/webgpu';
import { DEFAULT_SNOW, QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
type Mock = ReturnType<typeof vi.fn>;
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() }, backend: 'webgpu' as 'webgpu' | 'webgl2', load: vi.fn(), renderer: {} as Record<'renderAsync' | 'compute', Mock>, settleError: null as Error | null, report: (() => {}) as (failure: { label: string | null }, first: boolean) => void }));
vi.mock('../src/snow-build-up', async original => {
    const actual = await original<typeof import('../src/snow-build-up')>();
    return { ...actual, createSnowBuildUp: (...args: Parameters<typeof actual.createSnowBuildUp>) => { if (ports.settleError) throw ports.settleError; return actual.createSnowBuildUp(...args); } };
});
vi.mock('../src/backend', () => ({ initializeBackend: async () => {
    const renderer = { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, autoClear: true, setSize: vi.fn(), renderAsync: vi.fn(async () => {}), compileAsync: vi.fn(), dispose: vi.fn(),
        compute: vi.fn(), clear: vi.fn(), getRenderTarget: vi.fn(() => null), setRenderTarget: vi.fn(), getClearColor: vi.fn((color: unknown) => color), getClearAlpha: vi.fn(() => 0), setClearColor: vi.fn() };
    ports.renderer = renderer;
    return { backend: ports.backend, renderer };
} }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
vi.mock('../src/avatar-pose', () => ({ createAvatarBinding: (vrm: { root: Object3D; characters: unknown[] }) => ({ root: vrm.root, characters: vrm.characters, apply: vi.fn(), uv: vi.fn(), lighting: vi.fn(), advanceSprings: vi.fn(), headWorldPosition: () => null }) }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }), roomIrradiance: async () => [[1, 1, 1], ...Array.from({ length: 8 }, () => [0, 0, 0])] }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: (_device: unknown, report: (failure: { label: string | null }, first: boolean) => void) => { ports.report = report; return () => {}; }, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';
import { CharacterMToonMaterial } from '../src/character-mtoon';
import { SNOW_LAYER } from '../src/snow-flakes';
import { SNOW_SKY_LAYER } from '../src/snow-sky';

const snow: SceneEntity = { id: 'snow_1', name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW } };
let sequence = 0;
const frame = (extra: SceneEntity[], withAvatar = false): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera' || (withAvatar && e.kind === 'avatar')), ...structuredClone(extra)];
    for (const e of f.scene.entities) if (e.kind === 'avatar') e.assetId = 'avatar_a';
    return f;
};
const make = () => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
const drawnScene = () => ports.aa.render.mock.lastCall![0] as Scene;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** An avatar asset whose root has one skinned mesh with one MToon material. */
const avatarAsset = () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array(12).fill(0), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    const material = new CharacterMToonMaterial(), mesh = new SkinnedMesh(geometry, material), root = new Object3D();
    mesh.bind(new Skeleton([new Bone()]));
    root.add(mesh);
    return { root, mesh, material, value: { scene: root, vrm: { root, characters: [material] }, debug: {}, warnings: [], dispose: vi.fn() } };
};
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); ports.load.mockReset(); ports.backend = 'webgpu'; ports.settleError = null; });

it('applies a frame with a snow entity without loading it as an object', async () => {
    const readAsset = vi.fn();
    const renderer = await createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
    const applied = await renderer.applyFrame(frame([snow]));
    expect(applied.warnings).toEqual([]);
    expect(readAsset).not.toHaveBeenCalled();
    renderer.dispose();
});
it('adds the flakes for a snow entity, hides them with the entity, and removes them with the entity', async () => {
    const renderer = await make();
    await renderer.applyFrame(frame([snow]));
    const flakes = drawnScene().getObjectByName('snow-flakes')!, withSnow = drawnScene().children.length;
    expect(flakes.visible).toBe(true);
    await renderer.applyFrame(frame([{ ...snow, visible: false }]));
    expect(drawnScene().getObjectByName('snow-flakes')).toBe(flakes);
    expect(flakes.visible).toBe(false);
    ports.renderer.renderAsync.mockClear();
    await renderer.applyFrame(frame([]));
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    expect(flakes.parent).toBeNull();
    // The flakes are the only scene object of the snow entity.
    expect(drawnScene().children.length).toBe(withSnow - 1);
    // No snow entity: no sky pass.
    expect(ports.renderer.renderAsync).not.toHaveBeenCalled();
    renderer.dispose();
});
it('renders the sky pass before the post chain or the direct draw, inside the frame', async () => {
    const renderer = await make();
    await renderer.applyFrame(frame([snow]));
    const sky = ports.renderer.renderAsync.mock;
    expect(sky.calls[0]![1]).toBeInstanceOf(OrthographicCamera);
    expect(sky.calls[0]![0]).toBe(drawnScene());
    expect(sky.invocationCallOrder[0]).toBeLessThan(ports.aa.render.mock.invocationCallOrder[0]!);
    renderer.dispose();
});
it('draws the snow layer with the output camera', async () => {
    const renderer = await make();
    await renderer.applyFrame(frame([snow]));
    const camera = ports.aa.render.mock.lastCall![1] as Camera;
    expect(camera.layers.isEnabled(SNOW_LAYER)).toBe(true);
    expect(camera.layers.isEnabled(SNOW_SKY_LAYER)).toBe(false);
    expect(camera.layers.isEnabled(0)).toBe(true);
    renderer.dispose();
});
it.each([
    ['webgpu', true],
    ['webgl2', false],
] as const)('settles snow on an installed MToon avatar only with a compute (%s)', async (backend, compute) => {
    ports.backend = backend;
    const asset = avatarAsset();
    ports.load.mockResolvedValue(asset.value);
    const renderer = await make();
    await renderer.applyFrame(frame([snow], true));
    await settle();
    await renderer.applyFrame(frame([snow], true));
    expect(drawnScene().getObjectById(asset.root.id)).toBe(asset.root);
    expect(asset.mesh.layers.isEnabled(SNOW_SKY_LAYER)).toBe(true);
    expect(ports.renderer.compute).toHaveBeenCalledTimes(compute ? 1 : 0);
    expect(asset.material.snow !== null).toBe(compute);
    expect(drawnScene().getObjectByName('snow-flakes')?.visible).toBe(true);
    expect(ports.renderer.renderAsync.mock.calls.some(call => call[1] instanceof OrthographicCamera)).toBe(true);
    renderer.dispose();
});
it('draws the rest of the frame when the snow fails, and tries again after a revision change', async () => {
    const renderer = await make();
    const warning = { code: 'UNSUPPORTED', message: 'Snow failed: sky pass lost', ids: ['snow_1'] };
    ports.renderer.renderAsync.mockRejectedValueOnce(new Error('sky pass lost'));
    const failed = await renderer.applyFrame(frame([snow]));
    expect(failed.warnings).toContainEqual(warning);
    expect(ports.aa.render).toHaveBeenCalledTimes(1);
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    ports.renderer.renderAsync.mockClear();
    const same = await renderer.applyFrame(frame([snow]));
    expect(same.warnings).toContainEqual(warning);
    expect(ports.renderer.renderAsync).not.toHaveBeenCalled();
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    const next = frame([snow]);
    next.scene.revision += 1;
    const again = await renderer.applyFrame(next);
    expect(again.warnings).toEqual([]);
    expect(ports.renderer.renderAsync.mock.calls[0]![1]).toBeInstanceOf(OrthographicCamera);
    expect(drawnScene().getObjectByName('snow-flakes')).toBeDefined();
    renderer.dispose();
});
it('draws the frame when the snow update fails', async () => {
    const asset = avatarAsset();
    ports.load.mockResolvedValue(asset.value);
    const renderer = await make();
    await renderer.applyFrame(frame([], true));
    await settle();
    ports.settleError = new Error('settle lost');
    const failed = await renderer.applyFrame(frame([snow], true));
    expect(failed.warnings).toContainEqual({ code: 'UNSUPPORTED', message: 'Snow failed: settle lost', ids: ['snow_1'] });
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    expect(asset.material.snow).toBeNull();
    renderer.dispose();
});
it('draws the frame again without the snow when the first draw with new snow materials fails', async () => {
    const asset = avatarAsset();
    ports.load.mockResolvedValue(asset.value);
    const renderer = await make();
    await renderer.applyFrame(frame([], true));
    await settle();
    ports.aa.render.mockClear();
    ports.aa.render.mockRejectedValueOnce(new Error('node build lost'));
    const failed = await renderer.applyFrame(frame([snow], true));
    expect(failed.warnings).toContainEqual({ code: 'UNSUPPORTED', message: 'Snow failed: node build lost', ids: ['snow_1'] });
    expect(ports.aa.render).toHaveBeenCalledTimes(2);
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    expect(asset.material.snow).toBeNull();
    renderer.dispose();
});
it('does not blame the snow for a draw that fails after the snow drew one time', async () => {
    const renderer = await make();
    await renderer.applyFrame(frame([snow]));
    ports.aa.render.mockRejectedValueOnce(new Error('device lost'));
    await expect(renderer.applyFrame(frame([snow]))).rejects.toMatchObject({ message: 'Render submission failed' });
    const next = await renderer.applyFrame(frame([snow]));
    expect(next.warnings).toEqual([]);
    expect(drawnScene().getObjectByName('snow-flakes')).toBeDefined();
    renderer.dispose();
});
it('stops the snow, and not the frame, when a pipeline of a snow material fails to compile', async () => {
    const renderer = await make();
    await renderer.applyFrame(frame([snow]));
    const flakes = drawnScene().getObjectByName('snow-flakes') as unknown as { material: { id: number } };
    ports.report({ label: `renderPipeline_snow-flakes_${flakes.material.id}` }, true);
    const failed = await renderer.applyFrame(frame([snow]));
    expect(failed.warnings).toContainEqual({ code: 'UNSUPPORTED', message: 'Snow failed: Pipeline compile failed', ids: ['snow_1'] });
    const next = await renderer.applyFrame(frame([snow]));
    expect(next.warnings).toContainEqual({ code: 'UNSUPPORTED', message: 'Snow failed: Pipeline compile failed', ids: ['snow_1'] });
    expect(drawnScene().getObjectByName('snow-flakes')).toBeUndefined();
    renderer.dispose();
});

