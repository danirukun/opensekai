// The renderer frame path sets MToon UV animation from frame.elapsedMs (MAT-01 slice 1, R5).
import {expect, it, vi} from 'vitest';
import {Group, Object3D} from 'three/webgpu';
import {VRM, VRMHumanoid, type VRMHumanBones} from '@pixiv/three-vrm';
import {MToonNodeMaterial} from '@pixiv/three-vrm/nodes';
import {QUALITY_PROFILES, makeSmokeFrame, type RuntimeFrame} from '@opensekai/contracts';
const ports = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../src/backend', () => ({initializeBackend: async () => ({backend: 'webgl2', renderer: {shadowMap: {enabled: false}, info: {memory: {geometries: 0, textures: 0}}, setSize: vi.fn(), renderAsync: vi.fn(async () => {}), compileAsync: vi.fn(async () => {}), dispose: vi.fn()}})}));
vi.mock('../src/assets', async original => ({...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load}));
import {createRenderer} from '../src/renderer';

function avatar() {
    const scene = new Group(), hips = new Object3D();
    scene.add(hips);
    const bones = {hips: {node: hips}} as VRMHumanBones;
    for (const name of ['spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const) { const node = new Object3D(); hips.add(node); bones[name] = {node}; }
    const surface = new MToonNodeMaterial();
    surface.uvAnimationScrollXSpeedFactor = 0.25;
    surface.uvAnimationScrollYSpeedFactor = -0.5;
    surface.uvAnimationRotationSpeedFactor = 1;
    const outline = surface.clone();
    outline.isOutline = true;
    const still = new MToonNodeMaterial();
    const vrm = new VRM({scene, humanoid: new VRMHumanoid(bones), materials: [surface, outline, still], meta: {metaVersion: '1', name: 'generated', authors: ['tests'], licenseUrl: 'https://example.com'}});
    return {vrm, surface, outline, still};
}
let sequence = 0;
const frame = (elapsedMs: number): RuntimeFrame => {
    const f = makeSmokeFrame({sequence: ++sequence, tick: sequence});
    f.elapsedMs = elapsedMs;
    f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera' || e.kind === 'avatar');
    for (const e of f.scene.entities) if (e.kind === 'avatar') e.assetId = 'avatar_uv';
    return f;
};
const values = (m: MToonNodeMaterial) => [m.uvAnimationScrollXOffset, m.uvAnimationScrollYOffset, m.uvAnimationRotationPhase];

it('sets the UV animation of each MToon material from the frame time', async () => {
    const a = avatar();
    ports.load.mockResolvedValue({scene: a.vrm.scene, vrm: a.vrm, warnings: [], dispose: vi.fn()});
    const r = await createRenderer({canvas: {width: 1920, height: 1080} as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: {readAsset: vi.fn()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    await r.applyFrame(frame(0));
    await new Promise(resolve => setTimeout(resolve, 0));
    // The avatar installs in this frame and gets the values of this frame.
    await r.applyFrame(frame(1500));
    expect(values(a.surface)).toEqual([0.375, 2 - 0.75, 1.5]);
    expect(values(a.outline)).toEqual(values(a.surface));
    await r.applyFrame(frame(1500));
    expect(values(a.surface)).toEqual([0.375, 1.25, 1.5]);
    await r.applyFrame(frame(2000));
    expect(values(a.surface)).toEqual([0.5, 1, 2]);
    expect(values(a.outline)).toEqual(values(a.surface));
    expect(values(a.still)).toEqual([0, 0, 0]);
    r.dispose();
});
