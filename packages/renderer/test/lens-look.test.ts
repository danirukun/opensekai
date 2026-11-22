import { it, expect, vi, beforeEach, describe } from 'vitest';
import { DEFAULT_CAMERA_EFFECTS, DEFAULT_CAMERA_GRADING, DEFAULT_CAMERA_LENS, QUALITY_PROFILES, bokehScale, dofFocalRangeWorld, makeSmokeFrame, type CameraEffects, type QualityProfile, type RuntimeFrame } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() } }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgpu', renderer: { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => vi.fn() }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: () => () => {}, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';
import { chainKey, needsChain } from '../src/post-chain';
import {
    ANAMORPHIC_TAPS_CHEAP, ANAMORPHIC_TAPS_FULL, FLARE_DOWNSAMPLE_CHEAP, FLARE_DOWNSAMPLE_FULL, activeLook, anamorphicTaps, anamorphicUv, createLensLook, dofInputs,
    effectQuality, lookChainKey, lookQuality, needsLook,
} from '../src/lens-look';
import { PerspectiveCamera, PostProcessing, RenderTarget, Scene, type WebGPURenderer } from 'three/webgpu';

const D = DEFAULT_CAMERA_EFFECTS;
const LOOK = ['depthOfField', 'lensFlare', 'anamorphicFlare', 'filmGrain'] as const;
const on = (name: (typeof LOOK)[number], extra: object = {}): CameraEffects => ({ [name]: { ...D[name], enabled: true, ...extra } });

describe('needsLook (R27)', () => {
    it('is false for no group, an empty group set, and the defaults', () => {
        for (const effects of [undefined, null, {}, D, { lensFlare: D.lensFlare }, { blur: { enabled: true, intensity: 1 } }] as (CameraEffects | null | undefined)[])
            expect(needsLook(effects), JSON.stringify(effects)).toBe(false);
    });
    it('is true while one look group is enabled', () => {
        for (const name of LOOK) expect(needsLook(on(name)), name).toBe(true);
    });
    it('gives the active flags of each group', () => {
        expect(activeLook(D)).toEqual({ depthOfField: false, lensFlare: false, anamorphicFlare: false, filmGrain: false });
        expect(activeLook({ ...on('lensFlare'), ...on('filmGrain') })).toEqual({ depthOfField: false, lensFlare: true, anamorphicFlare: false, filmGrain: true });
    });
});

describe('lookChainKey (R27, R30)', () => {
    it('is empty while no look group is enabled', () => {
        expect(lookChainKey(D, 'full')).toBe('');
        expect(lookChainKey(undefined, 'cheap')).toBe('');
    });
    it('does not change for a number', () => {
        expect(lookChainKey(on('depthOfField', { focusSpeed: 0.9 }), 'full')).toBe(lookChainKey(on('depthOfField'), 'full'));
        expect(lookChainKey(on('lensFlare', { threshold: 0.1, intensity: 3 }), 'full')).toBe(lookChainKey(on('lensFlare'), 'full'));
        expect(lookChainKey(on('anamorphicFlare', { intensity: 1, spread: 0.1 }), 'full')).toBe(lookChainKey(on('anamorphicFlare'), 'full'));
        expect(lookChainKey(on('filmGrain', { intensity: 1 }), 'full')).toBe(lookChainKey(on('filmGrain'), 'full'));
        expect(lookChainKey(on('lensFlare', { threshold: 0.123 }), 'full')).not.toContain('0.123');
    });
    it('changes for an enabled flag, a highQuality flag, the vertical smear, and the quality tier', () => {
        const base = lookChainKey(on('depthOfField'), 'full');
        expect(lookChainKey({ ...on('depthOfField'), ...on('filmGrain') }, 'full')).not.toBe(base);
        expect(lookChainKey(on('depthOfField', { highQuality: false }), 'full')).not.toBe(base);
        expect(lookChainKey(on('depthOfField'), 'cheap')).not.toBe(base);
        expect(lookChainKey(on('lensFlare', { highQuality: false }), 'full')).not.toBe(lookChainKey(on('lensFlare'), 'full'));
        expect(lookChainKey(on('anamorphicFlare', { vertical: true }), 'full')).not.toBe(lookChainKey(on('anamorphicFlare'), 'full'));
    });
    it('does not put the stylized B37 effects in the look key', () => {
        expect(lookChainKey({ ...on('filmGrain'), blur: { enabled: true, intensity: 1 } }, 'full')).toBe(lookChainKey(on('filmGrain'), 'full'));
    });
});

