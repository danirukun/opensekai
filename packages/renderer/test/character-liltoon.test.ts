// The character lilToon material on the real loader path, the frame path, and its lighting hooks, with no GPU draw (lilToon on WebGPU R8).
import {afterEach, expect, it, vi} from 'vitest';
import {BufferGeometry, Mesh, PointLight, StackNode, StorageBufferAttribute, Texture, type Material, type Node, type NodeBuilder, type Vector3} from 'three/webgpu';
import {float, setCurrentStack, stack, uniform, vec3} from 'three/tsl';
import {DEFAULT_AVATAR_LIGHTING, QUALITY_PROFILES, makeSmokeFrame, type AvatarLighting, type RuntimeFrame} from '@opensekai/contracts';
import type {LilToonLightingModel} from '@mochiya/three-liltoon/webgpu';
import {createAssetLoader} from '../src/assets';
import {CharacterMToonMaterial, createCharacterShare} from '../src/character-mtoon';
import {CharacterLilToonMaterial} from '../src/character-liltoon';
import {CHARACTER_AMBIENT, GroupDirectionalLight, batchedLights, isLitMaterial} from '../src/scene-lights';
import {CHARACTER_FILL} from '../src/character-lighting-math';
import {SNOW_COLOR, SNOW_SHADE} from '../src/snow-math';
import {createSnowNoise} from '../src/snow-surface';
import type * as AvatarPose from '../src/avatar-pose';

const ports = vi.hoisted(() => ({bindings: [] as ReturnType<typeof AvatarPose.createAvatarBinding>[]}));
vi.mock('../src/backend', () => ({initializeBackend: async () => ({backend: 'webgl2', renderer: {shadowMap: {enabled: false}, info: {memory: {geometries: 0, textures: 0}}, setSize: vi.fn(), renderAsync: vi.fn(async () => {}), compileAsync: vi.fn(async () => {}), dispose: vi.fn()}})}));
vi.mock('../src/environment-light', async original => ({...await original<typeof import('../src/environment-light')>(), roomEnvironmentMap: () => () => ({texture: new Texture(), dispose() {}}), roomIrradiance: async () => [[2, 2, 2], [0.5, 0.5, 0.5], ...Array.from({length: 7}, () => [0, 0, 0])]}));
vi.mock('../src/avatar-pose', async original => {
    const module = await original<typeof AvatarPose>();
    return {...module, createAvatarBinding: (vrm: Parameters<typeof module.createAvatarBinding>[0]) => { const binding = module.createAvatarBinding(vrm); ports.bindings.push(binding); return binding; }};
});
import {createRenderer} from '../src/renderer';
afterEach(() => { ports.bindings.length = 0; });

