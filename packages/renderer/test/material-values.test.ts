import { expect, it } from 'vitest';
import { Color, Group, Mesh, MeshBasicMaterial, Texture, type Material, type Object3D } from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { materialEntries, type AssetMaterial } from '@opensekai/contracts';
import { copyUnlitMaterials, createMaterialBinding } from '../src/material-values';
import { createEnvironmentLight } from '../src/environment-light';
import { isLitMaterial } from '../src/scene-lights';

// B38 R28. No GPU draw: the test reads the scene graph and the material fields only.
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const colors = new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]);
const document = {
 asset: { version: '2.0' },
 extensionsUsed: ['KHR_materials_unlit'],
 buffers: [{ byteLength: positions.byteLength + colors.byteLength }],
 bufferViews: [{ buffer: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: colors.byteLength }],
 accessors: [
  { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
  { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
 ],
 materials: [
  { name: 'Wall', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.125, 1] }, emissiveFactor: [0.1, 0.2, 0.3] },
  { name: 'Glow', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.6, 1] }, extensions: { KHR_materials_unlit: {} } },
 ],
 // The second primitive has vertex colors, so GLTFLoader draws it with a clone of Wall.
 meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0 }, material: 1 }] }],
 nodes: [{ name: 'A', mesh: 0 }, { name: 'B', mesh: 1 }, { name: 'C', mesh: 2 }],
 scenes: [{ nodes: [0, 1, 2] }],
 scene: 0,
};
const glb = () => {
 const pad = (bytes: Uint8Array, fill: number) => { const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill); out.set(bytes); return out; };
 const raw = new Uint8Array(positions.byteLength + colors.byteLength);
 raw.set(new Uint8Array(positions.buffer), 0); raw.set(new Uint8Array(colors.buffer), positions.byteLength);
 const json = pad(new TextEncoder().encode(JSON.stringify(document)), 0x20), bin = pad(raw, 0);
 const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length), view = new DataView(out.buffer);
 view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
 view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
 view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
 return out.buffer;
};
const load = async () => {
 const gltf = await new GLTFLoader().parseAsync(glb(), '');
 const associations = gltf.parser.associations as Map<unknown, { materials?: number }>;
 return { scene: gltf.scene, indexOf: (material: Material) => associations.get(material)?.materials, records: materialEntries(document) };
};
type Live = Material & { color: Color; emissive?: Color; emissiveIntensity?: number; opacity: number };
const materialsOf = (root: Object3D) => { const list: Live[] = []; root.traverse(object => { const m = (object as Mesh).material; if (m) list.push(...(Array.isArray(m) ? m : [m]) as Live[]); }); return list; };
const hex = (color: Color) => `#${color.getHexString()}`;

it('writes every loaded material of a name, also a GLTFLoader clone, and restores the model value exactly', async () => {
 const { scene, indexOf, records } = await load();
 const [a, b, c] = materialsOf(scene);
 expect(a).not.toBe(b);
 expect(indexOf(b!)).toBe(0);
 const model = { color: a!.color.clone(), emissive: a!.emissive!.clone(), intensity: a!.emissiveIntensity };
 const binding = createMaterialBinding(records, scene, indexOf);
 binding.apply({ Wall: { baseColor: '#ff8000', emissionStrength: 4 }, Missing: { baseColor: '#000000' } });
 for (const material of [a!, b!]) { expect(hex(material.color)).toBe('#ff8000'); expect(material.emissiveIntensity).toBe(4); }
 expect(hex(c!.color)).toBe(records[1]!.model.baseColor);
 binding.apply({ Wall: { emissionStrength: 4 } });
 for (const material of [a!, b!]) { expect(material.color.equals(model.color)).toBe(true); expect(material.emissiveIntensity).toBe(4); }
 binding.apply(undefined);
 for (const material of [a!, b!]) { expect(material.color.equals(model.color)).toBe(true); expect(material.emissive!.equals(model.emissive)).toBe(true); expect(material.emissiveIntensity).toBe(model.intensity); }
});

it('writes the graph value after an expression bind in the same frame, and leaves a bind alone without a value', async () => {
 const { scene, indexOf, records } = await load();
 const [a] = materialsOf(scene);
 const binding = createMaterialBinding(records, scene, indexOf);
 binding.apply({ Wall: { baseColor: '#00ff00' } });
 // An expression color bind writes its color on each update, before the binding applies.
 a!.color.set('#ff0000');
 binding.apply({ Wall: { baseColor: '#00ff00' } });
 expect(hex(a!.color)).toBe('#00ff00');
 binding.apply({});
 a!.color.set('#ff0000');
 binding.apply({});
 expect(hex(a!.color)).toBe('#ff0000');
});

