// The material report on the real loader path (MAT-01 slice 1, R2–R3).
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {expect, it} from 'vitest';
import {MToonMaterialLoaderPlugin} from '@pixiv/three-vrm';
import {MATERIAL_EXTENSIONS} from '@opensekai/contracts';
import {createAssetLoader} from '../src/assets';

function glb(json: object): ArrayBuffer {
    const text = new TextEncoder().encode(JSON.stringify({asset: {version: '2.0'}, scenes: [{nodes: []}], scene: 0, ...json}));
    const size = Math.ceil(text.length / 4) * 4;
    const bytes = new ArrayBuffer(20 + size);
    const view = new DataView(bytes);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
    view.setUint32(12, size, true); view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(bytes, 20).fill(0x20).set(text);
    return bytes;
}
const load = (json: object) => createAssetLoader({readAsset: async () => glb(json)})('asset_m');
const material = (name: string, extensions: object = {}) => ({name, pbrMetallicRoughness: {}, extensions});

it('reads the VRM 0.x shader from the stored bytes, not from the parsed JSON', async () => {
    const asset = await load({extensionsUsed: ['VRM'], materials: [material('Skin')], extensions: {VRM: {specVersion: '0.0', materialProperties: [{name: 'Skin', shader: 'Standard'}]}}});
    expect(asset.warnings).toContainEqual({code: 'UNSUPPORTED', message: 'Unsupported material features: Skin (shader:Standard)', ids: ['asset_m']});
    asset.dispose();
});
it('loads a model with an unsupported material and names it in one warning', async () => {
    const asset = await load({materials: [material('Glass', {KHR_materials_pbrSpecularGlossiness: {}}), material('Wood', {KHR_materials_specular: {}})]});
    expect(asset.scene).toBeDefined();
    expect(asset.warnings).toEqual([{code: 'UNSUPPORTED', message: 'Unsupported material features: Glass (KHR_materials_pbrSpecularGlossiness)', ids: ['asset_m']}]);
    asset.dispose();
    const many = await load({materials: Array.from({length: 20}, (_, i) => material(`M${i}`, {KHR_materials_pbrSpecularGlossiness: {}}))});
    const message = many.warnings[0]!.message;
    expect(message.match(/KHR_materials_pbrSpecularGlossiness/g)).toHaveLength(16);
    expect(message.endsWith('; and 4 more')).toBe(true);
    many.dispose();
});
it('gives no material warning for a supported model', async () => {
    const asset = await load({materials: [material('Wood', {KHR_materials_specular: {}}), material('Sign', {KHR_materials_unlit: {}})]});
    expect(asset.warnings).toEqual([]);
    asset.dispose();
});
it('pins the supported material extensions to the installed loaders', () => {
    // GLTFLoader does not export its EXTENSIONS object, so read the names from its source.
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('three/examples/jsm/loaders/GLTFLoader.js'), 'utf8');
    const table = source.slice(source.indexOf('const EXTENSIONS = {'), source.indexOf('};', source.indexOf('const EXTENSIONS = {')));
    const loader = [...table.matchAll(/'((?:KHR|EXT)_materials_\w+)'/g)].map(match => match[1]);
    // The HDR emissive plugin is not exported, so read the material plugin names from the three-vrm bundle too.
    const bundle = readFileSync(require.resolve('@pixiv/three-vrm'), 'utf8');
    const vrm = [...bundle.matchAll(/LoaderPlugin\.EXTENSION_NAME = "(VRMC_materials_\w+)"/g)].map(match => match[1]);
    expect(vrm).toContain(MToonMaterialLoaderPlugin.EXTENSION_NAME);
    expect(new Set([...loader, ...vrm])).toEqual(MATERIAL_EXTENSIONS);
});
