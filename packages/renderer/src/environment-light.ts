import { PMREMGenerator, type Material, type Object3D, type Texture, type WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { isLitMaterial } from './scene-lights';
export interface EnvironmentMap { texture: Texture; dispose(): void }
export interface InstanceMaterials {
    /** Sets `envMapIntensity` on the environment copies (R15). A prop instance ignores it. */
    reflections(intensity: number): void;
    /** Disposes the copies only. Textures stay with the asset cache and the map stays with the light. */
    dispose(): void;
}
export interface EnvironmentLight { apply(root: Object3D, environment: boolean): InstanceMaterials; dispose(): void }
// A prop or environment instance gets its own copy of each lit material, because the cached asset shares materials with other
// instances and each instance gets the node set of its own light group (R6). Only environment copies of standard or physical
// materials get the PMREM room map; unlit materials keep their look; scene.environment stays null so avatar materials keep their look.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    return {
        apply(root, environment) {
            const texture = environment ? (map ??= makeMap()).texture : null;
            const copies = new Map<Material, Material>();
            const reflective: (Material & { envMapIntensity: number })[] = [];
            const copy = (material: Material) => {
                if (!isLitMaterial(material)) return material;
                let made = copies.get(material);
                if (!made) {
                    made = material.clone();
                    if (texture && (material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial === true) {
                        (made as Material & { envMap: Texture | null }).envMap = texture;
                        reflective.push(made as Material & { envMapIntensity: number });
                    }
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
