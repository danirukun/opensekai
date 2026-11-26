import type { Data3DTexture, Node, StorageBufferAttribute, UniformNode } from "three/webgpu";
import { float, int, positionGeometry, select, smoothstep, storage, texture3D, uniform, vertexIndex } from "three/tsl";
import { noiseVolume } from "./haze";
import { SNOW } from "./snow-math";

export interface SnowShare { readonly state: StorageBufferAttribute; readonly count: number; readonly thickness: UniformNode<"float">; readonly noise: Data3DTexture }

/** A 32³ tiling noise volume; one for each renderer. */
export const createSnowNoise = (): Data3DTexture => noiseVolume(32);

/** False for an outline copy and for a material with blended transparency. */
export const snowEligible = ({ isOutline, transparent }: { isOutline?: boolean; transparent: boolean }): boolean => !isOutline && !transparent;

/** Vertex stage: the amount of this vertex, or 0 for an object without `userData.snowOffset`. */
export const snowAmount = (share: SnowShare): Node<"float"> => {
    // One material can draw several meshes of the avatar, each with its own first vertex in `state`.
    const offset = uniform(-1).onObjectUpdate(({ object }) => object?.userData.snowOffset ?? -1);
    // The clamp keeps the read in the buffer when the offset is −1. A float holds each index below 2²⁴ exactly. The last
    // index is a uniform, so avatars with different vertex counts share one program.
    const index = int(float(vertexIndex).add(offset).clamp(0, uniform(share.count - 1)));
    const state = storage(share.state, "vec4", share.count).toReadOnly();
    return select(offset.lessThan(0), float(0), state.element(index).w) as unknown as Node<"float">;
};

/** Fragment stage: the snow mask from the amount of the vertex stage and the noise at the rest position. */
export const snowMaskNode = (amount: Node<"float">, share: SnowShare): Node<"float"> => {
    // The rest position keeps the pattern fixed on the body. `.mod(1)` tiles all three axes without a wrap mode.
    const noise = texture3D(share.noise, positionGeometry.mul(6).mod(1), 0).r;
    // snowMask of snow-math.ts, term for term.
    return smoothstep(noise.sub(SNOW.maskEdge), noise.add(SNOW.maskEdge), amount.mul(1 + 2 * SNOW.maskEdge).sub(SNOW.maskEdge)) as unknown as Node<"float">;
};
