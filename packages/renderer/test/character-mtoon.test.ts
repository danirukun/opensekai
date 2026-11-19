// The character MToon material on the real loader path and its lighting node graph, with no GPU draw (character lighting R3).
import {expect, it, vi} from 'vitest';
import {Color, Mesh, StackNode, Texture, type Material, type Node, type NodeBuilder} from 'three/webgpu';
import {setCurrentStack, uniform, vec3} from 'three/tsl';
import {DEFAULT_AVATAR_LIGHTING} from '@opensekai/contracts';
import {createAssetLoader} from '../src/assets';
import {CharacterMToonMaterial, type CharacterLightingModel} from '../src/character-mtoon';
import {isLitMaterial} from '../src/scene-lights';

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
// Two triangles of VRM 0.x MToon: Skin has an outline and `_IndirectLightIntensity` 0.3, Hair has neither.
function vrm0(): ArrayBuffer {
    const triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const accessor = (byteOffset: number, extra: object = {}) => ({bufferView: 0, byteOffset, componentType: 5126, count: 3, type: 'VEC3', ...extra});
    const primitive = (material: number) => ({attributes: {POSITION: 0, NORMAL: 1}, material});
    const properties = (name: string, floatProperties: object) => ({name, shader: 'VRM/MToon', floatProperties, vectorProperties: {}, textureProperties: {}, keywordMap: {}, tagMap: {}});
    return glb({
        asset: {version: '2.0'}, extensionsUsed: ['VRM'], scene: 0, scenes: [{nodes: [0, 1]}],
        nodes: [{mesh: 0, name: 'Skin'}, {mesh: 1, name: 'Hair'}],
        meshes: [{name: 'Skin', primitives: [primitive(0)]}, {name: 'Hair', primitives: [primitive(1)]}],
        materials: [{name: 'Skin', pbrMetallicRoughness: {}}, {name: 'Hair', pbrMetallicRoughness: {}}],
        buffers: [{byteLength: triangle.byteLength}], bufferViews: [{buffer: 0, byteLength: triangle.byteLength}],
        accessors: [accessor(0, {min: [0, 0, 0], max: [1, 1, 0]}), accessor(36)],
        extensions: {VRM: {specVersion: '0.0', materialProperties: [
            properties('Skin', {_IndirectLightIntensity: 0.3, _OutlineWidthMode: 1, _OutlineWidth: 0.5}),
            properties('Hair', {}),
        ]}},
    }, new Uint8Array(triangle.buffer));
}
const materialsOf = (mesh: Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[];

it('loads VRM 0.x MToon surfaces and their outlines as character materials with the GI equalization of the file', async () => {
    const asset = await createAssetLoader({readAsset: async () => vrm0()})('asset_c');
    const [skin, outline] = materialsOf(asset.scene.getObjectByName('Skin') as Mesh) as CharacterMToonMaterial[];
    const [hair] = materialsOf(asset.scene.getObjectByName('Hair') as Mesh) as CharacterMToonMaterial[];
    for (const material of [skin, outline, hair]) {
        expect(material).toBeInstanceOf(CharacterMToonMaterial);
        expect([material!.isMToonNodeMaterial, material!.isCharacterMToonMaterial, material!.type, isLitMaterial(material!)]).toEqual([true, true, 'CharacterMToonMaterial', true]);
    }
    expect([skin!.isOutline, outline!.isOutline]).toEqual([false, true]);
    expect(skin!.giEqualizationFactor).toBeCloseTo(0.7, 6);
    expect(outline!.giEqualizationFactor).toBeCloseTo(0.7, 6);
    expect(hair!.giEqualizationFactor).toBeCloseTo(0.9, 6);
    const {rimTint, ...numbers} = DEFAULT_AVATAR_LIGHTING;
    expect({rimStrength: hair!.rimStrength, rimWidth: hair!.rimWidth, shadowStrength: hair!.shadowStrength, environmentFill: hair!.environmentFill}).toEqual(numbers);
    expect(`#${hair!.rimTint.getHexString()}`).toBe(rimTint);
    asset.dispose();
});

it('keeps the lighting values on clone', () => {
    const material = new CharacterMToonMaterial({giEqualizationFactor: 0.25});
    Object.assign(material, {rimStrength: 2, rimWidth: 0.1, shadowStrength: 0.3, environmentFill: 1.5});
    material.rimTint.setRGB(0.2, 0.4, 0.6);
    const copy = material.clone();
    expect([copy.rimStrength, copy.rimWidth, copy.shadowStrength, copy.environmentFill, copy.giEqualizationFactor]).toEqual([2, 0.1, 0.3, 1.5, 0.25]);
    expect(copy.rimTint.toArray()).toEqual([0.2, 0.4, 0.6]);
    expect(copy.rimTint).not.toBe(material.rimTint);
});

type Recorded = {directDiffuse: Node[]; directSpecular: Node[]; indirectDiffuse: Node[]; indirectSpecular: Node[]; iblIrradiance: Node[]};
type Lit = Node & {isContextNode?: boolean; value: {getShadow?(light: object): Node}};
// Builds the lighting of a material without a GPU, in a node stack as a node builder has one. Each `addAssign` of the lighting
// context is recorded.
function lighting(material: CharacterMToonMaterial, shadowed: boolean) {
    setCurrentStack(new StackNode());
    try { return build(material, shadowed); } finally { setCurrentStack(null); }
}
function build(material: CharacterMToonMaterial, shadowed: boolean) {
    const added: Recorded = {directDiffuse: [], directSpecular: [], indirectDiffuse: [], indirectSpecular: [], iblIrradiance: []};
    const record = (list: Node[]) => ({addAssign: (node: Node) => list.push(node)});
    const reflectedLight = {directDiffuse: record(added.directDiffuse), directSpecular: record(added.directSpecular), indirectDiffuse: record(added.indirectDiffuse), indirectSpecular: record(added.indirectSpecular)};
    const context = {reflectedLight, irradiance: vec3(0.1), iblIrradiance: Object.assign(vec3(0.2), record(added.iblIrradiance))};
    const builder = {material, renderer: {lighting: {enabled: true}}, lightsNode: {getScope: () => ({hasLights: true})}, context} as unknown as NodeBuilder;
    material.setupVariants();
    const build = vi.spyOn(material, 'setupLightingModel');
    const lit = material.setupLighting(builder) as Lit;
    const model = build.mock.results[0]!.value as CharacterLightingModel;
    build.mockRestore();
    expect(lit.isContextNode).toBe(true);
    // The light node as r187 `AnalyticLightNode` has it. Its `setupShadow` calls the hook only when the object receives the shadow.
    const lightColor = uniform(new Color(1, 1, 1)), shadowNode = uniform(0.5);
    const lightNode = {baseColorNode: lightColor, shadowNode};
    if (shadowed) expect(lit.value.getShadow!(lightNode)).toBe(lightColor);
    const environment = material.setupEnvironment();
    (environment as unknown as {setup(builder: NodeBuilder): void} | null)?.setup(builder);
    model.direct({lightDirection: vec3(0, 0, -1), lightColor, lightNode, reflectedLight} as never);
    model.indirect(builder);
    return {added, lightColor, shadowNode, environment};
}
// Whether a node graph reads the target node. Node.traverse does not go into the inputs of a TSL function call.
const uses = (root: Node, target: Node) => {
    const seen = new Set<unknown>();
    const walk = (value: unknown): boolean => {
        if (value === null || typeof value !== 'object' || seen.has(value)) return false;
        seen.add(value);
        if (value === target) return true;
        const node = value as Node & {rawInputs?: unknown};
        return node.isNode ? node.getChildren().some(walk) || walk(node.rawInputs) : Object.values(value).some(walk);
    };
    return walk(root);
};

it('puts the shadow into the shading and adds a back-light rim that follows the light color, not the shadow', () => {
    const material = new CharacterMToonMaterial();
    const {added, lightColor, shadowNode} = lighting(material, true);
    expect(added.directDiffuse).toHaveLength(1);
    expect(uses(added.directDiffuse[0]!, shadowNode)).toBe(true);
    // The authored MToon rim, then the added rim.
    expect(added.directSpecular).toHaveLength(2);
    expect(uses(added.directSpecular[1]!, lightColor)).toBe(true);
    expect(uses(added.directSpecular[1]!, shadowNode)).toBe(false);
});

it('ignores the shadow node of a light whose shadow this build does not receive', () => {
    const {added, shadowNode} = lighting(new CharacterMToonMaterial(), false);
    expect(uses(added.directDiffuse[0]!, shadowNode)).toBe(false);
});

it('adds the equalized environment fill from the share of its renderer', () => {
    const material = new CharacterMToonMaterial();
    expect(lighting(material, false).environment).toBeNull();
    const fill = uniform(new Color(1, 1, 1));
    material.characterShare = {fill, map: new Texture()};
    const {added, environment} = lighting(material, false);
    expect(environment).not.toBeNull();
    expect(added.iblIrradiance).toHaveLength(1);
    // The MToon term, then the fill.
    expect(added.indirectDiffuse).toHaveLength(2);
    expect(uses(added.indirectDiffuse[1]!, fill)).toBe(true);
    expect(material.clone().characterShare).toBe(material.characterShare);
});

it('gives an outline neither the added rim nor the environment fill', () => {
    const material = new CharacterMToonMaterial();
    material.characterShare = {fill: uniform(new Color(1, 1, 1)), map: new Texture()};
    const outline = material.clone();
    outline.isOutline = true;
    const {added, environment} = lighting(outline, true);
    expect(environment).toBeNull();
    expect([added.directDiffuse.length, added.directSpecular.length, added.indirectDiffuse.length, added.iblIrradiance.length]).toEqual([1, 1, 1, 0]);
});
