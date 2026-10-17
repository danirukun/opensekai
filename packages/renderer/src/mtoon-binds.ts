import { VRMExpressionMaterialColorBind } from "@pixiv/three-vrm";

type PropertyNameMapMap = Record<string, Record<string, [string, string | null]>>;

// three-vrm 3.5 finds the bound property by material flag and knows `isMToonMaterial` but not `isMToonNodeMaterial`.
// It skips the color binds of every WebGPU MToon material (for example a VRM 0.x `_Color` toggle). The node material
// has the same property names, so it reuses the MToon map.
export function supportNodeMaterialColorBinds(): void {
    const maps = (VRMExpressionMaterialColorBind as unknown as { _propertyNameMapMap: PropertyNameMapMap })._propertyNameMapMap;
    maps.isMToonNodeMaterial ??= maps.isMToonMaterial!;
}
