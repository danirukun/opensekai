import { expect, it } from 'vitest';
import { Bone, BufferGeometry, DetachedBindMode, Float32BufferAttribute, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { collectSkinned, createSnowBuildUp } from '../src/snow-build-up';
import { createSnowSky } from '../src/snow-sky';

const skeleton = (bones: number) => new Skeleton(Array.from({ length: bones }, () => new Bone()));
/** Vertex k is at (k + 1, 0, 0) with the normal (0, 1, 0), and all of its weight is on bone `bone`. */
const skinned = (vertices: number, skeleton: Skeleton, bindOffsetX = 0, bone = 0) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(Array.from({ length: vertices }, (_, k) => [k + 1, 0, 0]).flat(), 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(Array.from({ length: vertices }, () => [0, 1, 0]).flat(), 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(Array.from({ length: vertices }, () => [bone, bone, bone, bone]).flat(), 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({ length: vertices }, () => [1, 0, 0, 0]).flat(), 4));
    const mesh = new SkinnedMesh(geometry);
    mesh.bind(skeleton, new Matrix4().makeTranslation(bindOffsetX, 0, 0));
    return mesh;
};
const avatar = () => {
    const s1 = skeleton(2), s2 = skeleton(3);
    const meshA = skinned(3, s1, 2), meshB = skinned(2, s1), meshC = skinned(4, s2, 0, 1);
    const root = new Object3D();
    root.add(meshA, meshB);
    meshB.add(meshC);
    return { root, meshA, meshB, meshC };
};
const uniforms = () => ({ rate: uniform(1), buildUpSeconds: uniform(60), meltSeconds: uniform(30), thickness: uniform(0.015) });

it('joins the skinned meshes of a root with vertex and bone offsets', () => {
    const data = collectSkinned(avatar().root);
    expect(data.count).toBe(9); expect(data.bones).toBe(5);
    expect([...data.offsets.values()]).toEqual([0, 3, 5]);
    expect(data.skeletons.map(entry => entry.offset)).toEqual([0, 2]);
    expect([...data.skinIndex.slice(5 * 4, 5 * 4 + 4)]).toEqual([3, 3, 3, 3]);
});
it('bakes the bind matrix into the position and keeps the normal a unit vector', () => {
    const data = collectSkinned(avatar().root);
    expect([...data.position.slice(0, 4)]).toEqual([3, 0, 0, 1]);
    expect([...data.normal.slice(0, 4)]).toEqual([0, 1, 0, 0]);
});
it('skips a mesh without a skin and a mesh with a detached bind mode', () => {
    const root = new Object3D(), detached = skinned(3, skeleton(2));
    detached.bindMode = DetachedBindMode;
    root.add(new Mesh(skinned(2, skeleton(1)).geometry), detached);
    expect(collectSkinned(root).count).toBe(0);
    expect(createSnowBuildUp(root, createSnowSky(64), uniforms())).toBeNull();
});
it('gives each collected mesh its vertex offset and a state of 4 floats for each vertex', () => {
    const { root, meshA, meshB, meshC } = avatar();
    const buildUp = createSnowBuildUp(root, createSnowSky(64), uniforms())!;
    expect([meshA, meshB, meshC].map(mesh => mesh.userData.snowOffset)).toEqual([0, 3, 5]);
    expect(buildUp.count).toBe(9); expect(buildUp.state.array.length).toBe(36);
    buildUp.dispose();
    expect(meshA.userData.snowOffset).toBeUndefined();
});
