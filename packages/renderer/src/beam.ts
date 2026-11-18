import { AdditiveBlending, Color, ConeGeometry, DepthTexture, DoubleSide, Group, Layers, Mesh, NodeMaterial, type BufferGeometry, type Node, type Texture } from "three/webgpu";
import { cameraFar, cameraNear, float, perspectiveDepthToViewZ, positionLocal, positionView, screenUV, texture, transformNormalToView, userData, vec3, vec4 } from "three/tsl";
import { LIMITS, type SceneEntity } from "@opensekai/contracts";
import { BEAM_APEX_RADIUS, BEAM_BASE, BEAM_DEPTH_FADE, BEAM_NEAR_FADE, BEAM_RESOLUTION, beamDraws, beamGain, beamShape } from "./beam-math";

export { BEAM_RESOLUTION };
/** The layer of the beam cones. The scene pass, the haze pass, and the shadow passes do not draw it (stage beams R10). */
export const BEAM_LAYER = 11;
export const beamLayers = (): Layers => { const layers = new Layers(); layers.disableAll(); layers.enable(BEAM_LAYER); return layers; };

export interface Beams {
    readonly root: Group;
    /** Places one cone for each beam that draws, in entity order, and hides the others. True when at least one beam draws. */
    update(entities: readonly SceneEntity[]): boolean;
    /** The scene depth that hides a beam behind objects: the scene pass depth, or the screenshot depth. */
    setDepth(depth: Texture): void;
    dispose(): void;
}

/** An open cone with its apex at the origin and its base circle of radius 1 at z = −1. */
export function beamGeometry(): BufferGeometry {
    const geometry = new ConeGeometry(1, 1, 48, 1, true);
    geometry.translate(0, -0.5, 0);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

// The product of stage beams R9, with the constants of beam-math.ts. The color and the softness are per-object values, so
// one material and one pipeline serve each beam, and a value change or a count change does not recompile (R11).
function beamMaterial(depth: ReturnType<typeof texture>): NodeMaterial {
    const color = userData("beamColor", "color") as unknown as Node<"vec3">;
    const softness = userData("beamSoftness", "float") as unknown as Node<"float">;
    const axis = float(1).sub(positionLocal.z.negate().saturate()).pow(2);
    const toCamera = positionView.negate().normalize();
    // The exact cone normal from the local position (`beamConeNormal`, R9a). The vertex normal makes bands.
    const radial = positionLocal.xy.length().max(BEAM_APEX_RADIUS);
    const coneNormal = transformNormalToView(vec3(positionLocal.x, positionLocal.y, radial)).normalize();
    const edge = coneNormal.dot(toCamera).abs().pow(softness.mul(3.75).add(0.25));
    const distance = positionView.length();
    const near = distance.div(BEAM_NEAR_FADE).saturate();
    const sceneZ = perspectiveDepthToViewZ((depth as unknown as Node<"vec4">).x, cameraNear, cameraFar);
    // The view-Z gap to the scene surface, scaled to a distance along the view ray.
    const gap = positionView.z.sub(sceneZ).mul(distance.div(positionView.z.negate()));
    const behind = gap.div(BEAM_DEPTH_FADE).saturate();
    const material = new NodeMaterial();
    material.fragmentNode = vec4(color.mul(axis.mul(edge).mul(near).mul(behind).mul(BEAM_BASE)), 1);
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.side = DoubleSide;
    material.depthTest = false;
    material.depthWrite = false;
    material.name = "beam";
    return material;
}

export function createBeams(): Beams {
    // One node with its UV: `.sample()` would clone the node, and a later `value` change would miss the clone (as haze.ts).
    const depth = texture(new DepthTexture(1, 1), screenUV);
    const geometry = beamGeometry();
    const material = beamMaterial(depth);
    const root = new Group();
    root.name = "beams";
    // The pool grows to the drawn count, up to LIMITS.lights, and does not shrink before dispose (light limits R12).
    const meshes: Mesh[] = [];
    const addMesh = () => {
        const mesh = new Mesh(geometry, material);
        mesh.name = `beam-${meshes.length}`;
        mesh.layers.disableAll();
        mesh.layers.enable(BEAM_LAYER);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.visible = false;
        mesh.userData.beamColor = new Color(0, 0, 0);
        mesh.userData.beamSoftness = 0.5;
        root.add(mesh);
        meshes.push(mesh);
    };
    return {
        root,
        update(entities) {
            const lights = entities.filter(beamDraws).slice(0, LIMITS.lights);
            while (meshes.length < lights.length) addMesh();
            meshes.forEach((mesh, i) => {
                const entity = lights[i];
                mesh.visible = entity?.kind === "light";
                if (entity?.kind !== "light") return;
                const { length, radius } = beamShape(entity.light);
                mesh.position.fromArray(entity.transform.position);
                mesh.quaternion.fromArray(entity.transform.rotation);
                mesh.scale.set(radius, radius, length);
                (mesh.userData.beamColor as Color).set(entity.light.color).multiplyScalar(beamGain(entity.light));
                mesh.userData.beamSoftness = entity.light.beam!.softness;
                mesh.updateMatrixWorld(true);
            });
            return lights.length > 0;
        },
        setDepth(next) { depth.value = next; },
        dispose() {
            root.removeFromParent();
            geometry.dispose();
            material.dispose();
        },
    };
}
