import { AttachedBindMode, MathUtils, SkinnedMesh, StorageBufferAttribute, Vector3, type BufferAttribute, type BufferGeometry, type InterleavedBufferAttribute, type Node, type Object3D, type Skeleton, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { Fn, add, clamp, float, instanceIndex, length, max, min, normalize, select, smoothstep, storage, uniform, vec4 } from "three/tsl";
import { SNOW } from "./snow-math";
import { skyExposureNode, type SnowSky } from "./snow-sky";

export interface SnowVertexData {
    count: number;
    /** 4 floats for each vertex: the bind matrix of the mesh × the position, and w = 1. */
    position: Float32Array;
    /** 4 floats for each vertex: the bind matrix of the mesh × the normal (w = 0), normalized. */
    normal: Float32Array;
    /** 4 indices for each vertex, each plus the bone offset of its skeleton. */
    skinIndex: Uint32Array;
    skinWeight: Float32Array;
    /** 4 floats for each vertex: the push of `snowPushData`, with w in the index space of the avatar. */
    push: Float32Array;
    /** One entry for each bone block. Skeletons with the same bones and equal bone inverses share a block; the first is its entry. */
    skeletons: { skeleton: Skeleton; offset: number }[];
    bones: number;
    offsets: Map<SkinnedMesh, number>;
}

const collected = (object: Object3D): object is SkinnedMesh => {
    if (!(object instanceof SkinnedMesh) || object.bindMode !== AttachedBindMode || !object.skeleton) return false;
    const { attributes } = object.geometry;
    return attributes.position !== undefined && attributes.normal !== undefined && attributes.skinIndex !== undefined && attributes.skinWeight !== undefined;
};

/** Exact equality: the loader copies the same bytes into each skin. */
const sameInverses = (a: Skeleton, b: Skeleton): boolean => a.boneInverses.length === b.boneInverses.length && a.boneInverses.every((inverse, i) => inverse.equals(b.boneInverses[i]!));

type Attribute = BufferAttribute | InterleavedBufferAttribute;

/**
 * Pure. Snow on lilToon R11: 4 floats for each vertex, the push direction × the hard-edge scale in geometry space (xyz) and
 * the representative vertex (w). The vertices that `index` draws group by exact position, and each vertex of a group gets
 * the same push, so the copies at a split normal or UV move together. A vertex without a copy, or one that the index does
 * not draw, keeps its own normal and itself.
 */
export function snowPushData(position: Attribute, normal: Attribute, index: Attribute | null): Float32Array {
    const { count } = position, push = new Float32Array(count * 4), drawn = new Uint8Array(count);
    if (index) for (let i = 0; i < index.count; i++) drawn[index.getX(i)] = 1;
    else drawn.fill(1);
    const groups = new Map<string, number[]>();
    for (let v = 0; v < count; v++) {
        push.set([normal.getX(v), normal.getY(v), normal.getZ(v), v], v * 4);
        if (!drawn[v]) continue;
        const key = `${position.getX(v)},${position.getY(v)},${position.getZ(v)}`, group = groups.get(key);
        if (group) group.push(v);
        else groups.set(key, [v]);
    }
    const a = new Vector3(), b = new Vector3(), sum = new Vector3();
    for (const group of groups.values()) {
        if (group.length === 1) continue;
        let least = 1, representative = group[0]!, top = -Infinity;
        sum.set(0, 0, 0);
        for (const v of group) {
            a.fromBufferAttribute(normal, v).normalize();
            sum.add(a);
            if (a.y > top) { top = a.y; representative = v; }
            for (const w of group) least = Math.min(least, a.dot(b.fromBufferAttribute(normal, w).normalize()));
        }
        // A hard edge (copies 45° or more apart) gets no push; a seam within about 25° gets all of it. Opposite normals sum to 0.
        sum.normalize().multiplyScalar(MathUtils.smoothstep(least, 0.7, 0.9));
        for (const v of group) push.set([sum.x, sum.y, sum.z, representative], v * 4);
    }
    return push;
}

/** Pure. Skips a mesh that is not a SkinnedMesh or whose bindMode is not 'attached'. */
export function collectSkinned(root: Object3D): SnowVertexData {
    const meshes: SkinnedMesh[] = [];
    root.traverse(object => { if (collected(object)) meshes.push(object); });
    // The GLTFLoader makes one Skeleton for each skin, and a VRM often has many skins with the same joints. Equal skeletons
    // give equal bone matrices, so they share one bone block: a key from the bone ids, then a compare of the inverses.
    const skeletonOffsets = new Map<Skeleton, number>(), blocks = new Map<string, { skeleton: Skeleton; offset: number }[]>();
    const skeletons: { skeleton: Skeleton; offset: number }[] = [];
    let bones = 0;
    for (const { skeleton } of meshes) {
        if (skeletonOffsets.has(skeleton)) continue;
        const key = skeleton.bones.map(bone => bone?.id ?? -1).join(","), candidates = blocks.get(key) ?? [];
        let block = candidates.find(candidate => sameInverses(candidate.skeleton, skeleton));
        if (block === undefined) {
            block = { skeleton, offset: bones };
            blocks.set(key, [...candidates, block]);
            skeletons.push(block);
            bones += skeleton.bones.length;
        }
        skeletonOffsets.set(skeleton, block.offset);
    }
    const offsets = new Map<SkinnedMesh, number>();
    let count = 0;
    for (const mesh of meshes) {
        offsets.set(mesh, count);
        count += mesh.geometry.attributes.position.count;
    }
    const position = new Float32Array(count * 4), normal = new Float32Array(count * 4);
    const skinIndex = new Uint32Array(count * 4), skinWeight = new Float32Array(count * 4), push = new Float32Array(count * 4);
    const point = new Vector3(), direction = new Vector3();
    // The GLTFLoader can give the meshes of one glTF mesh one vertex buffer; each keeps its own index, so each its own geometry.
    const pushes = new Map<BufferGeometry, Float32Array>();
    for (const mesh of meshes) {
        const { position: positions, normal: normals, skinIndex: indices, skinWeight: weights } = mesh.geometry.attributes;
        const first = offsets.get(mesh)!, boneOffset = skeletonOffsets.get(mesh.skeleton)!;
        const local = pushes.get(mesh.geometry) ?? snowPushData(positions, normals, mesh.geometry.index);
        pushes.set(mesh.geometry, local);
        for (let v = 0; v < positions.count; v++) {
            const at = (first + v) * 4;
            point.fromBufferAttribute(positions, v).applyMatrix4(mesh.bindMatrix);
            // transformDirection applies the upper 3 × 3 (w = 0) and normalizes.
            direction.fromBufferAttribute(normals, v).transformDirection(mesh.bindMatrix);
            position.set([point.x, point.y, point.z, 1], at);
            normal.set([direction.x, direction.y, direction.z, 0], at);
            // getX … getW denormalize: glTF skin indices are often 8 or 16 bits and weights can be normalized integers.
            skinIndex.set([indices.getX(v), indices.getY(v), indices.getZ(v), indices.getW(v)].map(index => index + boneOffset), at);
            skinWeight.set([weights.getX(v), weights.getY(v), weights.getZ(v), weights.getW(v)], at);
            push.set([local[v * 4]!, local[v * 4 + 1]!, local[v * 4 + 2]!, local[v * 4 + 3]! + first], at);
        }
    }
    return {
        count, position, normal, skinIndex, skinWeight, push, skeletons, bones, offsets,
    };
}

export interface SnowUniforms { rate: UniformNode<"float">; buildUpSeconds: UniformNode<"float">; meltSeconds: UniformNode<"float">; thickness: UniformNode<"float">; cover: UniformNode<"float"> }

export interface SnowBuildUp {
    /** vec4 for each vertex: the previous world position, and w = the amount. */
    readonly state: StorageBufferAttribute;
    /** vec4 for each vertex, read-only: the push of `snowPushData` in the index space of the avatar. The materials read it. */
    readonly push: StorageBufferAttribute;
    readonly count: number;
    step(renderer: WebGPURenderer, seconds: number, reset: boolean): void;
    /** Sets each amount to 0 at the next step. The step after it is a warm step. */
    clear(): void;
    /** True when the next step sets each amount from the cover (`warmAmount`): the first step, and the first step after a clear. */
    warming(): boolean;
    dispose(): void;
}

/** Sets `userData.snowOffset` on each collected mesh. Returns null when the root has no collected vertex. */
export function createSnowBuildUp(root: Object3D, sky: SnowSky, { rate, buildUpSeconds, meltSeconds, cover }: SnowUniforms): SnowBuildUp | null {
    const data = collectSkinned(root);
    const { count } = data;
    if (count === 0) return null;
    const state = new StorageBufferAttribute(count, 4), push = new StorageBufferAttribute(data.push, 4);
    const position = new StorageBufferAttribute(data.position, 4), normal = new StorageBufferAttribute(data.normal, 4);
    const skinIndex = new StorageBufferAttribute(data.skinIndex, 4), skinWeight = new StorageBufferAttribute(data.skinWeight, 4);
    const boneCount = Math.max(1, data.bones), bones = new StorageBufferAttribute(new Float32Array(boneCount * 16), 16);
    const attributes = [state, push, position, normal, skinIndex, skinWeight, bones];
    // reset, clear, and warm are 0 or 1: a bool cannot be in a uniform buffer.
    const seconds = uniform(0), reset = uniform(1), clear = uniform(0), warm = uniform(0);
    const stateNode = storage(state, "vec4", count);
    const positionNode = storage(position, "vec4", count).toReadOnly(), normalNode = storage(normal, "vec4", count).toReadOnly();
    const skinIndexNode = storage(skinIndex, "uvec4", count).toReadOnly(), skinWeightNode = storage(skinWeight, "vec4", count).toReadOnly();
    const bonesNode = storage(bones, "mat4", boneCount).toReadOnly();

    const update = Fn(() => {
        const index = skinIndexNode.element(instanceIndex).toVar(), weight = skinWeightNode.element(instanceIndex).toVar();
        // The skin matrix of getSkinnedNormalAndTangent in three.js Skinning.js. The bind matrix is in the stored position
        // and normal, and an attached mesh has bindMatrixInverse = matrixWorld⁻¹, so m gives world space.
        const m = add(
            weight.x.mul(bonesNode.element(index.x)),
            weight.y.mul(bonesNode.element(index.y)),
            weight.z.mul(bonesNode.element(index.z)),
            weight.w.mul(bonesNode.element(index.w)),
        ).toVar() as unknown as Node<"mat4">;
        const world = (m.mul(positionNode.element(instanceIndex)) as unknown as Node<"vec4">).xyz.toVar();
        const up = smoothstep(SNOW.upStart, 1, normalize((m.mul(normalNode.element(instanceIndex)) as unknown as Node<"vec4">).xyz).y).toVar();
        const exposure = skyExposureNode(sky, world);
        const previous = stateNode.element(instanceIndex).toVar(), amount = previous.w;
        // reset is 1 when seconds is 0, so the max only keeps the division finite.
        const speed = length(world.sub(previous.xyz)).div(max(seconds, 1e-6)).mul(reset.oneMinus());
        // buildUpStep of snow-math.ts, term for term.
        const grow = rate.div(buildUpSeconds).mul(up).mul(exposure);
        const melt = select(rate.equal(0), float(1).div(meltSeconds), float(0));
        const decay = select(up.equal(0), float(1 / SNOW.slideSeconds), float(0)).add(smoothstep(SNOW.shedStart, SNOW.shedFull, speed).div(SNOW.shedSeconds));
        const next = clamp(amount.add(seconds.mul(grow.sub(melt))).sub(amount.mul(min(1, seconds.mul(decay)))), 0, 1);
        // warmAmount of snow-math.ts.
        const warmed = cover.mul(up).mul(exposure);
        stateNode.element(instanceIndex).assign(vec4(world, select(clear.equal(1), float(0), select(warm.equal(1), warmed, next))));
    });
    const node = update().compute(count);

    for (const [mesh, offset] of data.offsets) mesh.userData.snowOffset = offset;
    // The state starts at 0, so the first step has no valid previous position.
    let started = false, clearPending = false, warmPending = true;
    return {
        state,
        push,
        count,
        step(renderer, stepSeconds, stepReset) {
            const resetNow = stepReset || !started;
            if (stepSeconds === 0 && !resetNow && !clearPending) return;
            for (const { skeleton, offset } of data.skeletons) {
                skeleton.update();
                // computeBoneTexture makes boneMatrices longer than 16 floats for each bone.
                bones.array.set(skeleton.boneMatrices!.subarray(0, skeleton.bones.length * 16), offset * 16);
            }
            bones.needsUpdate = true;
            seconds.value = stepSeconds;
            reset.value = resetNow || stepSeconds === 0 ? 1 : 0;
            clear.value = clearPending ? 1 : 0;
            warm.value = warmPending && !clearPending ? 1 : 0;
            renderer.compute(node);
            started = true;
            if (!clearPending) warmPending = false;
            clearPending = false;
        },
        clear() {
            clearPending = true;
            warmPending = true;
        },
        warming: () => warmPending && !clearPending,
        dispose() {
            for (const mesh of data.offsets.keys()) delete mesh.userData.snowOffset;
            node.dispose();
            for (const attribute of attributes) attribute.dispose();
        },
    };
}
