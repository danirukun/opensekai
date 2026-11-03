import { expect, it } from 'vitest';
import { Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyHiddenMeshes, meshObjects } from '../src/assets';

// One triangle, shared by each primitive. No GPU draw: the test reads the scene graph only.
const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const primitive = { attributes: { POSITION: 0 } };
const document = {
 asset: { version: '2.0' },
 buffers: [{ byteLength: positions.byteLength }],
 bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
 accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
 meshes: [{ primitives: [primitive] }, { primitives: [primitive, primitive] }],
 nodes: [
  { name: 'Body', mesh: 0 },
  { name: 'Hat', mesh: 1, children: [2] },
  { name: 'Ribbon', mesh: 0 },
  { name: 'Hair', mesh: 0 },
  { name: 'Hair', mesh: 0 },
  { name: 'Armature', children: [0, 1, 3, 4] },
 ],
 scenes: [{ nodes: [5] }],
 scene: 0,
};
// A GLB with the buffer in its BIN chunk, so the loader needs no fetch.
const glb = () => {
 const pad = (bytes: Uint8Array, fill: number) => { const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill); out.set(bytes); return out; };
 const json = pad(new TextEncoder().encode(JSON.stringify(document)), 0x20), bin = pad(new Uint8Array(positions.buffer), 0);
 const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length), view = new DataView(out.buffer);
 view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
 view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
 view.setUint32(20 + json.length, bin.length, true); view.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
 return out.buffer;
};
const load = async () => {
 const gltf = await new GLTFLoader().parseAsync(glb(), '');
 const root = new Object3D();
 root.add(gltf.scene);
 return { root, meshes: meshObjects(gltf as never) };
};
const shown = (meshes: ReadonlyMap<string, Object3D>) => {
 const names: string[] = [];
 for (const [name, object] of meshes) {
  let visible = true;
  for (let item: Object3D | null = object; item; item = item.parent) visible &&= item.visible;
  if (visible) names.push(name);
 }
 return names;
};

it('maps each mesh name to its node object, with a multi-primitive node as one group', async () => {
 const { meshes } = await load();
 expect([...meshes.keys()]).toEqual(['Body', 'Hat', 'Ribbon', 'Hair', 'Hair (2)']);
 expect(meshes.get('Hat')!.children.filter(child => child.type === 'Mesh' && child !== meshes.get('Ribbon'))).toHaveLength(2);
 expect(meshes.get('Ribbon')!.parent).toBe(meshes.get('Hat'));
 expect(shown(meshes)).toEqual(['Body', 'Hat', 'Ribbon', 'Hair', 'Hair (2)']);
});

it('hides only the named node, its children with it, and ignores unknown names', async () => {
 const { meshes } = await load();
 applyHiddenMeshes(meshes, ['Hair (2)', 'Tail']);
 expect(shown(meshes)).toEqual(['Body', 'Hat', 'Ribbon', 'Hair']);
 applyHiddenMeshes(meshes, ['Hat']);
 expect(shown(meshes)).toEqual(['Body', 'Hair', 'Hair (2)']);
 applyHiddenMeshes(meshes, []);
 expect(shown(meshes)).toEqual(['Body', 'Hat', 'Ribbon', 'Hair', 'Hair (2)']);
 applyHiddenMeshes(meshes, ['Body']);
 applyHiddenMeshes(meshes);
 expect(shown(meshes)).toHaveLength(5);
});

it('does not change the entity root, so `visible: false` still hides the whole avatar', async () => {
 const { root, meshes } = await load();
 root.visible = false;
 applyHiddenMeshes(meshes, []);
 expect(root.visible).toBe(false);
 expect(shown(meshes)).toEqual([]);
});
