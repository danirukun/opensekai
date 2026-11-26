import { it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SNOW, QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgpu', renderer: { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => vi.fn() }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: () => () => {}, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';

const snow: SceneEntity = { id: 'snow_1', name: 'Snow', visible: true, transform: { position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [6, 4, 6] }, kind: 'snow', snow: { ...DEFAULT_SNOW } };
let sequence = 0;
const frame = (extra: SceneEntity[]): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...structuredClone(extra)];
    return f;
};
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); });

it('applies a frame with a snow entity without loading it as an object', async () => {
    const readAsset = vi.fn();
    const renderer = await createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
    const applied = await renderer.applyFrame(frame([snow]));
    expect(applied.warnings).toEqual([]);
    expect(readAsset).not.toHaveBeenCalled();
    renderer.dispose();
});
