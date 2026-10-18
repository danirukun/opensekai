import { it, expect, vi, beforeEach } from 'vitest';
import { QUALITY_PROFILES, makeSmokeFrame, type QualityProfile, type RuntimeFrame } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ backend: vi.fn(), loader: vi.fn(), setSize: vi.fn(), aa: { render: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/backend', () => ({ initializeBackend: async (...args: unknown[]) => { ports.backend(...args); return { backend: 'webgl2', renderer: { shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: ports.setSize, renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }; } }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: (_resources: unknown, options: unknown) => { ports.loader(options); return vi.fn(); } }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/anti-aliasing', () => ({ createAntiAliasing: () => ports.aa }));
import { createRenderer } from '../src/renderer';
let sequence = 0;
const frame = (antiAliasing?: 'none' | 'fxaa'): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera');
    const cameraId = f.scene.outputs.find(o => o.id === 'output_main')!.cameraId;
    for (const e of f.scene.entities) if (e.kind === 'camera' && e.id === cameraId && antiAliasing) e.antiAliasing = antiAliasing;
    return f;
};
const make = (quality: QualityProfile) => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: { readAsset: vi.fn() }, diagnostics: false, quality });
beforeEach(() => { ports.backend.mockReset(); ports.loader.mockReset(); ports.setSize.mockReset(); ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); });
it.each([
    [QUALITY_PROFILES.production_v1, 4, 2048, 1920, 1080],
    [QUALITY_PROFILES.performance_v1, 0, 1024, 1920, 1080],
    [QUALITY_PROFILES.preview_v1, 4, 1024, 960, 540],
] as const)('applies %o to MSAA, texture limit, and buffer size and names it in the acknowledgment', async (quality, samples, textures, width, height) => {
    const renderer = await make(quality);
    expect(ports.backend).toHaveBeenCalledWith(expect.anything(), 'force-webgl2', samples);
    expect(ports.loader).toHaveBeenCalledWith({ maxTextureSize: textures });
    const applied = await renderer.applyFrame(frame());
    expect(ports.setSize).toHaveBeenCalledWith(width, height, false);
    expect(applied.qualityProfile).toBe(quality.id);
    renderer.dispose();
});
it('draws with the output camera anti-aliasing mode and releases the chain on dispose', async () => {
    const renderer = await make(QUALITY_PROFILES.production_v1);
    await renderer.applyFrame(frame());
    expect(ports.aa.render.mock.lastCall![2]).toBeUndefined();
    await renderer.applyFrame(frame('none'));
    expect(ports.aa.render.mock.lastCall![2]).toBe('none');
    await renderer.applyFrame(frame('fxaa'));
    expect(ports.aa.render.mock.lastCall![2]).toBe('fxaa');
    renderer.dispose();
    await vi.waitFor(() => expect(ports.aa.dispose).toHaveBeenCalled());
});
