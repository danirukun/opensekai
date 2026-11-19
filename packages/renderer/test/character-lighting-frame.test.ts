// The renderer frame path applies each character's lighting values and the scene fill (character lighting R4).
import {afterEach, expect, it, vi} from 'vitest';
import {Color, Group, Object3D, Texture} from 'three/webgpu';
import {VRM, VRMHumanoid, type VRMHumanBones} from '@pixiv/three-vrm';
import {CharacterMToonMaterial} from '../src/character-mtoon';
import {DEFAULT_AVATAR_LIGHTING, QUALITY_PROFILES, makeSmokeFrame, type AvatarLighting, type LightSettings, type RuntimeFrame, type SceneEntity} from '@opensekai/contracts';
const ports = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../src/backend', () => ({initializeBackend: async () => ({backend: 'webgl2', renderer: {shadowMap: {enabled: false}, info: {memory: {geometries: 0, textures: 0}}, setSize: vi.fn(), renderAsync: vi.fn(async () => {}), compileAsync: vi.fn(async () => {}), dispose: vi.fn()}})}));
vi.mock('../src/assets', async original => ({...await original<typeof import('../src/assets')>(), createAssetLoader: () => ports.load}));
vi.mock('../src/environment-light', async original => ({...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({texture: new Texture(), dispose() {}})}));
import {createRenderer} from '../src/renderer';

function avatar() {
    const scene = new Group(), hips = new Object3D();
    scene.add(hips);
    const bones = {hips: {node: hips}} as VRMHumanBones;
    for (const name of ['spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'] as const) { const node = new Object3D(); hips.add(node); bones[name] = {node}; }
    const surface = new CharacterMToonMaterial();
    const outline = surface.clone();
    outline.isOutline = true;
    const vrm = new VRM({scene, humanoid: new VRMHumanoid(bones), materials: [surface, outline], meta: {metaVersion: '1', name: 'generated', authors: ['tests'], licenseUrl: 'https://example.com'}});
    return {vrm, surface, outline};
}
type Avatar = ReturnType<typeof avatar>;
const loaded: Avatar[] = [];
ports.load.mockImplementation(async () => { const a = avatar(); loaded.push(a); return {scene: a.vrm.scene, vrm: a.vrm, warnings: [], dispose: vi.fn()}; });
afterEach(() => { loaded.length = 0; });

let sequence = 0;
const frame = (lighting: Record<string, AvatarLighting | undefined> = {}, extra: SceneEntity[] = []): RuntimeFrame => {
    const f = makeSmokeFrame({sequence: ++sequence, tick: sequence});
    const performer = f.scene.entities.find(e => e.kind === 'avatar')!;
    const second = {...structuredClone(performer), id: 'second'};
    f.scene.entities = [...f.scene.entities.filter(e => e.kind === 'camera'), performer, second, ...extra];
    for (const e of f.scene.entities) if (e.kind === 'avatar') { e.assetId = 'avatar_lit'; e.lighting = lighting[e.id]; }
    return f;
};
const ambient = (color: string, intensity: number, visible = true): SceneEntity => ({id: `ambient_${color}`, name: 'Ambient', visible, transform: {position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1]}, kind: 'light', light: {type: 'ambient', color, intensity, range: 0, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: {enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02}} satisfies LightSettings});
const values = (m: CharacterMToonMaterial): AvatarLighting => ({rimStrength: m.rimStrength, rimWidth: m.rimWidth, rimTint: `#${m.rimTint.getHexString()}`, shadowStrength: m.shadowStrength, environmentFill: m.environmentFill});
const fill = (m: CharacterMToonMaterial) => m.characterShare!.fill.value.toArray();
const start = async (first = frame()) => {
    const r = await createRenderer({canvas: {width: 1920, height: 1080} as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: {readAsset: vi.fn()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    await r.applyFrame(first);
    await new Promise(resolve => setTimeout(resolve, 0));
    return r;
};

it('gives an avatar without lighting the default values on each character material, and the outline too', async () => {
    const r = await start();
    await r.applyFrame(frame());
    expect(loaded).toHaveLength(2);
    for (const {surface, outline} of loaded) {
        surface.rimStrength = 0; outline.rimTint.set('#000000');
        expect(surface.characterShare?.map).toBeInstanceOf(Texture);
        expect(outline.characterShare).toBe(surface.characterShare);
    }
    await r.applyFrame(frame());
    for (const {surface, outline} of loaded) { expect(values(surface)).toEqual(DEFAULT_AVATAR_LIGHTING); expect(values(outline)).toEqual(DEFAULT_AVATAR_LIGHTING); }
    r.dispose();
});

it('writes a lighting change without a recompile, and keeps the values of each avatar of one asset apart', async () => {
    const r = await start();
    await r.applyFrame(frame());
    const versions = loaded.map(a => [a.surface.version, a.outline.version]);
    const lit = {...DEFAULT_AVATAR_LIGHTING, rimStrength: 2, rimTint: '#ff8000', shadowStrength: 0.2};
    await r.applyFrame(frame({second: lit}));
    const [performer, second] = loaded;
    expect(values(second!.surface)).toEqual(lit);
    expect(values(second!.outline)).toEqual(lit);
    expect(values(performer!.surface)).toEqual(DEFAULT_AVATAR_LIGHTING);
    expect(loaded.map(a => [a.surface.version, a.outline.version])).toEqual(versions);
    expect(second!.surface.giEqualizationFactor).toBe(0.9);
    r.dispose();
});

it('fills with white without a light entity, and with the visible ambient light in linear values', async () => {
    const r = await start();
    const applied = await r.applyFrame(frame());
    const {surface, outline} = loaded[0]!;
    expect(surface.characterShare).toBeDefined();
    expect(fill(surface)).toEqual([1, 1, 1]);
    expect(applied.warnings.map(w => w.message)).not.toContain('Pipeline compile failed');
    await r.applyFrame(frame({}, [ambient('#336699', 1)]));
    expect(fill(surface)).toEqual(new Color('#336699').toArray());
    await r.applyFrame(frame({}, [ambient('#336699', 1), ambient('#ff0000', 2, false)]));
    expect(fill(surface)).toEqual(new Color('#336699').toArray());
    await r.applyFrame(frame({}, [ambient('#336699', 1, false)]));
    expect(fill(surface)).toEqual([0, 0, 0]);
    expect(outline.characterShare).toBe(surface.characterShare);
    r.dispose();
});
