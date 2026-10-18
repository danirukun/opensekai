import { it, expect, vi, beforeEach, describe } from 'vitest';
import { Object3D } from 'three/webgpu';
import { QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() }, failure: null as null | ((failure: unknown, first: boolean) => void) }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgpu', renderer: { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => vi.fn() }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: (_device: unknown, onFailure: (failure: unknown, first: boolean) => void) => { ports.failure = onFailure; return () => {}; }, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';
import { chainKey, needsChain } from '../src/post-chain';
import { conePositions, createHazeHelper, updateHazeHelper, SPOT_HELPER_LENGTH } from '../src/editor-viewport';

const haze: SceneEntity = { id: 'haze', name: 'Haze', visible: true, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] }, kind: 'haze', haze: { density: 1, smoke: 1, intensity: 1, drift: 0.2 } };
const spot: SceneEntity = { id: 'spot', name: 'Spot', visible: true, transform: { position: [0, 3, 2], rotation: [-0.382683, 0, 0, 0.92388], scale: [1, 1, 1] }, kind: 'light', light: { type: 'spot', color: '#ffffff', intensity: 60, range: 15, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 }, cone: { angleDegrees: 40, penumbra: 0.3 }, volumetric: true } };
let sequence = 0;
const frame = (extra: SceneEntity[]): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...structuredClone(extra)];
    return f;
};
const make = () => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
const drawnHaze = () => ports.aa.render.mock.lastCall![3] as { mesh: Object3D } | null;
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); ports.failure = null; });

describe('post chain rule (B13 R8)', () => {
    it('needs a chain for FXAA or a visible haze, and builds it again only when one of them changes', () => {
        expect(needsChain('none', false)).toBe(false);
        expect(needsChain('none', true)).toBe(true);
        expect(needsChain('fxaa', false)).toBe(true);
        expect(chainKey('none', true)).not.toBe(chainKey('fxaa', true));
        expect(chainKey('fxaa', false)).not.toBe(chainKey('fxaa', true));
        expect(chainKey('fxaa', true)).toBe(chainKey('fxaa', true));
    });
});

describe('haze in the renderer (B13 R7 to R9)', () => {
    it('draws a visible haze through the chain, hides it with the entity, and removes it with the entity', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame([spot, haze]));
        const first = drawnHaze();
        expect(first?.mesh.name).toBe('haze');
        expect(first!.mesh.parent).not.toBeNull();
        expect(first!.mesh.scale.toArray()).toEqual([20, 8, 20]);
        await renderer.applyFrame(frame([spot, { ...haze, visible: false }]));
        expect(drawnHaze()).toBeNull();
        await renderer.applyFrame(frame([spot]));
        expect(drawnHaze()).toBeNull();
        expect(first!.mesh.parent).toBeNull();
        renderer.dispose();
    });
    it('stops the haze after a pipeline failure while it draws, until the next node-set rebuild (R9)', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame([spot, haze]));
        ports.failure!({ message: 'compile failed' }, true);
        await renderer.applyFrame(frame([spot, haze]));
        await renderer.applyFrame(frame([spot, haze]));
        expect(drawnHaze()).toBeNull();
        const applied = await renderer.applyFrame(frame([spot, haze]));
        expect(applied.warnings.map(w => w.message)).toContain('Pipeline compile failed');
        // A light-set change rebuilds the node sets and tries the haze again.
        await renderer.applyFrame(frame([spot, { ...spot, id: 'spot2' }, haze]));
        expect(drawnHaze()).not.toBeNull();
        renderer.dispose();
    });
});

describe('editor helpers (B13 R13)', () => {
    it('outlines a spot cone with four rays and a circle at the range, or at 5 m for range 0', () => {
        const positions = conePositions(90, 10, 8);
        expect(positions.length).toBe((4 + 8) * 6);
        expect(positions.slice(0, 6).map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0, 10, 0, -10]);
        expect(conePositions(90, 0, 8)[5]).toBe(-SPOT_HELPER_LENGTH);
    });
    it('keeps the haze handle the same size when the box grows', () => {
        const root = createHazeHelper();
        root.scale.set(20, 8, 20);
        updateHazeHelper(root);
        const handle = root.getObjectByName('haze-handle')!;
        expect(handle.scale.toArray()).toEqual([1 / 20, 1 / 8, 1 / 20]);
        expect(root.getObjectByName('haze-box')).toBeDefined();
    });
});

describe('three.js r180 volumetric workarounds (macOS probe finding)', () => {
    it('scatters a light without a shadow, where r180 multiplies by a missing shadow node', async () => {
        const { createHaze } = await import('../src/haze');
        const haze = createHaze();
        const model = (haze.mesh.material as unknown as { setupLightingModel(): { direct(input: unknown, builder: unknown): void; scatteringLight(light: unknown, builder: unknown): void } }).setupLightingModel();
        expect(model.constructor.name).toBe('HazeLightingModel');
        const scattered: unknown[] = [];
        model.scatteringLight = light => { scattered.push(light); };
        const { vec3 } = await import('three/tsl');
        model.direct({ lightNode: { light: { distance: 10 } }, lightColor: vec3(1, 1, 1) }, {});
        model.direct({ lightNode: { light: {} }, lightColor: vec3(1, 1, 1) }, {});
        expect(scattered).toHaveLength(1);
        haze.dispose();
    });
});