// A GLB with a JSON chunk and a binary chunk.
function glb(json: object, bin: Uint8Array): ArrayBuffer {
    const pad = (bytes: Uint8Array, fill: number) => { const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill); out.set(bytes); return out; };
    const text = pad(new TextEncoder().encode(JSON.stringify(json)), 0x20), data = pad(bin, 0);
    const bytes = new ArrayBuffer(12 + 8 + text.length + 8 + data.length);
    const view = new DataView(bytes);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
    view.setUint32(12, text.length, true); view.setUint32(16, 0x4e4f534a, true); new Uint8Array(bytes, 20).set(text);
    view.setUint32(20 + text.length, data.length, true); view.setUint32(24 + text.length, 0x004e4942, true); new Uint8Array(bytes, 28 + text.length).set(data);
    return bytes;
}
const BONES = ['hips', 'spine', 'head', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand'];
const LILTOON = 'MOCHIYA_materials_liltoon';
// Two triangles of VRM 0.x. Skin has the lilToon extension (an outline variant by default) and MToon data with an outline; Hair
// is MToon with an outline. Each mesh has its own accessors, so the outline groups of the MToon plugin do not reach Skin. No texture,
// so Node decodes no image. `vrm: false` gives the same file as a GLB prop.
function avatar({shaderVariant = 'Hidden/lilToonOutline', vrm = true, color, materialValues = []}: {shaderVariant?: string; vrm?: boolean; color?: number[]; materialValues?: object[]} = {}): ArrayBuffer {
    const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const accessor = (byteOffset: number, extra: object = {}) => ({bufferView: 0, byteOffset, componentType: 5126, count: 3, type: 'VEC3', ...extra});
    const primitive = (material: number) => ({attributes: {POSITION: 2 * material, NORMAL: 2 * material + 1}, material});
    const properties = (name: string) => ({name, shader: 'VRM/MToon', floatProperties: {_OutlineWidthMode: 1, _OutlineWidth: 0.5}, vectorProperties: {}, textureProperties: {}, keywordMap: {}, tagMap: {}});
    const liltoon = {specVersion: '1.3', lilToonVersion: '2.4.1', shaderVariant, properties: {_UseShadow: 1, ...(color ? {_Color: color} : {})}, textures: {}};
    return glb({
        asset: {version: '2.0'}, extensionsUsed: vrm ? ['VRM', LILTOON] : [LILTOON], scene: 0, scenes: [{nodes: [0, 1, 2]}],
        nodes: [{mesh: 0, name: 'Skin'}, {mesh: 1, name: 'Hair'}, {name: 'hips', children: BONES.slice(1).map((_, i) => 3 + i)}, ...BONES.slice(1).map(name => ({name}))],
        meshes: [{name: 'Skin', primitives: [primitive(0)]}, {name: 'Hair', primitives: [primitive(1)]}],
        materials: [{name: 'Skin', pbrMetallicRoughness: {}, extensions: {[LILTOON]: liltoon}}, {name: 'Hair', pbrMetallicRoughness: {}}],
        buffers: [{byteLength: triangle.byteLength}], bufferViews: [{buffer: 0, byteLength: triangle.byteLength}],
        accessors: [accessor(0, {min: [0, 0, 0], max: [1, 1, 0]}), accessor(36), accessor(72, {min: [0, 0, 0], max: [1, 1, 0]}), accessor(108)],
        ...(vrm ? {extensions: {VRM: {specVersion: '0.0', meta: {title: 'Mixed'}, humanoid: {humanBones: BONES.map((bone, node) => ({bone, node: 2 + node}))}, materialProperties: [properties('Skin'), properties('Hair')], blendShapeMaster: {blendShapeGroups: [{name: 'Toggle', presetName: 'unknown', binds: [], materialValues}]}}}} : {}),
    }, new Uint8Array(triangle.buffer));
}
const load = (bytes: ArrayBuffer) => createAssetLoader({readAsset: async () => bytes})('asset_l');
const materialsOf = (mesh: Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];
const allMaterials = (root: {traverse(f: (o: unknown) => void): void}) => { const found: Material[] = []; root.traverse(o => { if ((o as Mesh).isMesh) found.push(...materialsOf(o as Mesh)); }); return found; };

it('loads a VRM material with the lilToon extension and MToon data as a character lilToon material with an outline, and no MToon material', async () => {
    const asset = await load(avatar());
    const skin = materialsOf(asset.scene.getObjectByName('Skin') as Mesh) as CharacterLilToonMaterial[];
    expect(skin).toHaveLength(2);
    for (const material of skin) {
        expect(material).toBeInstanceOf(CharacterLilToonMaterial);
        expect([material.isCharacterLilToonMaterial, material.type, isLitMaterial(material)]).toEqual([true, 'CharacterLilToonMaterial', true]);
        expect([material.shadowStrength, material.environmentFill, material.giEqualizationFactor, material.characterShare]).toEqual([DEFAULT_AVATAR_LIGHTING.shadowStrength, DEFAULT_AVATAR_LIGHTING.environmentFill, 0.9, null]);
    }
    expect(skin.map(material => material.isOutline)).toEqual([false, true]);
    const hair = materialsOf(asset.scene.getObjectByName('Hair') as Mesh);
    expect(hair.map(material => material instanceof CharacterMToonMaterial)).toEqual([true, true]);
    // Only the Hair surface and its outline are MToon.
    expect(allMaterials(asset.scene).filter(material => material instanceof CharacterMToonMaterial)).toEqual(hair);
    expect(asset.warnings).toEqual([]);
    asset.dispose();
});

it('puts both kinds in the characters of an avatar and writes the Lighting values without a recompile, rim values to MToon only', async () => {
    const asset = await load(avatar());
    const {createAvatarBinding} = await vi.importActual<typeof AvatarPose>('../src/avatar-pose');
    const binding = createAvatarBinding(asset.vrm!);
    const lil = materialsOf(asset.scene.getObjectByName('Skin') as Mesh), mtoon = materialsOf(asset.scene.getObjectByName('Hair') as Mesh);
    expect(new Set(binding.characters)).toEqual(new Set([...lil, ...mtoon]));
    const versions = binding.characters.map(material => material.version);
    binding.lighting({...DEFAULT_AVATAR_LIGHTING, rimStrength: 0.2, shadowStrength: 0.1, environmentFill: 1.5});
    for (const material of lil as CharacterLilToonMaterial[]) {
        expect([material.shadowStrength, material.environmentFill]).toEqual([0.1, 1.5]);
        expect('rimStrength' in material).toBe(false);
    }
    for (const material of mtoon as CharacterMToonMaterial[]) expect([material.rimStrength, material.shadowStrength, material.environmentFill]).toEqual([0.2, 0.1, 1.5]);
    expect(binding.characters.map(material => material.version)).toEqual(versions);
    asset.dispose();
});

it('gives each load of the same bytes its own materials and disposes both outline materials on dispose', async () => {
    const bytes = avatar();
    const [first, second] = await Promise.all([load(bytes), load(bytes)]);
    const a = materialsOf(first.scene.getObjectByName('Skin') as Mesh), b = materialsOf(second.scene.getObjectByName('Skin') as Mesh);
    expect(a).toHaveLength(2);
    for (const material of a) expect(b).not.toContain(material);
    const spies = a.map(material => vi.spyOn(material, 'dispose'));
    first.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    for (const material of b) expect(material).toBeInstanceOf(CharacterLilToonMaterial);
    second.dispose();
});

it('gives a Hidden/lilToonFur material one UNSUPPORTED load warning that names the material and the property', async () => {
    const asset = await load(avatar({shaderVariant: 'Hidden/lilToonFur'}));
    expect(asset.warnings).toHaveLength(1);
    expect(asset.warnings[0]).toMatchObject({code: 'UNSUPPORTED', ids: ['asset_l']});
    expect(asset.warnings[0]!.message).toContain('Skin');
    expect(asset.warnings[0]!.message).toContain('shaderVariant');
    asset.dispose();
});

it('applies a VRM expression color bind to the lilToon surface and its outline, and restores the color at weight 0', async () => {
    const asset = await load(avatar({color: [1, 0.5, 0.25, 1], materialValues: [{materialName: 'Skin', propertyName: '_Color', targetValue: [0, 0, 0, 0]}]}));
    expect(asset.warnings).toEqual([]);
    const skin = materialsOf(asset.scene.getObjectByName('Skin') as Mesh) as CharacterLilToonMaterial[];
    const colors = () => skin.map(material => material.getProperty('_Color'));
    const expressions = asset.vrm!.expressionManager!;
    expressions.setValue('Toggle', 1); expressions.update();
    expect(colors()).toEqual([[0, 0, 0, 0], [0, 0, 0, 0]]);
    expressions.setValue('Toggle', 0.5); expressions.update();
    expect(colors()).toEqual([[0.5, 0.25, 0.125, 0.5], [0.5, 0.25, 0.125, 0.5]]);
    expressions.setValue('Toggle', 0); expressions.update();
    expect(colors()).toEqual([[1, 0.5, 0.25, 1], [1, 0.5, 0.25, 1]]);
    asset.dispose();
});

it('loads a GLB prop with the lilToon extension on the PBR path with one warning that names the extension', async () => {
    const asset = await load(avatar({vrm: false}));
    const [skin] = materialsOf(asset.scene.getObjectByName('Skin') as Mesh);
    expect(skin).not.toBeInstanceOf(CharacterLilToonMaterial);
    expect((skin as Material & {isMeshStandardMaterial?: boolean}).isMeshStandardMaterial).toBe(true);
    expect(asset.warnings).toHaveLength(1);
    expect(asset.warnings[0]).toMatchObject({code: 'UNSUPPORTED', ids: ['asset_l']});
    expect(asset.warnings[0]!.message).toContain(LILTOON);
    asset.dispose();
});

let sequence = 0;
const frame = (lighting?: AvatarLighting): RuntimeFrame => {
    const f = makeSmokeFrame({sequence: ++sequence, tick: sequence});
    f.scene.entities = f.scene.entities.filter(e => e.kind === 'camera' || e.kind === 'avatar');
    for (const e of f.scene.entities) if (e.kind === 'avatar') { e.assetId = 'avatar_mixed'; e.lighting = lighting; }
    return f;
};

it('gives both kinds of an avatar the room fill of the renderer and the per-frame Lighting values', async () => {
    const r = await createRenderer({canvas: {width: 1920, height: 1080} as HTMLCanvasElement, outputId: 'output_main', mode: 'force-webgl2', resources: {readAsset: async () => avatar()}, diagnostics: false, quality: QUALITY_PROFILES.production_v1});
    await vi.waitFor(async () => { await r.applyFrame(frame()); expect(ports.bindings[0]?.characters[0]?.characterShare).toBeTruthy(); });
    const {characters} = ports.bindings[0]!;
    expect(characters.filter(m => m instanceof CharacterLilToonMaterial)).toHaveLength(2);
    expect(characters.filter(m => m instanceof CharacterMToonMaterial)).toHaveLength(2);
    const share = characters[0]!.characterShare!;
    for (const material of characters) expect(material.characterShare).toBe(share);
    // The room irradiance of the renderer is in the share: the flat start values have no band-1 term.
    expect((share.sh.array[1] as Vector3).toArray()).not.toEqual([0, 0, 0]);
    const versions = characters.map(m => m.version);
    const lit = {...DEFAULT_AVATAR_LIGHTING, rimStrength: 2, shadowStrength: 0.2, environmentFill: 1.5};
    await vi.waitFor(async () => { await r.applyFrame(frame(lit)); expect(characters.map(m => [m.shadowStrength, m.environmentFill])).toEqual(characters.map(() => [0.2, 1.5])); });
    for (const material of characters) if (material instanceof CharacterMToonMaterial) expect(material.rimStrength).toBe(2);
    expect(characters.map(m => m.version)).toEqual(versions);
    r.dispose();
});

// The lighting model of a material with a stand-in for the r187 lighting context. It builds the node graph only (no WGSL).
type Light = {shadowNode: Node | null; baseColorNode: Node | null};
type StackEntry = {targetNode?: Node & {name?: string}; sourceNode?: Node};
// `lightNodes` is what the lights node of the build gives; `colors` is the light color of each light (white by default).
function run(material: CharacterLilToonMaterial, lights: Light[], {lightNodes = [], colors = []}: {lightNodes?: unknown[]; colors?: Node[]} = {}) {
    const getShadow = (material.setupLighting({material, renderer: {lighting: {enabled: true}}, lightsNode: {getScope: () => ({hasLights: true})}, context: {}} as unknown as NodeBuilder) as unknown as {value: {getShadow(light: Light): Node | null}}).value.getShadow;
    for (const light of lights) getShadow(light);
    const model = material.setupLightingModel() as LilToonLightingModel;
    const context = {irradiance: vec3(0.2).toVar(), iblIrradiance: vec3(0.1).toVar(), outgoingLight: vec3().toVar(), reflectedLight: {directDiffuse: vec3().toVar(), directSpecular: vec3().toVar(), indirectDiffuse: vec3().toVar(), indirectSpecular: vec3().toVar()}};
    const builder = {context, lightsNode: {getLightNodes: () => lightNodes, setupLights: () => { lights.forEach((lightNode, i) => model.direct({lightDirection: vec3(0, 0, 1), lightColor: colors[i] ?? vec3(1), lightNode, reflectedLight: context.reflectedLight} as never)); }}} as unknown as NodeBuilder;
    const nodes = stack();
    setCurrentStack(nodes);
    try { model.start(builder); model.finish(builder); } finally { setCurrentStack(null); }
    const sourcesOf = (name: string) => (nodes.nodes as StackEntry[]).filter(entry => entry.targetNode?.name === name).map(entry => entry.sourceNode!);
    const outgoing = (nodes.nodes as StackEntry[]).filter(entry => entry.targetNode === context.outgoingLight).map(entry => entry.sourceNode!);
    return {context, sourcesOf, outgoing};
}
// The nodes of a graph that match. Node.traverse does not go into the inputs of a TSL function call.
const find = (root: Node, match: (node: Node) => boolean) => {
    const seen = new Set<unknown>(), found = new Set<Node>();
    const walk = (value: unknown): void => {
        if (value === null || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        const node = value as Node & {rawInputs?: unknown};
        if (node.isNode && match(node)) found.add(node);
        if (node.isNode) { node.getChildren().forEach(walk); walk(node.rawInputs); } else Object.values(value).forEach(walk);
    };
    walk(root);
    return found;
};
const uses = (root: Node, target: object) => find(root, node => node === target).size > 0;
const references = (root: Node, property: string) => [...find(root, node => (node as Node & {property?: string}).property === property)];
const withValue = (root: Node, value: number) => find(root, node => (node as Node & {value?: unknown}).value === value).size;
const shadowed = () => new CharacterLilToonMaterial({properties: {_UseShadow: 1, _ShadowReceive: 1}});

it('scales only the cast shadow by Shadow Strength, through one material reference that a write does not recompile', () => {
    const material = shadowed();
    const lights = [{shadowNode: float(0.3), baseColorNode: vec3(1)}, {shadowNode: float(0.6), baseColorNode: vec3(1)}];
    const {sourcesOf} = run(material, lights);
    // The first light is the main light and gives the bands; the other light adds its own limited ForwardAdd color.
    const [band] = sourcesOf('lilBands');
    const [added] = sourcesOf('lilAddedLight');
    expect(sourcesOf('lilBands')).toHaveLength(1);
    expect(uses(band!, lights[0]!.shadowNode!)).toBe(true);
    expect(uses(added!, lights[1]!.shadowNode!)).toBe(true);
    // As CharacterMToonMaterial, the cast shadow multiplies the band step: no band step (fwidth) reads it.
    const steps = find(band!, node => (node as Node & {method?: string}).method === 'fwidth');
    expect(steps.size).toBeGreaterThan(0);
    expect([...steps].some(step => uses(step, lights[0]!.shadowNode!))).toBe(false);
    const [first, second] = [band!, added].map(node => references(node, 'shadowStrength'));
    expect(first).toHaveLength(1);
    expect(second![0]).toBe(first![0]);
    const [version, key] = [material.version, material.customProgramCacheKey()];
    material.shadowStrength = 0.1;
    expect([material.version, material.customProgramCacheKey()]).toEqual([version, key]);
});

it('gives an avatar surface CHARACTER_AMBIENT of the scene ambient and the room fill, as the MToon character material', () => {
    const material = shadowed(), share = createCharacterShare();
    material.characterShare = share;
    const {context, sourcesOf} = run(material, []);
    const [ambient] = sourcesOf('lilAmbient');
    expect(uses(ambient!, context.irradiance)).toBe(true);
    expect(withValue(ambient!, CHARACTER_AMBIENT)).toBe(1);
    expect(uses(ambient!, context.iblIrradiance)).toBe(true);
    expect(uses(ambient!, share.fill)).toBe(true);
    expect(references(ambient!, 'environmentFill')).toHaveLength(1);
    expect(withValue(ambient!, CHARACTER_FILL)).toBe(1);
    // The room irradiance of the share at the normal, mixed toward its mean by the GI equalization factor.
    const iblIrradiance: Node[] = [];
    const environment = material.setupEnvironment() as unknown as {setup(builder: NodeBuilder): void};
    setCurrentStack(new StackNode());
    try { environment.setup({context: {iblIrradiance: {addAssign: (node: Node) => iblIrradiance.push(node)}}} as unknown as NodeBuilder); } finally { setCurrentStack(null); }
    expect(iblIrradiance).toHaveLength(1);
    expect(uses(iblIrradiance[0]!, share.sh)).toBe(true);
    expect(references(iblIrradiance[0]!, 'giEqualizationFactor')).toHaveLength(1);
});

it('gives an outline CHARACTER_AMBIENT of the scene ambient and no room fill', () => {
    const material = shadowed();
    material.characterShare = createCharacterShare();
    const outline = material.clone();
    outline.isOutline = true;
    const {context, sourcesOf} = run(outline, []);
    const [ambient] = sourcesOf('lilAmbient');
    expect(withValue(ambient!, CHARACTER_AMBIENT)).toBe(1);
    expect(uses(ambient!, context.iblIrradiance)).toBe(false);
    expect(uses(ambient!, material.characterShare.fill)).toBe(false);
    expect(outline.setupEnvironment()).toBeNull();
});

it('keeps the full scene ambient and no fill without a share', () => {
    const material = shadowed();
    const {context, sourcesOf} = run(material, []);
    const [ambient] = sourcesOf('lilAmbient');
    expect(uses(ambient!, context.irradiance)).toBe(true);
    expect(withValue(ambient!, CHARACTER_AMBIENT)).toBe(0);
    expect(uses(ambient!, context.iblIrradiance)).toBe(false);
    expect(material.setupEnvironment()).toBeNull();
});

// Snow on lilToon R2 to R5: the node graph of a surface and of its outline with a share, with no WGSL.
it('gives a lilToon surface with a share the snow push, colour, shade, and effect strength, and its outline the push only', () => {
    const snow = {state: new StorageBufferAttribute(new Float32Array(12), 4), count: 3, thickness: uniform(0.015), noise: createSnowNoise()};
    const build = (material: CharacterLilToonMaterial) => {
        material.snow = snow;
        const mesh = new Mesh(new BufferGeometry(), material);
        const builder = {object: mesh, geometry: mesh.geometry, material, isOpaque: () => true} as unknown as NodeBuilder;
        const nodes = stack();
        setCurrentStack(nodes);
        try { material.setupPosition(builder); material.setupDiffuseColor(builder); } finally { setCurrentStack(null); }
        const vertex = nodes.nodes as Node[];
        const {outgoing} = run(material, [{shadowNode: null, baseColorNode: null}]);
        const mask = (root: Node) => find(root, node => (node as Node & {name?: string}).name === 'SnowMask').size > 0;
        const color = (root: Node, [x, y, z]: readonly number[]) => find(root, node => { const value = (node as Node & {value?: Partial<Vector3>}).value; return value?.x === x && value?.y === y && value?.z === z; }).size > 0;
        return {
            push: vertex.some(node => uses(node, snow.thickness)),
            color: vertex.some(node => color(node, SNOW_COLOR)),
            shade: outgoing.some(node => color(node, SNOW_SHADE)),
            masked: outgoing.some(mask),
        };
    };
    const properties = {_UseShadow: 1, _UseRim: 1};
    expect(build(new CharacterLilToonMaterial({properties}))).toEqual({push: true, color: true, shade: true, masked: true});
    const outline = new CharacterLilToonMaterial({properties});
    outline.isOutline = true;
    expect(build(outline)).toEqual({push: true, color: false, shade: false, masked: false});
});

it('keeps the lighting values and the share on clone, and keys the program on the share', () => {
    const material = shadowed();
    expect(material.customProgramCacheKey().endsWith('|')).toBe(true);
    Object.assign(material, {shadowStrength: 0.3, environmentFill: 1.5, giEqualizationFactor: 0.25, characterShare: createCharacterShare()});
    expect(material.customProgramCacheKey().endsWith('|character')).toBe(true);
    const copy = material.clone();
    expect(copy).toBeInstanceOf(CharacterLilToonMaterial);
    expect([copy.shadowStrength, copy.environmentFill, copy.giEqualizationFactor, copy.characterShare]).toEqual([0.3, 1.5, 0.25, material.characterShare]);
    expect(copy.customProgramCacheKey().endsWith('|character')).toBe(true);
});

it('keeps the first directional light as the main light next to a batched data node (light scale R20, TB3 (b))', () => {
    const material = shadowed();
    const node = batchedLights([new GroupDirectionalLight(), new PointLight()]);
    // The light nodes of the real r187 DynamicLightsNode: the per-light directional node, then the point, spot, and ambient data nodes.
    const lightNodes = (node as unknown as {getLightNodes(builder: object): (Light & {light?: object})[]}).getLightNodes({getDataFromNode: () => ({}), context: {materialLightings: []}});
    expect(lightNodes).toHaveLength(4);
    const [directional] = lightNodes;
    expect(directional!.light).toBeInstanceOf(GroupDirectionalLight);
    // The data nodes give one shared light node to `direct` for all lights of a type. Here it builds first.
    const batch = {light: {}, shadowNode: null, baseColorNode: null};
    const colors = [vec3(0, 1, 0), vec3(1, 0, 0)];
    const {sourcesOf} = run(material, [batch, directional!], {lightNodes, colors});
    const [main] = sourcesOf('lilLight'), [band] = sourcesOf('lilBands'), [added] = sourcesOf('lilAddedLight');
    expect(sourcesOf('lilLight')).toHaveLength(1);
    expect(uses(main!, colors[1]!)).toBe(true);
    expect(uses(band!, colors[1]!)).toBe(true);
    expect(uses(band!, colors[0]!)).toBe(false);
    expect(uses(added!, colors[0]!)).toBe(true);
});
