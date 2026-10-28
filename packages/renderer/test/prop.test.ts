import { it, expect, vi, beforeEach } from 'vitest';
import { Group, Texture, type Object3D } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), compile: vi.fn(), light: { apply: vi.fn(), room: vi.fn(), dispose: vi.fn() }, instances: [] as { reflections: ReturnType<typeof vi.fn> }[] }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), createEnvironmentLight: () => ports.light, roomEnvironmentMap: () => () => ({ texture: new Texture(), dispose() {} }) }));
import { createRenderer } from '../src/renderer';
const settle = () => new Promise(r => setTimeout(r, 0));
let sequence = 0;
const placed = { visible: true, transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] } };
const prop = (id: string, source: Extract<SceneEntity, { kind: 'mesh' }>['source']): SceneEntity => ({ id, name: id, ...placed, kind: 'mesh', source });
const stage = (reflectionsIntensity?: number): SceneEntity => ({ id: 'stage', name: 'Environment', ...placed, kind: 'environment', assetId: null, ...(reflectionsIntensity === undefined ? {} : { reflectionsIntensity }) });
function frame(entities: SceneEntity[]): RuntimeFrame {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...entities];
    return f;
}
const rendered = () => ports.render.mock.lastCall![0] as Group;
const named = (name: string) => { const root = new Group(); root.name = name; return { scene: root, warnings: [], dispose: vi.fn() }; };
const roots = (name: string) => { const found: Object3D[] = []; rendered().traverse(o => { if (o.name === name) found.push(o); }); return found; };
beforeEach(() => {
    ports.load.mockReset(); ports.render.mockReset().mockResolvedValue(undefined); ports.compile.mockReset().mockResolvedValue(undefined); ports.instances.length = 0;
    ports.light.apply.mockReset().mockImplementation(() => { const made = { dispose() {}, reflections: vi.fn() }; ports.instances.push(made); return made; });
});
const make = () => createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
it('draws nothing and loads nothing for a prop without a model, and still draws a box source', async () => {
    const r = await make();
    await r.applyFrame(frame([prop('empty', { kind: 'asset', assetId: null }), prop('box', { kind: 'box' })]));
    expect(ports.load).not.toHaveBeenCalled();
    const meshes: Object3D[] = []; rendered().traverse(o => { if ((o as { isMesh?: boolean }).isMesh) meshes.push(o); });
    expect(meshes).toHaveLength(1);
    r.dispose();
});
it('draws one copy for each prop of a model and loads the model once (R9)', async () => {
    ports.load.mockResolvedValue(named('walls'));
    const r = await make();
    const entities = [prop('walls', { kind: 'asset', assetId: 'scene_a' }), prop('walls_2', { kind: 'asset', assetId: 'scene_a' })];
    await r.applyFrame(frame(entities)); await settle();
    await r.applyFrame(frame(entities));
    expect(ports.load).toHaveBeenCalledTimes(1);
    const copies = roots('walls');
    expect(copies).toHaveLength(2);
    expect(copies[0]).not.toBe(copies[1]);
    expect(ports.light.apply).toHaveBeenCalledTimes(2);
    r.dispose();
});
it('gives props the Reflections Intensity of the environment, or 1 without one (R4)', async () => {
    ports.load.mockResolvedValue(named('walls'));
    const r = await make();
    const walls = prop('walls', { kind: 'asset', assetId: 'scene_a' });
    await r.applyFrame(frame([walls])); await settle();
    await r.applyFrame(frame([walls]));
    expect(ports.instances[0]!.reflections).toHaveBeenLastCalledWith(1);
    await r.applyFrame(frame([walls, stage(0.4)]));
    expect(ports.instances[0]!.reflections).toHaveBeenLastCalledWith(0.4);
    await r.applyFrame(frame([walls, stage()]));
    expect(ports.instances[0]!.reflections).toHaveBeenLastCalledWith(1);
    r.dispose();
});
