import { it, expect, vi, beforeEach, describe } from 'vitest';
import { Color, Mesh, Quaternion, Vector3, type Group } from 'three/webgpu';
import { QUALITY_PROFILES, gradingChainKey, makeSmokeFrame, type LightSettings, type RuntimeFrame, type SceneEntity } from '@opensekai/contracts';
const ports = vi.hoisted(() => ({ aa: { render: vi.fn(), dispose: vi.fn() }, failure: null as null | ((failure: unknown, first: boolean) => void) }));
vi.mock('../src/backend', () => ({ initializeBackend: async () => ({ backend: 'webgpu', renderer: { backend: { device: {} }, shadowMap: { enabled: false }, info: { memory: { geometries: 0, textures: 0 } }, setSize: vi.fn(), renderAsync: vi.fn(), compileAsync: vi.fn(), dispose: vi.fn() } }) }));
vi.mock('../src/assets', async original => ({ ...await original<typeof import('../src/assets')>(), createAssetLoader: () => vi.fn() }));
vi.mock('../src/environment-light', async original => ({ ...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({ texture: null, dispose() {} }) }));
vi.mock('../src/post-chain', async original => ({ ...await original<typeof import('../src/post-chain')>(), createPostChain: () => ports.aa }));
vi.mock('../src/pipeline-diagnostics', async original => ({ ...await original<typeof import('../src/pipeline-diagnostics')>(), watchPipelineErrors: (_device: unknown, onFailure: (failure: unknown, first: boolean) => void) => { ports.failure = onFailure; return () => {}; }, logPipelineFailure: vi.fn() }));
import { createRenderer } from '../src/renderer';
import { chainKey, needsChain } from '../src/post-chain';
import { BEAM_LAYER, beamGeometry, createBeams } from '../src/beam';
import { beamGain, beamShape } from '../src/beam-math';
import { lightSignature } from '../src/scene-lights';

const shadow = { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 };
const beam = { enabled: true, intensity: 1, softness: 0.5 };
const settings = (patch: Partial<LightSettings> = {}): LightSettings => ({ type: 'spot', color: '#ff8040', intensity: 60, range: 12, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow, cone: { angleDegrees: 14, penumbra: 0.4 }, beam, ...patch });
const spot = (id: string, patch: Partial<LightSettings> = {}, position: [number, number, number] = [0, 3, 2], rotation: [number, number, number, number] = [-0.382683, 0, 0, 0.92388]): SceneEntity => ({ id, name: id, visible: true, transform: { position, rotation, scale: [1, 1, 1] }, kind: 'light', light: settings(patch) });
const haze: SceneEntity = { id: 'haze', name: 'Haze', visible: true, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] }, kind: 'haze', haze: { density: 1, smoke: 1, intensity: 1, drift: 0.2 } };
let sequence = 0;
const frame = (extra: SceneEntity[]): RuntimeFrame => {
    const f = makeSmokeFrame({ sequence: ++sequence, tick: sequence });
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), ...structuredClone(extra)];
    return f;
};
const make = () => createRenderer({ canvas: { width: 0, height: 0 } as HTMLCanvasElement, outputId: 'output_main', mode: 'auto', resources: { readAsset: vi.fn() }, diagnostics: false, quality: QUALITY_PROFILES.production_v1 });
const drawnBeams = () => ports.aa.render.mock.lastCall![5] as { root: Group } | null;
const visible = (root: Group) => root.children.filter(child => child.visible) as Mesh[];
beforeEach(() => { ports.aa.render.mockReset().mockResolvedValue(undefined); ports.aa.dispose.mockReset(); ports.failure = null; });

describe('post chain rule (stage beams R13)', () => {
    it('needs a chain for a beam, and keeps the old results without the flag', () => {
        expect(needsChain('none', false, null, true)).toBe(true);
        expect(needsChain('none', false, null, false)).toBe(false);
        expect(needsChain('none', false, null)).toBe(false);
        expect(needsChain('none', true, null, false)).toBe(true);
        for (const mode of ['none', 'fxaa'] as const)
            for (const hazeOn of [false, true]) {
                expect(chainKey(mode, hazeOn, null, false)).toBe(chainKey(mode, hazeOn, null));
                expect(chainKey(mode, hazeOn, null)).toBe(`${mode}:${hazeOn ? 'haze' : 'clear'}:${gradingChainKey(null)}`);
                expect(chainKey(mode, hazeOn, null, true)).not.toBe(chainKey(mode, hazeOn, null));
            }
    });
});

