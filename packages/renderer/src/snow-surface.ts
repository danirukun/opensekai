import type { Data3DTexture, Node, StorageBufferAttribute, UniformNode } from "three/webgpu";
import { float, int, positionGeometry, select, smoothstep, storage, texture3D, uniform, vec3, vertexIndex } from "three/tsl";
import { noiseVolume } from "./haze";
import { SNOW } from "./snow-math";

export interface SnowShare { readonly state: StorageBufferAttribute; readonly push: StorageBufferAttribute; readonly count: number; readonly thickness: UniformNode<"float">; readonly noise: Data3DTexture }

/** A 32³ tiling noise volume; one for each renderer. */
export const createSnowNoise = (): Data3DTexture => noiseVolume(32);

/** The vertex push: false for a material with blended transparency. An outline copy gets it, so it follows the snow. */
export const snowPushEligible = ({ transparent }: { transparent: boolean }): boolean => !transparent;
/** The snow colour: a surface only, not an outline copy. */
export const snowColorEligible = (material: { isOutline?: boolean; transparent: boolean }): boolean => snowPushEligible(material) && !material.isOutline;

/**
 * Vertex stage, 0 for an object without `userData.snowOffset`. `amount` is the amount of this vertex, for the colour. `push`
 * moves the vertex: the push data × the thickness × the amount of the representative, so the copies at one position move by
 * one vector (Snow on lilToon R11).
 */
export const snowVertex = (share: SnowShare): { amount: Node<"float">; push: Node<"vec3"> } => {
    // One material can draw several meshes of the avatar, each with its own first vertex in `state`.
    const offset = uniform(-1).onObjectUpdate(({ object }) => object?.userData.snowOffset ?? -1);
    // The clamp keeps the read in the buffer when the offset is −1. A float holds each index below 2²⁴ exactly, the
    // representative in w too. The last index is a uniform, so avatars with different vertex counts share one program.
    const index = int(float(vertexIndex).add(offset).clamp(0, uniform(share.count - 1)));
    const state = storage(share.state, "vec4", share.count).toReadOnly();
    const data = storage(share.push, "vec4", share.count).toReadOnly().element(index);
    const none = offset.lessThan(0);
    return {
        amount: select(none, float(0), state.element(index).w) as unknown as Node<"float">,
        push: select(none, vec3(0), data.xyz.mul(share.thickness).mul(state.element(int(data.w)).w)) as unknown as Node<"vec3">,
    };
};

/** Fragment stage: the snow mask from the amount of the vertex stage and the noise at the rest position. */
export const snowMaskNode = (amount: Node<"float">, share: SnowShare): Node<"float"> => {
    // The rest position keeps the pattern fixed on the body. `.mod(1)` tiles all three axes without a wrap mode.
    const noise = texture3D(share.noise, positionGeometry.mul(3).mod(1), 0).r;
    // snowMask of snow-math.ts, term for term.
    return smoothstep(noise.sub(SNOW.maskEdge), noise.add(SNOW.maskEdge), amount.mul(1 + 2 * SNOW.maskEdge).sub(SNOW.maskEdge)) as unknown as Node<"float">;
};
