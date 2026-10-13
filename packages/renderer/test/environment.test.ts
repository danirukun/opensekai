import { it, expect, vi, beforeEach } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, BoxGeometry, Texture, type Object3D } from 'three/webgpu';
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
it('sets the map on environment materials only and releases it once', async () => {
    const { createEnvironmentLight } = await vi.importActual<typeof import('../src/environment-light')>('../src/environment-light');
    const dispose = vi.fn();
    const make = vi.fn(() => ({ texture: new Texture(), dispose }));
    const light = createEnvironmentLight(make);
    const material = new MeshStandardMaterial();
    const root = new Group(); root.add(new Mesh(new BoxGeometry(), material));
    const other = new MeshStandardMaterial();
    light.apply(root); light.apply(root);
    expect(material.envMap).toBeInstanceOf(Texture);
    expect(other.envMap).toBeNull();
    expect(make).toHaveBeenCalledTimes(1);
    light.dispose(); light.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
});