describe('beam cones (stage beams R7, R10)', () => {
    it('has the apex at the origin and the base center at z = -1', () => {
        const geometry = beamGeometry();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        expect(box.max.z).toBeCloseTo(0, 6);
        expect(box.min.z).toBeCloseTo(-1, 6);
        expect(box.min.x).toBeCloseTo(-1, 6);
        expect(box.max.x).toBeCloseTo(1, 6);
        const p = geometry.getAttribute('position');
        const apex = Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i)).filter(v => v.z > -1e-6);
        expect(apex.length).toBeGreaterThan(0);
        for (const v of apex) expect(v.length()).toBeCloseTo(0, 6);
    });
    it('places one cone for each beam, with the light pose, the cone scale, and the gain color', () => {
        const beams = createBeams();
        const lights = [spot('a', {}, [-1, 3, 2]), spot('b', { range: 0, intensity: 30 }, [0, 3, 2]), spot('c', { cone: { angleDegrees: 170, penumbra: 0 } }, [1, 3, 2], [0, 0.707107, 0, 0.707107])];
        expect(beams.update(lights)).toBe(true);
        const meshes = visible(beams.root);
        expect(meshes).toHaveLength(3);
        meshes.forEach((mesh, i) => {
            const light = lights[i]!;
            if (light.kind !== 'light') throw new Error('not a light');
            const { length, radius } = beamShape(light.light);
            expect(mesh.position.toArray()).toEqual(light.transform.position);
            expect(mesh.quaternion.equals(new Quaternion(...light.transform.rotation))).toBe(true);
            expect(mesh.scale.x).toBeCloseTo(radius, 10);
            expect(mesh.scale.y).toBeCloseTo(radius, 10);
            expect(mesh.scale.z).toBe(length);
            expect((mesh.userData.beamColor as Color).equals(new Color(light.light.color).multiplyScalar(beamGain(light.light)))).toBe(true);
            expect(mesh.userData.beamSoftness).toBe(0.5);
        });
        expect(beams.update([lights[1]!])).toBe(true);
        expect(visible(beams.root)).toHaveLength(1);
        expect(beams.update([])).toBe(false);
        expect(visible(beams.root)).toHaveLength(0);
        beams.dispose();
    });
    it('keeps each cone on the beam layer only, with no shadow and one shared material', () => {
        const beams = createBeams();
        const meshes = beams.root.children as Mesh[];
        expect(meshes).toHaveLength(8);
        for (const mesh of meshes) {
            expect(mesh.layers.mask).toBe(1 << BEAM_LAYER);
            expect(mesh.castShadow).toBe(false);
            expect(mesh.receiveShadow).toBe(false);
            expect(mesh.material).toBe(meshes[0]!.material);
        }
        beams.dispose();
    });
    it('does not put the beam in the light signature (R11)', () => {
        const plain = spot('a', { beam: undefined });
        expect(lightSignature([spot('a')])).toBe(lightSignature([plain]));
        expect(lightSignature([spot('a', { beam: { enabled: false, intensity: 3, softness: 0 } })])).toBe(lightSignature([plain]));
    });
});

describe('beams in the renderer (stage beams R12, R15)', () => {
    it('passes the beams to the chain only while a visible spot light has the beam on', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame([spot('a')]));
        const first = drawnBeams();
        expect(first?.root.name).toBe('beams');
        expect(first!.root.parent).not.toBeNull();
        await renderer.applyFrame(frame([{ ...spot('a'), visible: false }]));
        expect(drawnBeams()).toBeNull();
        expect(first!.root.parent).toBeNull();
        await renderer.applyFrame(frame([spot('a', { beam: { ...beam, enabled: false } })]));
        expect(drawnBeams()).toBeNull();
        await renderer.applyFrame(frame([spot('a')]));
        expect(drawnBeams()).toBe(first);
        await renderer.applyFrame(frame([]));
        expect(drawnBeams()).toBeNull();
        renderer.dispose();
    });
    it('passes the beams and the haze together', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame([spot('a'), haze]));
        expect(ports.aa.render.mock.lastCall![3]).not.toBeNull();
        expect(drawnBeams()).not.toBeNull();
        renderer.dispose();
    });
    it('stops the beams after a pipeline failure while they draw, until the next node-set rebuild (R15)', async () => {
        const renderer = await make();
        await renderer.applyFrame(frame([spot('a')]));
        ports.failure!({ message: 'compile failed' }, true);
        await renderer.applyFrame(frame([spot('a')]));
        await renderer.applyFrame(frame([spot('a')]));
        expect(drawnBeams()).toBeNull();
        const applied = await renderer.applyFrame(frame([spot('a')]));
        expect(applied.warnings.map(w => w.message)).toContain('Pipeline compile failed');
        await renderer.applyFrame(frame([spot('a'), spot('b')]));
        expect(drawnBeams()).not.toBeNull();
        renderer.dispose();
    });
});
