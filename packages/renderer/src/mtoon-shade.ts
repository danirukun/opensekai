import type { Material, Object3D, Texture } from "three/webgpu";
import type { Mesh } from "three/webgpu";

type ShadeSurface = Material & {
    isMToonNodeMaterial?: boolean;
    isMToonMaterial?: boolean;
    map?: Texture | null;
    shadeMultiplyTexture?: Texture | null;
};

const isMToon = (material: ShadeSurface) => material.isMToonNodeMaterial === true || material.isMToonMaterial === true;

/** UniVRM VRM 0 → 1 migration: when a lit map exists and shade has no map, use the lit map as the shade multiply. */
export function applyMissingShadeMultiply(root: Object3D): number {
    let fixed = 0;
    root.traverse(object => {
        const mesh = object as Mesh;
        const value = mesh.material;
        for (const material of (Array.isArray(value) ? value : value ? [value] : []) as ShadeSurface[]) {
            if (!isMToon(material) || !material.map || material.shadeMultiplyTexture) continue;
            material.shadeMultiplyTexture = material.map;
            fixed++;
        }
    });
    return fixed;
}
