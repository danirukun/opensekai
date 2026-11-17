import { it, expect, vi, beforeEach, describe } from 'vitest';
import { DEFAULT_CAMERA_EFFECTS, DEFAULT_CAMERA_GRADING, QUALITY_PROFILES, gradingChainKey, makeSmokeFrame, type CameraEffects, type RuntimeFrame } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() }, readAsset: vi.fn() }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgpu', renderer: { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => vi.fn() }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: () => () => {}, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';
import { chainKey, needsChain } from '../src/post-chain';
import { createDirtSource } from '../src/camera-effects';
import type { ScreenImage, ScreenImageLease } from '../src/screen';

const D = DEFAULT_CAMERA_EFFECTS;
let sequence = 0;
const frame = (effects?: CameraEffects): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera').map(e => (e.id === 'camera_wide' && effects ? { ...e, effects: structuredClone(effects) } : e));
    return f;
};
const make = () => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset: ports.readAsset }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
const passed = () => ports.aa.render.mock.lastCall![6] as { key: string } | null;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); ports.readAsset.mockReset().mockReturnValue(new Promise(() => {})); });

describe('post chain rule (R19)', () => {
    it('keeps each result of before without an effects key', () => {
        for (const mode of ['none', 'fxaa'] as const)
            for (const haze of [false, true])
                for (const beams of [false, true])
                    for (const grading of [null, { ...DEFAULT_CAMERA_GRADING, exposure: 1 }]) {
                        expect(needsChain(mode, haze, grading, beams, '')).toBe(needsChain(mode, haze, grading, beams));
                        expect(chainKey(mode, haze, grading, beams, '')).toBe(chainKey(mode, haze, grading, beams));
                        expect(chainKey(mode, haze, grading, beams)).toBe(`${mode}:${haze ? 'haze' : 'clear'}:${gradingChainKey(grading)}${beams ? ':beams' : ''}`);
                    }
    });
    it('needs a chain and a new key for an effect', () => {
        expect(needsChain('none', false, null, false, 'blur')).toBe(true);
        expect(chainKey('none', false, null, false, 'blur')).not.toBe(chainKey('none', false, null, false));
        expect(chainKey('none', false, null, true, 'blur')).not.toBe(chainKey('none', false, null, true, 'blur+pixelate'));
    });
});

describe('effects in the renderer (R18, R20)', () => {
    it('passes no effects for a camera without the group, with each effect off, or with a dirt image that has not loaded', async () => {
        const renderer = await make();
        for (const effects of [undefined, {}, D, { lensDirt: { ...D.lensDirt, assetId: 'image_dirt' } }, { blur: { enabled: true, intensity: 0 } }, { pixelate: { enabled: true, intensity: 1 } }] as (CameraEffects | undefined)[]) {
            await renderer.applyFrame(frame(effects));
            expect(passed(), JSON.stringify(effects)).toBeNull();
        }
        renderer.dispose();
    });
    it('passes the same key for another number and a new key for another effect', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame({ blur: { enabled: true, intensity: 1 } }));
        const first = passed()!.key;
        expect(first).not.toBe('');
        await renderer.applyFrame(frame({ blur: { enabled: true, intensity: 3 } }));
        expect(passed()!.key).toBe(first);
        await renderer.applyFrame(frame({ blur: { enabled: true, intensity: 3 }, vignetting: { ...D.vignetting, enabled: true } }));
        expect(passed()!.key).not.toBe(first);
        renderer.dispose();
    });
    it('gives one warning while the camera keeps a dirt image that failed to load', async () => {
        ports.readAsset.mockRejectedValue(new Error('missing'));
        const renderer = await make();
        const effects = { lensDirt: { ...D.lensDirt, assetId: 'image_dirt' } };
        await renderer.applyFrame(frame(effects));
        await settle();
        const applied = await renderer.applyFrame(frame(effects));
        expect(applied.warnings.filter(w => w.ids.includes('image_dirt'))).toEqual([{ code: 'UNAVAILABLE', message: 'Asset load failed: Image failed to load', ids: ['image_dirt'] }]);
        expect(passed()).toBeNull();
        await settle();
        const again = await renderer.applyFrame(frame(effects));
        expect(again.warnings.filter(w => w.ids.includes('image_dirt'))).toHaveLength(1);
        expect(ports.readAsset).toHaveBeenCalledTimes(1);
        const cleared = await renderer.applyFrame(frame({ lensDirt: D.lensDirt }));
        expect(cleared.warnings.filter(w => w.ids.includes('image_dirt'))).toEqual([]);
        renderer.dispose();
    });
});

describe('dirt source (R20)', () => {
    const image = (id: string) => ({ texture: {}, width: 4, height: 2, alpha: true, dispose: vi.fn(), id }) as unknown as ScreenImage;
    const fakePool = () => {
        const pending = new Map<string, { resolve(lease: ScreenImageLease): void; reject(error: Error): void }>();
        const released: string[] = [];
        const acquire = vi.fn((id: string) => new Promise<ScreenImageLease>((resolve, reject) => pending.set(id, { resolve, reject })));
        const load = (id: string) => pending.get(id)!.resolve({ image: image(id), release: () => released.push(id) });
        return { acquire, pending, released, load };
    };
    it('holds one lease for one ID and gives the image after the load', async () => {
        const pool = fakePool();
        const source = createDirtSource(pool);
        expect(source.texture('image_a')).toBeNull();
        expect(source.texture('image_a')).toBeNull();
        pool.load('image_a');
        await settle();
        expect((source.texture('image_a') as unknown as { id: string }).id).toBe('image_a');
        expect(source.peek('image_a')).not.toBeNull();
        expect(source.peek('image_b')).toBeNull();
        expect(pool.acquire).toHaveBeenCalledTimes(1);
        source.dispose();
        expect(pool.released).toEqual(['image_a']);
    });
    it('releases the old lease on an ID change and on None', async () => {
        const pool = fakePool();
        const source = createDirtSource(pool);
        source.texture('image_a'); pool.load('image_a'); await settle();
        source.texture('image_b');
        expect(pool.released).toEqual(['image_a']);
        pool.load('image_b'); await settle();
        expect(source.texture(null)).toBeNull();
        expect(pool.released).toEqual(['image_a', 'image_b']);
    });
    it('releases a lease that arrives after the ID changed', async () => {
        const pool = fakePool();
        const source = createDirtSource(pool);
        source.texture('image_a');
        source.texture('image_b');
        pool.load('image_a'); await settle();
        expect(pool.released).toEqual(['image_a']);
        expect(source.texture('image_b')).toBeNull();
    });
    it('stays failed after a rejected load until the ID changes', async () => {
        const pool = fakePool();
        const source = createDirtSource(pool);
        source.texture('image_a');
        pool.pending.get('image_a')!.reject(new Error('bad'));
        await settle();
        expect(source.texture('image_a')).toBe('failed');
        expect(source.texture('image_a')).toBe('failed');
        expect(pool.acquire).toHaveBeenCalledTimes(1);
        expect(source.texture('image_b')).toBeNull();
        expect(source.texture('image_a')).toBeNull();
        expect(pool.acquire).toHaveBeenCalledTimes(3);
    });
});
