import { PMREMGenerator, type Material, type Object3D, type Texture, type WebGPURenderer } from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
export interface EnvironmentMap { texture: Texture; dispose(): void }
export interface EnvironmentLight { apply(root: Object3D): void; dispose(): void }
// Lights only environment materials; scene.environment stays null so avatar materials keep their look.
export function createEnvironmentLight(makeMap: () => EnvironmentMap): EnvironmentLight {
    let map: EnvironmentMap | null = null;
    return {
        apply(root) {
            map ??= makeMap();
            const texture = map.texture;
            root.traverse(object => {
                const material = (object as { material?: Material | Material[] }).material;
                for (const item of Array.isArray(material) ? material : material ? [material] : [])
                    if ('envMap' in item) { (item as Material & { envMap: Texture | null }).envMap = texture; item.needsUpdate = true; }
            });
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