it('gives each prop instance its own copy of every material, lit and unlit', async () => {
 const { scene, indexOf, records } = await load();
 const light = createEnvironmentLight({} as never, () => ({ texture: new Texture(), dispose() {} }));
 const instance = () => {
  const root = clone(scene);
  const unlit = copyUnlitMaterials(root, isLitMaterial), lit = light.apply(root);
  return { root, binding: createMaterialBinding(records, root, indexOf, new Map([...unlit.originals, ...lit.originals])) };
 };
 const one = instance(), two = instance();
 one.binding.apply({ Wall: { baseColor: '#ff0000' }, Glow: { baseColor: '#0000ff' } });
 two.binding.apply(undefined);
 const [wall1, , glow1] = materialsOf(one.root), [wall2, , glow2] = materialsOf(two.root);
 expect(glow1).toBeInstanceOf(MeshBasicMaterial);
 expect([hex(wall1!.color), hex(glow1!.color)]).toEqual(['#ff0000', '#0000ff']);
 expect([hex(wall2!.color), hex(glow2!.color)]).toEqual([records[0]!.model.baseColor, records[1]!.model.baseColor]);
 // The cached asset keeps its materials.
 expect(hex(materialsOf(scene)[2]!.color)).toBe(records[1]!.model.baseColor);
});

// A stand-in MToon material: the fields that three-vrm gives, without a VRM file.
const mtoon = () => Object.assign(new MeshBasicMaterial(), { shadeColorFactor: new Color('#102030'), outlineColorFactor: new Color('#000000'), outlineWidthFactor: 0.01, parametricRimColorFactor: new Color('#000000') });
const record = (profile: AssetMaterial['profile'], outline = false): AssetMaterial => ({ index: 0, name: 'Body', profile, blend: false, outline, model: {} });

it('writes outline parameters to the outline clone only', () => {
 const surface = mtoon(), outline = Object.assign(mtoon(), { isOutline: true });
 const root = new Group().add(new Mesh(undefined, [surface, outline]));
 const binding = createMaterialBinding([record('mtoon', true)], root, material => material === surface ? 0 : undefined);
 binding.apply({ Body: { outlineWidth: 0.04, outlineColor: '#ff0000', rimColor: '#00ff00' } });
 expect([surface.outlineWidthFactor, hex(surface.outlineColorFactor)]).toEqual([0.01, '#000000']);
 expect([outline.outlineWidthFactor, hex(outline.outlineColorFactor)]).toEqual([0.04, '#ff0000']);
 expect([hex(surface.parametricRimColorFactor), hex(outline.parametricRimColorFactor)]).toEqual(['#00ff00', '#00ff00']);
 binding.apply({});
 expect([outline.outlineWidthFactor, hex(outline.outlineColorFactor), hex(surface.parametricRimColorFactor)]).toEqual([0.01, '#000000', '#000000']);
});

it('does not write a saved parameter that does not apply to the record material', () => {
 // Opacity on an opaque or MASK material, and emission on a VRM 0 Unlit material, keep the model value.
 const masked = Object.assign(mtoon(), { alphaTest: 0.5, opacity: 1 }), unlit = Object.assign(mtoon(), { emissive: new Color('#000000'), emissiveIntensity: 1 });
 const bind = (material: Material, profile: AssetMaterial['profile']) => createMaterialBinding([record(profile)], new Group().add(new Mesh(undefined, material)), () => 0);
 const one = bind(masked, 'mtoon'), two = bind(unlit, 'unlit');
 one.apply({ Body: { opacity: 0.3, baseColor: '#ff0000' } });
 two.apply({ Body: { emissionColor: '#00ff00', emissionStrength: 5 } });
 expect([masked.opacity, hex(masked.color)]).toEqual([1, '#ff0000']);
 expect([hex(unlit.emissive), unlit.emissiveIntensity]).toEqual(['#000000', 1]);
 one.apply({});
 expect([masked.opacity, hex(masked.color)]).toEqual([1, '#ffffff']);
});

it('also writes the shade color for a VRM 0 Unlit Base Color, and only for it', () => {
 const unlit = mtoon(), lit = mtoon();
 const bind = (material: Material, profile: AssetMaterial['profile']) => createMaterialBinding([record(profile)], new Group().add(new Mesh(undefined, material)), () => 0);
 const one = bind(unlit, 'unlit'), two = bind(lit, 'mtoon');
 one.apply({ Body: { baseColor: '#ff0000' } });
 two.apply({ Body: { baseColor: '#ff0000' } });
 expect([hex(unlit.color), hex(unlit.shadeColorFactor)]).toEqual(['#ff0000', '#ff0000']);
 expect([hex(lit.color), hex(lit.shadeColorFactor)]).toEqual(['#ff0000', '#102030']);
 one.apply({});
 expect([hex(unlit.color), hex(unlit.shadeColorFactor)]).toEqual(['#ffffff', '#102030']);
});
