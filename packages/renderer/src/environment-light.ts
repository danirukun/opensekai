import { PMREMGenerator, type Material, type Object3D, type Texture, type WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export interface EnvironmentMap { texture: Texture; dispose(): void }
export interface EnvironmentLight { apply(root: Object3D): () => void; dispose(): void }
// Lights only environment materials; scene.environment stays null so avatar materials keep their look.
// The instance gets its own material clones because the cached asset shares materials with other instances.
// The returned function disposes those clones only. Textures stay with the asset cache and the map stays with this light.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    return {
        apply(root) {
            map ??= makeMap();
            const texture = map.texture;
            const clones: Material[] = [];
            const light = (material: Material) => {
                if (!('envMap' in material)) return material;
                const copy = material.clone() as Material & { envMap: Texture | null };
                copy.envMap = texture;
                clones.push(copy);
                return copy;
            };
            root.traverse(object => {
                const holder = object as { material?: Material | Material[] };
                if (Array.isArray(holder.material)) holder.material = holder.material.map(light);
                else if (holder.material) holder.material = light(holder.material);
            });
            return () => { for (const copy of clones.splice(0)) copy.dispose(); };
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
