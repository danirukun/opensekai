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
it('gives skeletons with the same bones and bone inverses one bone block', () => {
    const bones = [new Bone(), new Bone(), new Bone()];
    const inverses = () => bones.map((_, k) => new Matrix4().makeTranslation(k, 0, 0));
    const different = inverses();
    different[1] = new Matrix4().makeTranslation(0, 5, 0);
    const meshA = skinned(2, new Skeleton(bones, inverses()), 0, 2), meshB = skinned(3, new Skeleton(bones, inverses()), 0, 2);
    const root = new Object3D();
    root.add(meshA, meshB);
    const data = collectSkinned(root);
    expect(data.skeletons.length).toBe(1); expect(data.bones).toBe(3);
    expect([...data.skinIndex]).toEqual(Array(5 * 4).fill(2));
    const meshC = skinned(1, new Skeleton(bones, different), 0, 2);
    root.add(meshC);
    const withC = collectSkinned(root);
    expect(withC.skeletons.map(entry => entry.offset)).toEqual([0, 3]); expect(withC.bones).toBe(6);
    expect([...withC.skinIndex.slice(5 * 4)]).toEqual([5, 5, 5, 5]);
});
