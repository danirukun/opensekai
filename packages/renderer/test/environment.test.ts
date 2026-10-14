import { it, expect, vi, beforeEach, describe } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, MeshBasicMaterial, BoxGeometry, Texture, type Object3D } from 'three/webgpu';
import { makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), compile: vi.fn(), light: { apply: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgl2', renderer: { info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: ports.render, compileAsync: ports.compile, dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), createEnvironmentLight: () => ports.light, roomEnvironmentMap: () => () => ({ texture: new Texture(), dispose() {} }) }));
import { createRenderer } from '../src/renderer';
const settle = () => new Promise(r => setTimeout(r, 0));
let sequence = 0;
const stage = (assetId: string | null): SceneEntity => ({ id: 'stage', name: 'Environment', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'environment', assetId });
function frame(options: { assetId?: string | null; flag?: boolean } = {}): RuntimeFrame {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), stage(options.assetId === undefined ? 'scene_a' : options.assetId)];
    const cameraId = f.scene.outputs.find(o => o.id === 'output_main')!.cameraId;
    for (const e of f.scene.entities) if (e.kind === 'camera' && e.id === cameraId && options.flag !== undefined) e.renderEnvironment = options.flag;
    return f;
}
const rendered = () => ports.render.mock.lastCall![0] as Group;
const room = () => { const root = new Group(); root.name = 'room'; return { scene: root, warnings: [], dispose: vi.fn() }; };
beforeEach(() => { ports.load.mockReset(); ports.render.mockReset().mockResolvedValue(undefined); ports.compile.mockReset().mockResolvedValue(undefined); ports.light.apply.mockReset(); ports.light.dispose.mockReset(); });
const make = (outputId: 'output_main' | 'preview_main' = 'output_main') => createRenderer({ canvas: { width: 1920, height: 1080 } as HTMLCanvasElement, outputId, mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, resolutionScale: 1 });

