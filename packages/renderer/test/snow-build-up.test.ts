import { expect, it, vi } from 'vitest';
import { Bone, BufferGeometry, DetachedBindMode, Float32BufferAttribute, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { collectSkinned, createSnowBuildUp, snowPushData } from '../src/snow-build-up';
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
const uniforms = () => ({ rate: uniform(1), buildUpSeconds: uniform(60), meltSeconds: uniform(30), thickness: uniform(0.015), cover: uniform(0) });

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
it('keeps two skeletons with the same bones and a different count of inverses apart', () => {
    const bones = [new Bone(), new Bone()], full = new Skeleton(bones), short = new Skeleton(bones);
    short.boneInverses.pop();
    const root = new Object3D();
    root.add(skinned(1, full), skinned(1, short));
    expect(collectSkinned(root).skeletons.length).toBe(2);
    const other = new Object3D();
    other.add(skinned(1, short), skinned(1, full));
    expect(collectSkinned(other).skeletons.length).toBe(2);
});


// Snow cover R7, R8: the first step and the first step after a clear are warm steps. A teleport is not.
it('takes a warm step first and after a clear, and not on a spring reset', () => {
    const buildUp = createSnowBuildUp(avatar().root, createSnowSky(64), uniforms())!;
    const renderer = { compute: vi.fn() } as never;
    expect(buildUp.warming()).toBe(true);
    buildUp.step(renderer, 1 / 60, true);
    expect(buildUp.warming()).toBe(false);
    buildUp.step(renderer, 1 / 60, true);
    expect(buildUp.warming()).toBe(false);
    buildUp.clear();
    // The step that clears writes 0. The step after it is warm.
    expect(buildUp.warming()).toBe(false);
    buildUp.step(renderer, 0, false);
    expect(buildUp.warming()).toBe(true);
    buildUp.step(renderer, 0, true);
    expect(buildUp.warming()).toBe(false);
    buildUp.dispose();
});

// Snow on lilToon R11: one push for each position.
const pushOf = (data: Float32Array, v: number) => ({ direction: [...data.slice(v * 4, v * 4 + 3)], representative: data[v * 4 + 3] });
const attribute = (rows: number[][]) => new Float32BufferAttribute(rows.flat(), 3);
const close = (actual: number[], expected: number[]) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
it('gives the copies at a hard edge no push, and a vertex without a copy its own normal and itself', () => {
    // A box corner: three copies with normals 90° apart, and one vertex elsewhere.
    const data = snowPushData(attribute([[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 0, 0]]), attribute([[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0.6, 0.8]]), null);
    for (const v of [0, 1, 2]) { close(pushOf(data, v).direction, [0, 0, 0]); expect(pushOf(data, v).representative).toBe(1); }
    close(pushOf(data, 3).direction, [0, 0.6, 0.8]); expect(pushOf(data, 3).representative).toBe(3);
});
it('gives the copies at a soft seam one summed direction at full scale and the copy that points most up', () => {
    const a = new Vector3(0, 1, 0), b = new Vector3(Math.sin(0.35), Math.cos(0.35), 0);
    const data = snowPushData(attribute([[0, 1, 0], [5, 5, 5], [0, 1, 0]]), attribute([b.toArray(), [1, 0, 0], a.toArray()]), null);
    const sum = a.clone().add(b).normalize().toArray();
    close(pushOf(data, 0).direction, sum); close(pushOf(data, 2).direction, sum);
    expect([pushOf(data, 0).representative, pushOf(data, 2).representative]).toEqual([2, 2]);
});
it('scales the push between a seam of 25° and an edge of 45°', () => {
    const at = (degrees: number) => {
        const r = degrees * Math.PI / 180;
        const data = snowPushData(attribute([[0, 0, 0], [0, 0, 0]]), attribute([[0, 1, 0], [Math.sin(r), Math.cos(r), 0]]), null);
        return Math.hypot(...pushOf(data, 0).direction);
    };
    expect(at(25)).toBeCloseTo(1, 6); expect(at(46)).toBeCloseTo(0, 6);
    expect(at(35)).toBeGreaterThan(0.1); expect(at(35)).toBeLessThan(0.9);
});
it('groups only the vertices that the index draws', () => {
    // Vertex 1 is at the position of vertex 0 with a hard edge, but this mesh does not draw it.
    const data = snowPushData(attribute([[0, 0, 0], [0, 0, 0], [1, 0, 0]]), attribute([[0, 1, 0], [1, 0, 0], [0, 1, 0]]), new Uint16BufferAttribute([0, 2, 2], 1));
    close(pushOf(data, 0).direction, [0, 1, 0]); expect(pushOf(data, 0).representative).toBe(0);
});
it('puts the representative of each vertex in the index space of the avatar', () => {
    const { root } = avatar();
    const data = collectSkinned(root);
    expect(data.push.length).toBe(data.count * 4);
    expect([3, 4, 5].map(v => data.push[v * 4 + 3])).toEqual([3, 4, 5]);
    const buildUp = createSnowBuildUp(root, createSnowSky(64), uniforms())!;
    expect(buildUp.push.array.length).toBe(36);
    buildUp.dispose();
});