describe('look quality (R30, D5)', () => {
    it('makes preview and performance cheap and production full', () => {
        expect(lookQuality('preview_v1')).toBe('cheap');
        expect(lookQuality('production_v1')).toBe('full');
        expect(lookQuality('performance_v1')).toBe('cheap');
    });
    it('is cheap for the preview tier or a group without highQuality', () => {
        expect(effectQuality(true, 'full')).toBe('full');
        expect(effectQuality(false, 'full')).toBe('cheap');
        expect(effectQuality(true, 'cheap')).toBe('cheap');
    });
    it('lowers the flare resolution and the smear taps in the cheap tier', () => {
        expect(FLARE_DOWNSAMPLE_CHEAP).toBeGreaterThan(FLARE_DOWNSAMPLE_FULL);
        expect(ANAMORPHIC_TAPS_CHEAP).toBeLessThan(ANAMORPHIC_TAPS_FULL);
    });
});

describe('DoF inputs (R29)', () => {
    it('puts the world-unit focus range, not the focal length in mm, into the focal length slot', () => {
        const lens = { ...DEFAULT_CAMERA_LENS, focalLengthMm: 85, fStop: 1.8, focusDistance: 2.5 };
        for (const quality of ['full', 'cheap'] as const) {
            const inputs = dofInputs(lens, quality);
            expect(inputs.focusDistance).toBe(2.5);
            expect(inputs.focalRange).toBe(dofFocalRangeWorld(2.5, 1.8, quality));
            expect(inputs.focalRange).not.toBe(85);
            expect(inputs.bokehScale).toBe(bokehScale(85, 1.8, quality));
        }
        expect(dofInputs(lens, 'cheap').bokehScale).toBeLessThan(dofInputs(lens, 'full').bokehScale);
    });
});

describe('anamorphic smear taps (V5)', () => {
    it('spreads an odd tap count symmetrically from -1 to 1 with weights that sum to 1 and peak at the centre', () => {
        for (const count of [ANAMORPHIC_TAPS_FULL, ANAMORPHIC_TAPS_CHEAP]) {
            const taps = anamorphicTaps(count);
            expect(taps).toHaveLength(count);
            expect(taps[0]!.t).toBe(-1);
            expect(taps.at(-1)!.t).toBe(1);
            expect(taps.reduce((sum, tap) => sum + tap.weight, 0)).toBeCloseTo(1, 10);
            taps.forEach((tap, i) => expect(tap.weight).toBeCloseTo(taps[count - 1 - i]!.weight, 12));
            const centre = taps[(count - 1) / 2]!;
            expect(centre.t).toBe(0);
            expect(Math.max(...taps.map(tap => tap.weight))).toBe(centre.weight);
        }
    });
    it('moves the UV along X, or along Y for a vertical smear', () => {
        expect(anamorphicUv([0.5, 0.5], 1, 0.25, false)).toEqual([0.75, 0.5]);
        expect(anamorphicUv([0.5, 0.5], -1, 0.25, false)).toEqual([0.25, 0.5]);
        expect(anamorphicUv([0.5, 0.5], 1, 0.25, true)).toEqual([0.5, 0.75]);
    });
});

describe('post chain look key (R31, R33)', () => {
    it('keeps each prior result with an empty look key', () => {
        for (const mode of ['none', 'fxaa'] as const)
            for (const grading of [null, { ...DEFAULT_CAMERA_GRADING, exposure: 1 }])
                for (const effects of ['', 'blur']) {
                    expect(needsChain(mode, true, grading, false, effects, '')).toBe(needsChain(mode, true, grading, false, effects));
                    expect(chainKey(mode, true, grading, false, effects, '')).toBe(chainKey(mode, true, grading, false, effects));
                }
    });
    it('needs a chain and a new key for a look', () => {
        const key = lookChainKey(on('depthOfField'), 'full');
        expect(needsChain('none', false, null, false, '', key)).toBe(true);
        expect(chainKey('none', false, null, false, '', key)).not.toBe(chainKey('none', false, null, false));
        expect(chainKey('none', false, null, false, 'blur', key)).not.toBe(chainKey('none', false, null, false, 'blur'));
    });
});