it('loads the environment, lights it before GPU preparation, and draws it', async () => {
    ports.load.mockResolvedValue(room());
    const r = await make();
    await r.applyFrame(frame()); await settle();
    await r.applyFrame(frame());
    const object = rendered().getObjectByName('room');
    expect(object?.visible).toBe(true);
    expect(ports.light.apply).toHaveBeenCalledTimes(1);
    expect((ports.light.apply.mock.calls[0]![0] as Object3D).name).toBe('room');
    expect(ports.light.apply.mock.invocationCallOrder[0]!).toBeLessThan(ports.compile.mock.invocationCallOrder[0]!);
    r.dispose();
});
it('draws nothing for an environment without a model', async () => {
    const r = await make();
    await r.applyFrame(frame({ assetId: null }));
    expect(ports.load).not.toHaveBeenCalled();
    r.dispose();
});
it('hides the environment when the output camera turns Render Environment off', async () => {
    ports.load.mockResolvedValue(room());
    const r = await make();
    await r.applyFrame(frame()); await settle();
    await r.applyFrame(frame({ flag: false }));
    expect(rendered().getObjectByName('room')?.visible).toBe(false);
    await r.applyFrame(frame({ flag: true }));
    expect(rendered().getObjectByName('room')?.visible).toBe(true);
    r.dispose();
});
it('follows the flag of its own output camera', async () => {
    ports.load.mockResolvedValue(room());
    // The smoke frame points both outputs at camera_wide; move the preview to camera_close and turn the flag off there only.
    const split = () => {
        const f = frame();
        f.scene.outputs.find(o => o.id === 'preview_main')!.cameraId = 'camera_close';
        for (const e of f.scene.entities) if (e.kind === 'camera' && e.id === 'camera_close') e.renderEnvironment = false;
        return f;
    };
    for (const [outputId, visible] of [['output_main', true], ['preview_main', false]] as const) {
        const r = await make(outputId);
        await r.applyFrame(split()); await settle();
        await r.applyFrame(split());
        expect(rendered().getObjectByName('room')?.visible).toBe(visible);
        r.dispose();
    }
});
describe('releases material copies with the installed instance', () => {
    const install = async () => {
        const release = vi.fn();
        ports.light.apply.mockReturnValue(release);
        ports.load.mockResolvedValue(room());
        const r = await make();
        await r.applyFrame(frame()); await settle();
        await r.applyFrame(frame());
        expect(ports.light.apply).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
        return { r, release };
    };
    it('on model replacement', async () => {
        const { r, release } = await install();
        await r.applyFrame(frame({ assetId: 'scene_b' })); await settle();
        await r.applyFrame(frame({ assetId: 'scene_b' }));
        expect(release).toHaveBeenCalledTimes(1);
        r.dispose();
    });
    it('when the model is cleared', async () => {
        const { r, release } = await install();
        await r.applyFrame(frame({ assetId: null }));
        expect(release).toHaveBeenCalledTimes(1);
        r.dispose();
        expect(release).toHaveBeenCalledTimes(1);
    });
    it('when the entity is removed', async () => {
        const { r, release } = await install();
        const f = frame(); f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera');
        await r.applyFrame(f);
        expect(release).toHaveBeenCalledTimes(1);
        r.dispose();
    });
    it('when the renderer is disposed', async () => {
        const { r, release } = await install();
        r.dispose(); await settle();
        expect(release).toHaveBeenCalledTimes(1);
    });
});
it('puts the map on instance clones only and releases it once', async () => {
    const { createEnvironmentLight } = await vi.importActual<typeof import('../src/environment-light')>('../src/environment-light');
    const { disposeObject } = await vi.importActual<typeof import('../src/assets')>('../src/assets');
    const dispose = vi.fn();
    const texture = new Texture();
    const textureDispose = vi.spyOn(texture, 'dispose');
    const make = vi.fn(() => ({ texture, dispose }));
    const light = createEnvironmentLight(make);
    const source = new MeshStandardMaterial();
    const cached = new Group(); cached.add(new Mesh(new BoxGeometry(), source));
    const instance = cached.clone();
    const release = light.apply(instance);
    const lit = (instance.children[0] as Mesh).material as MeshStandardMaterial;
    expect(lit.envMap).toBe(texture);
    expect(lit).not.toBe(source);
    expect(source.envMap).toBeNull();
    expect(((cached.clone().children[0]) as Mesh).material).toBe(source);
    expect(((cached.clone().children[0]) as Mesh).material).toHaveProperty('envMap', null);
    const litDispose = vi.spyOn(lit, 'dispose');
    release(); release();
    expect(litDispose).toHaveBeenCalledTimes(1);
    disposeObject(cached);
    expect(textureDispose).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    light.apply(new Group());
    expect(make).toHaveBeenCalledTimes(1);
    light.dispose(); light.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
});
it('lights standard materials only and leaves unlit materials alone', async () => {
    const { createEnvironmentLight } = await vi.importActual<typeof import('../src/environment-light')>('../src/environment-light');
    const texture = new Texture();
    const light = createEnvironmentLight(() => ({ texture, dispose() {} }));
    const unlit = new MeshBasicMaterial();
    const root = new Group(); root.add(new Mesh(new BoxGeometry(), unlit));
    light.apply(root);
    const after = (root.children[0] as Mesh).material as MeshBasicMaterial;
    expect(after).toBe(unlit);
    expect(after.envMap).toBeNull();
    const lit = new MeshStandardMaterial();
    const other = new Group(); other.add(new Mesh(new BoxGeometry(), lit));
    light.apply(other);
    const copy = (other.children[0] as Mesh).material as MeshStandardMaterial;
    expect(copy).not.toBe(lit);
    expect(copy.envMap).toBe(texture);
});
it('copies each distinct material once per instance', async () => {
    const { createEnvironmentLight } = await vi.importActual<typeof import('../src/environment-light')>('../src/environment-light');
    const light = createEnvironmentLight(() => ({ texture: new Texture(), dispose() {} }));
    const shared = new MeshStandardMaterial();
    const root = new Group();
    root.add(new Mesh(new BoxGeometry(), shared), new Mesh(new BoxGeometry(), shared));
    const clone = vi.spyOn(shared, 'clone');
    const release = light.apply(root);
    const [a, b] = root.children.map(c => (c as Mesh).material as MeshStandardMaterial);
    expect(clone).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).not.toBe(shared);
    const copyDispose = vi.spyOn(a!, 'dispose');
    release();
    expect(copyDispose).toHaveBeenCalledTimes(1);
});
