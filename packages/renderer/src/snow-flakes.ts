import { Quaternion, Sprite, SpriteNodeMaterial, Vector3, type Node, type UniformNode } from "three/webgpu";
import { PI, TWO_PI, cos, float, hash, instanceIndex, mix, mod, modelViewMatrix, modelWorldMatrix, sin, smoothstep, uint, uniform, uv, vec2, vec3, vec4, vertexStage } from "three/tsl";
import { SNOW_FLAKES, boxYaw } from "./snow-math";
import { skyExposureNode, type SnowEntity, type SnowSky } from "./snow-sky";

/** The layer of the snow flakes. The scene camera draws it; the sky pass and the shadow passes do not. */
export const SNOW_LAYER = 12;

export interface SnowFlakes {
    readonly object: Sprite;
    update(entity: SnowEntity, elapsedSeconds: number): void;
    dispose(): void;
}

const up = new Vector3(0, 1, 0);

/**
 * The particle sprite of the three.js webgpu_compute_particles_snow example, with no compute: each flake position is
 * `flakePosition` of snow-math.ts, from a seed and the elapsed time. A change of a setting or of the count does not recompile.
 * `tint` is the character fill colour of the renderer (`characterShare.fill`).
 */
export function createSnowFlakes(sky: SnowSky, tint: UniformNode<"color">, count = SNOW_FLAKES): SnowFlakes {
    const time = uniform(0), size = uniform(new Vector3(1, 1, 1));
    const fallSpeed = uniform(1), flakeSize = uniform(1), flutter = uniform(0), windDirection = uniform(0), windSpeed = uniform(0);
    // Fixed offsets, so that each client gets the same seeds. The example adds Math.random() values.
    const seedX = hash(instanceIndex.mul(uint(3))), seedY = hash(instanceIndex.mul(uint(3)).add(uint(1))), seedZ = hash(instanceIndex.mul(uint(3)).add(uint(2)));
    // flakePosition, term for term. The TSL mod of a float is x − y·floor(x / y), so one mod is in [0, span) for span > 0.
    const angle = windDirection.mul(PI).div(180), sway = flutter.mul(0.15);
    const raw = vec3(
        seedX.mul(size.x).add(sin(angle).mul(windSpeed).mul(time)).add(sin(time.mul(seedY.add(0.7)).add(seedZ.mul(TWO_PI))).mul(sway)),
        seedY.mul(size.y).sub(fallSpeed.mul(seedZ.mul(0.5).add(0.75)).mul(time)),
        seedZ.mul(size.z).add(cos(angle).mul(windSpeed).mul(time)).add(cos(time.mul(seedX.add(0.5)).add(seedY.mul(TWO_PI))).mul(sway)),
    );
    const local = mod(raw, size).sub(size.mul(0.5));
    const world = modelWorldMatrix.mul(vec4(local, 1)).xyz as unknown as Node<"vec3">;
    const distance = modelViewMatrix.mul(vec4(local, 1)).xyz.length();
    const fade = mix(float(1), float(0.4), distance.sub(15).div(25).saturate());
    // Per flake, so it is a varying: the fragment stage does not compute the position again.
    const flakeOpacity = vertexStage(seedY.mul(0.55).add(0.35).mul(fade).mul(skyExposureNode(sky, world)));
    const round = smoothstep(0, 1, uv().sub(0.5).length().mul(2)).oneMinus();

    const material = new SpriteNodeMaterial();
    material.positionNode = local;
    // The sprite quad is 1 × 1 and the object scale is 1, so the scale is the diameter in metres. The perspective camera
    // makes the on-screen size (sizeAttenuation is true).
    material.scaleNode = vec2(flakeSize.mul(0.024).mul(seedX.add(0.5)));
    // NodeMaterial multiplies the rgb by the alpha one time when premultipliedAlpha is true, and the blend is One, OneMinusSrcAlpha.
    material.colorNode = tint;
    material.opacityNode = flakeOpacity.mul(round);
    material.premultipliedAlpha = true;
    material.transparent = true;
    material.depthTest = true;
    material.depthWrite = false;
    material.fog = false;
    material.name = "snow-flakes";

    const object = new Sprite(material);
    object.name = "snow-flakes";
    object.layers.set(SNOW_LAYER);
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
    object.count = count;
    object.visible = false;
    const yaw = new Quaternion();
    return {
        object,
        update({ visible, transform: { position, rotation, scale }, snow }, elapsedSeconds) {
            time.value = elapsedSeconds;
            size.value.fromArray(scale);
            fallSpeed.value = snow.fallSpeed; flakeSize.value = snow.flakeSize; flutter.value = snow.flutter;
            windDirection.value = snow.windDirection; windSpeed.value = snow.windSpeed;
            object.position.fromArray(position);
            object.quaternion.copy(yaw.setFromAxisAngle(up, boxYaw(rotation)));
            object.count = Math.round(count * snow.rate);
            object.visible = visible && snow.rate > 0;
            object.updateMatrixWorld(true);
        },
        dispose() {
            object.removeFromParent();
            // The sprite geometry is shared by each Sprite, so it stays.
            material.dispose();
        },
    };
}
