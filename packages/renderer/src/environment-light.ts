import { PMREMGenerator, type Material, type Object3D, type Texture, type WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export interface EnvironmentMap { texture: Texture; dispose(): void }
export interface EnvironmentLight { apply(root: Object3D): () => void; dispose(): void }
// Lights only lit (standard or physical) environment materials; unlit materials keep their look; scene.environment stays null so avatar materials keep their look.
// The instance gets its own material clones because the cached asset shares materials with other instances.
// The returned function disposes those clones only. Textures stay with the asset cache and the map stays with this light.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    return {
        apply(root) {
            map ??= makeMap();
            const texture = map.texture;
            const copies = new Map<Material, Material>();
            const light = (material: Material) => {
                if ((material as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial !== true) return material;
                let copy = copies.get(material);
                if (!copy) {
                    copy = material.clone();
                    (copy as Material & { envMap: Texture | null }).envMap = texture;
                    copies.set(material, copy);
                }
                return copy;
            };
            root.traverse(object => {
                const holder = object as { material?: Material | Material[] };
                if (Array.isArray(holder.material)) holder.material = holder.material.map(light);
                else if (holder.material) holder.material = light(holder.material);
            });
            return () => { for (const copy of copies.values()) copy.dispose(); copies.clear(); };
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
