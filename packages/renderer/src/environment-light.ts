import { Color, EnvironmentNode, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PMREMGenerator, type Material, type Node, type NodeBuilder, type Object3D, type Texture, type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isLitMaterial, type RoomLight } from './scene-lights';
export interface EnvironmentMap { texture: Texture; dispose(): void }
type Share = { fill: UniformNode<number>; reflections: UniformNode<Color> };
type Sum = Node & { addAssign(node: unknown): unknown; mul(node: unknown): unknown };
type LightingContext = { radiance: Sum; iblIrradiance: Sum; lightingModel: { clearcoatRadiance?: Sum | null } };

// three.js r180 EnvironmentNode adds the reflections of the map to `radiance` (and `clearcoatRadiance`) and its diffuse part to
// `iblIrradiance`. This one collects each part and adds it times its share of the room light (B13 R4a).
class RoomEnvironmentNode extends EnvironmentNode {
    private readonly share: Share;
    constructor(envNode: Node, share: Share) { super(envNode); this.share = share; }
    setup(builder: NodeBuilder) {
        const context = (builder as unknown as { context: LightingContext }).context, model = context.lightingModel;
        const scene = { radiance: context.radiance, irradiance: context.iblIrradiance, clearcoat: model.clearcoatRadiance };
        const room = { radiance: vec3().toVar('roomRadiance'), irradiance: vec3().toVar('roomIrradiance'), clearcoat: vec3().toVar('roomClearcoat') };
        context.radiance = room.radiance as unknown as Sum; context.iblIrradiance = room.irradiance as unknown as Sum;
        if (scene.clearcoat) model.clearcoatRadiance = room.clearcoat as unknown as Sum;
        super.setup(builder);
        context.radiance = scene.radiance; context.iblIrradiance = scene.irradiance;
        if (scene.clearcoat) model.clearcoatRadiance = scene.clearcoat;
        scene.radiance.addAssign(room.radiance.mul(this.share.reflections));
        scene.irradiance.addAssign(room.irradiance.mul(this.share.fill));
        scene.clearcoat?.addAssign(room.clearcoat.mul(this.share.reflections));
    }
}
const withShare = (environment: EnvironmentNode | null, share: Share | undefined) =>
    environment?.envNode && share ? new RoomEnvironmentNode(environment.envNode, share) : environment;
class RoomStandardMaterial extends MeshStandardNodeMaterial {
    declare roomShare?: Share;
    setupEnvironment(builder: NodeBuilder) { return withShare(super.setupEnvironment(builder), this.roomShare); }
}
class RoomPhysicalMaterial extends MeshPhysicalNodeMaterial {
    declare roomShare?: Share;
    setupEnvironment(builder: NodeBuilder) { return withShare(super.setupEnvironment(builder), this.roomShare); }
}
// The node material for an environment copy, with the properties of the glTF material as three.js r180 `NodeLibrary.fromMaterial`
// copies them. An own type keeps it apart from other standard node materials in the shader cache.
const roomMaterial = (material: Material, share: Share): Material => {
    const physical = (material as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial === true;
    const made = physical ? new RoomPhysicalMaterial() : new RoomStandardMaterial();
    const source = material.clone() as unknown as Record<string, unknown>;
    for (const key in source) (made as unknown as Record<string, unknown>)[key] = source[key];
    (made as { type: string }).type = physical ? 'RoomPhysicalMaterial' : 'RoomStandardMaterial';
    made.roomShare = share;
    return made;
};
export interface InstanceMaterials {
    /** Sets `envMapIntensity` on the copies of this instance (R15). */
    reflections(intensity: number): void;
    /** Disposes the copies only. Textures stay with the asset cache and the map stays with the light. */
    dispose(): void;
}
export interface EnvironmentLight {
    apply(root: Object3D): InstanceMaterials;
    /** Sets the share of the room map on all environment and prop copies: its diffuse fill and its reflections (B13 R4a). */
    room(light: RoomLight): void;
    dispose(): void;
}
// A prop or environment instance gets its own copy of each lit material, because the cached asset shares materials with other
// instances and each instance gets the node set of its own light group (R6). Copies of standard or physical materials get the
// PMREM room map (prop import R4); unlit materials keep their look; scene.environment stays null so avatar materials keep their look.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    const share: Share = { fill: uniform(1), reflections: uniform(new Color(1, 1, 1)) };
    return {
        apply(root) {
            const texture = (map ??= makeMap()).texture;
            const copies = new Map<Material, Material>();
            const reflective: (Material & { envMapIntensity: number })[] = [];
            const copy = (material: Material) => {
                if (!isLitMaterial(material)) return material;
                let made = copies.get(material);
                if (!made) {
                    if ((material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true) {
                        made = roomMaterial(material, share);
                        (made as Material & { envMap: Texture | null }).envMap = texture;
                        reflective.push(made as Material & { envMapIntensity: number });
                    } else made = material.clone();
                    copies.set(material, made);
                }
                return made;
            };
            root.traverse(object => {
                const holder = object as { material?: Material | Material[] };
                if (Array.isArray(holder.material)) holder.material = holder.material.map(copy);
                else if (holder.material) holder.material = copy(holder.material);
            });
            let intensity = 1;
            return {
                reflections(next) {
                    if (next === intensity) return;
                    intensity = next;
                    for (const material of reflective) material.envMapIntensity = next;
                },
                dispose() { for (const made of copies.values()) made.dispose(); copies.clear(); reflective.length = 0; },
            };
        },
        room(light) { share.fill.value = light.fill; share.reflections.value.setRGB(...light.reflections); },
        dispose() { map?.dispose(); map = null; }
    };
}
export function roomEnvironmentMap(renderer: WebGPURenderer): () => EnvironmentMap {
    return () => {
        const generator = new PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        try {
            const target = generator.fromScene(room, 0.04);
            return { texture: target.texture, dispose: () => target.dispose() };
        } finally { room.dispose(); generator.dispose(); }
    };
}