let sequence = 0;
const frame = (effects?: CameraEffects): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera').map(e => (e.id === 'camera_wide' && effects ? { ...e, effects: structuredClone(effects) } : e));
    return f;
};
const make = (quality: QualityProfile = QUALITY_PROFILES.production_v1) => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset: () => new Promise(() => {}) }, diagnostics: false, quality });
const passedLook = () => ports.aa.render.mock.lastCall![7] as { key: string } | null;
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); });

describe('look in the renderer (R27, R30, R33)', () => {
    it('passes no look for a camera without the groups or with each group at its default', async () => {
        const renderer = await make();
        for (const effects of [undefined, {}, D, { blur: { enabled: true, intensity: 1 } }] as (CameraEffects | undefined)[]) {
            await renderer.applyFrame(frame(effects));
            expect(passedLook(), JSON.stringify(effects)).toBeNull();
        }
        renderer.dispose();
    });
    it('passes the same key for another number and a new key for another flag', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame(on('lensFlare')));
        const first = passedLook()!.key;
        expect(first).toBe(lookChainKey(on('lensFlare'), 'full'));
        await renderer.applyFrame(frame(on('lensFlare', { intensity: 3 })));
        expect(passedLook()!.key).toBe(first);
        await renderer.applyFrame(frame(on('lensFlare', { highQuality: false })));
        expect(passedLook()!.key).not.toBe(first);
        renderer.dispose();
    });
    it('uses the cheap tier for the preview profile and keeps the group enabled', async () => {
        const renderer = await make(QUALITY_PROFILES.preview_v1);
        await renderer.applyFrame(frame(on('depthOfField')));
        expect(passedLook()!.key).toBe(lookChainKey(on('depthOfField'), 'cheap'));
        renderer.dispose();
    });
});

// The real chain with a stand-in renderer: a rebuild must free each render target of the old chain.
describe('chain rebuild with the look', () => {
    it('disposes each render target that a chain with DoF, flare, smear, and grain made', async () => {
        const { createPostChain } = await vi.importActual<typeof import('../src/post-chain')>('../src/post-chain');
        const made = vi.spyOn(RenderTarget.prototype as unknown as { _setTextureOptions(o?: unknown): void }, '_setTextureOptions');
        const freed = vi.spyOn(RenderTarget.prototype, 'dispose');
        const draw = vi.spyOn(PostProcessing.prototype, 'renderAsync').mockResolvedValue(undefined as never);
        try {
            const chain = createPostChain({} as WebGPURenderer);
            const runtime = createLensLook();
            const scene = new Scene(), camera = new PerspectiveCamera();
            const look = (effects: CameraEffects) => ({ key: lookChainKey(effects, 'full'), effects, quality: 'full' as const, runtime });
            const all = { ...on('depthOfField'), ...on('lensFlare'), ...on('anamorphicFlare'), ...on('filmGrain') };
            const steps: [CameraEffects, typeof DEFAULT_CAMERA_GRADING | null][] = [
                [on('depthOfField'), null],
                [all, null],
                [all, { ...DEFAULT_CAMERA_GRADING, bloom: { ...DEFAULT_CAMERA_GRADING.bloom, intensity: 1 } }],
                [{ ...all, lensFlare: { ...D.lensFlare, enabled: true, highQuality: false } }, { ...DEFAULT_CAMERA_GRADING, exposure: 1 }],
            ];
            let before = 0;
            for (const [effects, grading] of steps) {
                await chain.render(scene, camera, 'none', null, grading, null, null, look(effects));
                expect(made.mock.contexts.length - before, lookChainKey(effects, 'full')).toBeGreaterThan(2);
                before = made.mock.contexts.length;
            }
            chain.dispose();
            const leaked = made.mock.contexts.filter(target => !freed.mock.contexts.includes(target as RenderTarget));
            expect(leaked).toHaveLength(0);
        } finally { made.mockRestore(); freed.mockRestore(); draw.mockRestore(); }
    });
});
