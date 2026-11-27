import { Color, DoubleSide, HalfFloatType, LinearFilter, Matrix4, MeshBasicNodeMaterial, NoBlending, OrthographicCamera, RenderTarget, type Node, type Object3D, type Scene, type Texture, type UniformNode, type WebGPURenderer } from "three/webgpu";
import { positionWorld, smoothstep, step, texture, uniform, vec4 } from "three/tsl";
import type { SceneEntity } from "@opensekai/contracts";
import { SNOW, SNOW_SKY_SIZE, boxYaw, skyMatrix } from "./snow-math";

/** The layer of the objects that hold snow and keep it off what is under them. Only the sky pass camera draws this layer alone. */
export const SNOW_SKY_LAYER = 13;

export type SnowEntity = Extract<SceneEntity, { kind: "snow" }>;

export interface SnowSky {
    /** R: the height above the box bottom of the first surface under the sky, in metres. 0 where nothing is. */
    readonly height: Texture;
    readonly matrix: UniformNode<"mat4">;
    readonly camera: OrthographicCamera;
    /** The id of the material of the pass, as in the label of its pipeline. */
    readonly materialId: number;
    /** Places the camera and sets the matrix. No recompile. */
    update(entity: SnowEntity): void;
    /** Enables SNOW_SKY_LAYER on each object under each root, one time for each root. */
    markCasters(roots: readonly Object3D[]): void;
    render(renderer: WebGPURenderer, scene: Scene): Promise<void>;
    dispose(): void;
}

/**
 * The top-down height pass of the three.js webgpu_compute_particles_snow example (its `collisionCamera` and
 * `collisionPosRT`). The camera frames the snow box so that a render-target lookup agrees with `skyMatrix`.
 */
export function createSnowSky(size = SNOW_SKY_SIZE): SnowSky {
    const target = new RenderTarget(size, size, { type: HalfFloatType, depthBuffer: true });
    target.texture.minFilter = LinearFilter;
    target.texture.magFilter = LinearFilter;
    target.texture.generateMipmaps = false;
    const matrix = uniform(new Matrix4());
    const camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    camera.layers.set(SNOW_SKY_LAYER);
    // Unlit and without lights, fog, blending, or tone mapping, so R keeps the height and the pass starts no shadow update.
    const material = new MeshBasicNodeMaterial();
    material.colorNode = vec4((matrix.mul(vec4(positionWorld, 1)) as unknown as Node<"vec4">).z, 0, 0, 1);
    material.lights = false;
    material.fog = false;
    material.toneMapped = false;
    material.blending = NoBlending;
    material.side = DoubleSide;
    material.name = "snow-sky";
    const marked = new WeakSet<Object3D>();
    const clearColor = new Color();
    return {
        height: target.texture,
        matrix,
        camera,
        materialId: material.id,
        update({ transform: { position, rotation, scale } }) {
            const [x, y, z] = position, [sx, sy, sz] = scale, yaw = boxYaw(rotation);
            camera.left = -sx / 2; camera.right = sx / 2; camera.top = sz / 2; camera.bottom = -sz / 2;
            camera.near = 0; camera.far = sy;
            camera.updateProjectionMatrix();
            camera.position.set(x, y + sy / 2, z);
            // The box −Z axis is the camera up, so the camera right is the box +X axis.
            camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
            camera.lookAt(x, y - sy / 2, z);
            camera.updateMatrixWorld(true);
            matrix.value.fromArray(skyMatrix(position, yaw, scale));
        },
        markCasters(roots) {
            for (const root of roots) {
                if (marked.has(root)) continue;
                marked.add(root);
                root.traverse(object => object.layers.enable(SNOW_SKY_LAYER));
            }
        },
        async render(renderer, scene) {
            const previousTarget = renderer.getRenderTarget(), previousOverride = scene.overrideMaterial, previousBackground = scene.background;
            const previousAutoClear = renderer.autoClear, previousAlpha = renderer.getClearAlpha();
            renderer.getClearColor(clearColor);
            try {
                // A scene background would clear to its colour or draw its sky mesh into the height.
                scene.background = null;
                scene.overrideMaterial = material;
                renderer.autoClear = true;
                renderer.setClearColor(0x000000, 0);
                renderer.setRenderTarget(target);
                await renderer.renderAsync(scene, camera);
            }
            finally {
                renderer.setRenderTarget(previousTarget);
                renderer.setClearColor(clearColor, previousAlpha);
                renderer.autoClear = previousAutoClear;
                scene.overrideMaterial = previousOverride;
                scene.background = previousBackground;
            }
        },
        dispose() {
            target.dispose();
            material.dispose();
        },
    };
}

/** TSL: x = inside the box (0 or 1) × the sky exposure of a world point. */
export const skyExposureNode = ({ height, matrix }: Pick<SnowSky, "height" | "matrix">, world: Node<"vec3">): Node<"float"> => {
    const c = matrix.mul(vec4(world, 1)) as unknown as Node<"vec4">;
    const inside = step(0, c.x).mul(step(c.x, 1)).mul(step(0, c.y)).mul(step(c.y, 1)).mul(step(0, c.z));
    // An explicit level 0: the caller can be a compute or a vertex stage, where an implicit level does not exist.
    const h = texture(height, c.xy, 0).r;
    return inside.mul(smoothstep(h.sub(SNOW.skyBand), h, c.z)) as unknown as Node<"float">;
};
