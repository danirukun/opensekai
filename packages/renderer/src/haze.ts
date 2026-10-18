import { BoxGeometry, Data3DTexture, DepthTexture, LinearFilter, Mesh, RedFormat, RepeatWrapping, VolumeNodeMaterial, type Node, type Texture } from "three/webgpu";
import { Fn, float, max, screenCoordinate, screenUV, texture, texture3D, uniform, vec3, vec4, type ShaderNodeObject } from "three/tsl";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import type { HazeSettings, SceneEntity } from "@opensekai/contracts";

/** The layer of the haze volume. The main scene pass and the shadow passes do not draw it (B13 R7). */
export const HAZE_LAYER = 10;
export const HAZE_STEPS = 12;
/** The haze pass resolution as a part of the output resolution, and its blur strength (B13 R8). */
export const HAZE_RESOLUTION = 0.25;
export const HAZE_BLUR = 0.6;

type HazeEntity = Extract<SceneEntity, { kind: "haze" }>;
type AnyNode = ShaderNodeObject<Node>;

/** A tiling 128³ Perlin noise volume, as in the three.js r180 webgpu_volume_lighting example. */
export function noiseVolume(size = 128): Data3DTexture {
    const data = new Uint8Array(size * size * size);
    const perlin = new ImprovedNoise(), repeat = 5, scale = 10;
    let i = 0;
    for (let z = 0; z < size; z++)
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++)
                data[i++] = 128 + 128 * perlin.noise((x / size) * repeat * scale, (y / size) * repeat * scale, (z / size) * repeat * scale);
    const volume = new Data3DTexture(data, size, size, size);
    volume.format = RedFormat;
    volume.minFilter = LinearFilter;
    volume.magFilter = LinearFilter;
    volume.wrapS = volume.wrapT = RepeatWrapping;
    volume.unpackAlignment = 1;
    volume.needsUpdate = true;
    return volume;
}

/**
 * Premultiplied-alpha composite of the scene and the blurred haze (B13 R8): the haze adds light, and its brightest
 * channel becomes coverage, so a beam over a transparent background stays a valid premultiplied pixel in OBS.
 */
export const hazeComposite = (scene: AnyNode, haze: AnyNode, intensity: AnyNode) => {
    const beam = haze.rgb.mul(intensity);
    const coverage = max(beam.r, max(beam.g, beam.b)).saturate();
    return vec4(scene.rgb.add(beam), scene.a.add(scene.a.oneMinus().mul(coverage)));
};

// three.js r180 VolumetricLightingModel multiplies each light by its shadow node, which a light without a shadow lacks, so such
// a light scatters nothing. The model class is internal; take it from a material and skip the factor when there is no shadow.
type LightingModel = { scatteringLight(light: unknown, builder: unknown): void };
type DirectInput = { lightNode: { light: { distance?: number }; shadowNode?: unknown }; lightColor: AnyNode };
const VolumetricLightingModel = new VolumeNodeMaterial().setupLightingModel().constructor as new () => LightingModel;
class HazeLightingModel extends VolumetricLightingModel {
    direct({ lightNode, lightColor }: DirectInput, builder: unknown) {
        if (lightNode.light.distance === undefined) return;
        const light = lightColor.xyz.toVar();
        if (lightNode.shadowNode) light.mulAssign(lightNode.shadowNode as AnyNode);
        this.scatteringLight(light, builder);
    }
}
class HazeMaterial extends VolumeNodeMaterial {
    setupLightingModel() { return new HazeLightingModel() as unknown as ReturnType<VolumeNodeMaterial["setupLightingModel"]>; }
}

export interface Haze {
    readonly mesh: Mesh;
    readonly intensity: ReturnType<typeof uniform>;
    /** Places the volume and sets its uniforms; no recompile (B13 R7). */
    update(entity: HazeEntity, elapsedSeconds: number): void;
    /** The scene depth that hides haze behind objects: the scene pass depth, or the screenshot depth. */
    setDepth(depth: Texture): void;
    setLights(lightsNode: unknown): void;
    dispose(): void;
}

export function createHaze(): Haze {
    const noise = noiseVolume();
    const density = uniform(1), smoke = uniform(1), drift = uniform(0.2), elapsed = uniform(0), intensity = uniform(1);
    // One node with its UV: `.sample()` would clone the node, and a later `value` change would miss the clone.
    const depth = texture(new DepthTexture(1, 1), screenUV);
    const material = new HazeMaterial();
    material.steps = HAZE_STEPS;
    material.offsetNode = bayer16(screenCoordinate);
    material.depthNode = depth;
    material.scatteringNode = Fn(({ positionRay }: { positionRay: AnyNode }) => {
        const flow = vec3(elapsed, 0, elapsed.mul(0.3)).mul(drift);
        const grain = (scale: number, speed = 1) => texture3D(noise, positionRay.add(flow.mul(speed)).mul(scale).mod(1), 0).r.add(0.5);
        const sample = grain(0.1).mul(grain(0.05, 1)).mul(grain(0.02, 2));
        return smoke.mix(float(1), sample).mul(density);
    }) as unknown as VolumeNodeMaterial["scatteringNode"];
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
    mesh.receiveShadow = true;
    mesh.layers.disableAll();
    mesh.layers.enable(HAZE_LAYER);
    mesh.name = "haze";
    return {
        mesh,
        intensity,
        update(entity, elapsedSeconds) {
            const { transform, haze } = entity as { transform: HazeEntity["transform"]; haze: HazeSettings };
            mesh.position.fromArray(transform.position);
            mesh.quaternion.fromArray(transform.rotation);
            mesh.scale.fromArray(transform.scale);
            mesh.updateMatrixWorld(true);
            mesh.visible = entity.visible;
            density.value = haze.density;
            smoke.value = haze.smoke;
            drift.value = haze.drift;
            intensity.value = haze.intensity;
            elapsed.value = elapsedSeconds;
        },
        setDepth(next) { depth.value = next; },
        setLights(lightsNode) {
            const holder = material as unknown as { lightsNode: unknown };
            if (holder.lightsNode === lightsNode) return;
            holder.lightsNode = lightsNode;
            material.needsUpdate = true;
        },
        dispose() {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            material.dispose();
            noise.dispose();
        },
    };
}
