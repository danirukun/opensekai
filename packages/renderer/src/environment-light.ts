import { Color, CubeCamera, CubeRenderTarget, EnvironmentNode, HalfFloatType, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PMREMGenerator, type Material, type Node, type NodeBuilder, type Object3D, type Texture, type UniformNode, type WebGPURenderer } from 'three/webgpu';
import { uniform, vec3 } from 'three/tsl';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';
import type { Vec3 } from '@opensekai/contracts';
import { isLitMaterial, type RoomLight } from './scene-lights';
export interface EnvironmentMap { texture: Texture; dispose(): void }
type Share = { fill: UniformNode<'float'>; reflections: UniformNode<'color'> };
type Sum = Node & { addAssign(node: unknown): unknown; mul(node: unknown): unknown };
type LightingContext = { radiance: Sum; iblIrradiance: Sum; lightingModel: { clearcoatRadiance?: Sum | null } };

// three.js r187 EnvironmentNode adds the reflections of the map to `radiance` (and `clearcoatRadiance`) and its diffuse part to
// `iblIrradiance`. This one collects each part and adds it times its share of the room light (B13 R4a).
class RoomEnvironmentNode extends EnvironmentNode {
    private readonly share: Share;
    constructor(envNode: Node, share: Share) { super(envNode); this.share = share; }
    setup(builder: NodeBuilder): undefined {
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
// The node material for an environment copy, with the properties of the glTF material as three.js r187 `NodeLibrary.fromMaterial`
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
    /** Each copy, to its loaded material. */
    readonly originals: ReadonlyMap<Material, Material>;
}
export interface EnvironmentLight {
    apply(root: Object3D): InstanceMaterials;
    /** Sets the share of the room map on all environment and prop copies: its diffuse fill and its reflections (B13 R4a). */
    room(light: RoomLight): void;
    /** ENV-02: restores the room PMREM on reflective copies. */
    clearIbl(): void;
    /** ENV-02: PMREM from an equirect texture for sky IBL (cached by key). */
    iblFromEquirect(source: Texture, key: string): void;
    /** ENV-02: PMREM from ColorEnvironment for a solid sky color (cached by hex). */
    iblFromColor(hex: string): void;
    dispose(): void;
}
// A prop or environment instance gets its own copy of each lit material, because the cached asset shares materials with other
// instances and each instance gets the node set of its own light group (R6). Copies of standard or physical materials get the
// PMREM room map (prop import R4); unlit materials keep their look; scene.environment stays null so avatar materials keep their look.
export function createEnvironmentLight(renderer: WebGPURenderer, makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    const share: Share = { fill: uniform(1), reflections: uniform(new Color(1, 1, 1)) };
    const texture = () => (map ??= makeMap()).texture;
    const allReflective: (Material & { envMap: Texture | null })[] = [];
    const pmremCache = new Map<string, EnvironmentMap>();
    const applyEnvMap = (target: Texture) => { for (const material of allReflective) material.envMap = target; };
    const cachedPmrem = (key: string, build: (generator: PMREMGenerator) => { texture: Texture; dispose(): void }) => {
        let cached = pmremCache.get(key);
        if (!cached) {
            const generator = new PMREMGenerator(renderer);
            try {
                const target = build(generator);
                cached = { texture: target.texture, dispose: () => target.dispose() };
                pmremCache.set(key, cached);
            } finally { generator.dispose(); }
        }
        applyEnvMap(cached.texture);
    };
    return {
        apply(root) {
            const room = texture();
            const copies = new Map<Material, Material>();
            const reflective: (Material & { envMapIntensity: number })[] = [];
            const copy = (material: Material) => {
                if (!isLitMaterial(material)) return material;
                let made = copies.get(material);
                if (!made) {
                    if ((material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true) {
                        made = roomMaterial(material, share);
                        (made as Material & { envMap: Texture | null }).envMap = room;
                        reflective.push(made as Material & { envMapIntensity: number });
                        allReflective.push(made as Material & { envMap: Texture | null });
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
                originals: new Map([...copies].map(([material, made]) => [made, material])),
                reflections(next) {
                    if (next === intensity) return;
                    intensity = next;
                    for (const material of reflective) material.envMapIntensity = next;
                },
                dispose() {
                    for (const made of copies.values()) {
                        const idx = allReflective.indexOf(made as Material & { envMap: Texture | null });
                        if (idx !== -1) allReflective.splice(idx, 1);
                        made.dispose();
                    }
                    copies.clear(); reflective.length = 0;
                },
            };
        },
        room(light) { share.fill.value = light.fill; share.reflections.value.setRGB(...light.reflections); },
        clearIbl() { applyEnvMap(texture()); },
        iblFromEquirect(source, key) {
            cachedPmrem(`equirect:${key}`, generator => generator.fromEquirectangular(source));
        },
        iblFromColor(hex) {
            cachedPmrem(`color:${hex}`, generator => {
                const environment = new ColorEnvironment(new Color(hex));
                try { return generator.fromScene(environment); }
                finally { environment.dispose(); }
            });
        },
        dispose() {
            map?.dispose(); map = null; allReflective.length = 0;
            for (const entry of pmremCache.values()) entry.dispose();
            pmremCache.clear();
        }
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
// The nine SH coefficients of the room, from a 32 px half-float cube render (character lighting R4). The caller normalizes them.
export async function roomIrradiance(renderer: WebGPURenderer): Promise<Vec3[]> {
    // 32 px × RGBA16F is 256-byte rows, the WebGPU bytesPerRow alignment; a smaller size reads padded rows.
    const room = new RoomEnvironment(), target = new CubeRenderTarget(32, { type: HalfFloatType });
    try {
        new CubeCamera(0.1, 100, target).update(renderer, room);
        const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, target);
        return probe.sh.coefficients.map(({ x, y, z }): Vec3 => [x, y, z]);
    } finally { room.dispose(); target.dispose(); }
}
