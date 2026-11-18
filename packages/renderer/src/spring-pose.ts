import {Quaternion,type Object3D} from 'three/webgpu';

// B43 R8: the posed skeleton as plain numbers, 10 for each node: position xyz, quaternion xyzw, scale xyz.
export type PoseSample = Float64Array;
const STRIDE = 10;

export function capturePose(nodes: readonly Object3D[]): PoseSample {
    const sample = new Float64Array(nodes.length * STRIDE);
    nodes.forEach((node, index) => { node.position.toArray(sample, index * STRIDE); node.quaternion.toArray(sample, index * STRIDE + 3); node.scale.toArray(sample, index * STRIDE + 7); });
    return sample;
}

const start = new Quaternion(), end = new Quaternion();
// Sets each node between two samples; fraction 1 writes `to` exactly. The caller updates the world matrices.
export function applyPose(nodes: readonly Object3D[], from: PoseSample, to: PoseSample, fraction: number): void {
    const t = Math.min(1, Math.max(0, fraction));
    const mix = (offset: number) => from[offset] * (1 - t) + to[offset] * t;
    nodes.forEach((node, index) => {
        const base = index * STRIDE;
        node.position.set(mix(base), mix(base + 1), mix(base + 2));
        if (t === 1) node.quaternion.fromArray(to, base + 3);
        else node.quaternion.slerpQuaternions(start.fromArray(from, base + 3), end.fromArray(to, base + 3), t);
        node.scale.set(mix(base + 7), mix(base + 8), mix(base + 9));
    });
}
