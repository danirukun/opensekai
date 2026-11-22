import { VRMExpressionMaterialColorBind, VRMExpressionTextureTransformBind, type VRM } from "@pixiv/three-vrm";
import { LilToonNodeMaterial, type LilToonNodeWarning } from "@mochiya/three-liltoon/webgpu";
import type { Mesh } from "three/webgpu";

const COLOR_PROPERTIES: Record<string, string> = { color: "_Color", emissionColor: "_EmissionColor", shadeColor: "_ShadowColor", matcapColor: "_MatCapColor", rimColor: "_RimColor", outlineColor: "_OutlineColor" };
// The warning property of the fork: the bind kind of a VRM 1 expression, the material property of a VRM 0 blend shape.
const V0_COLOR_PROPERTIES: Record<string, string> = { color: "_Color", emissionColor: "_EmissionColor", shadeColor: "_ShadeColor", rimColor: "_RimColor", outlineColor: "_OutlineColor" };

/**
 * three-vrm finds no property of a lilToon node material, so its color and texture transform binds do nothing. Each is
 * replaced by a bind that writes the lilToon property, on the surface and on its outline clone, as the outline pass of the
 * Unity material reads the same values. Returns a filter that keeps the fork warnings of the binds that are not applied.
 */
export function applyLilToonExpressionBinds(vrm: Pick<VRM, "scene" | "expressionManager">): (warning: LilToonNodeWarning) => boolean {
    const outlines = new Map<LilToonNodeMaterial, LilToonNodeMaterial>();
    vrm.scene.traverse(object => {
        const [surface, outline] = [(object as Mesh).material].flat();
        if (surface instanceof LilToonNodeMaterial && outline instanceof LilToonNodeMaterial && outline.isOutline) outlines.set(surface, outline);
    });
    const applied = new Set<string>();
    for (const expression of vrm.expressionManager?.expressions ?? [])
        for (const bind of [...expression.binds]) {
            const isColor = bind instanceof VRMExpressionMaterialColorBind;
            if (!(isColor || bind instanceof VRMExpressionTextureTransformBind) || !(bind.material instanceof LilToonNodeMaterial)) continue;
            const property = isColor ? COLOR_PROPERTIES[bind.type] : "_MainTex_ST";
            if (!property) continue;
            const surface = bind.material;
            const targets = [surface, outlines.get(surface)].flatMap(material => {
                const original = material?.getProperty(property);
                return material && Array.isArray(original) ? [{ material, original }] : [];
            });
            const target = isColor ? [bind.targetValue.r, bind.targetValue.g, bind.targetValue.b, bind.targetAlpha] : [bind.scale.x, bind.scale.y, bind.offset.x, bind.offset.y];
            const channels = isColor && bind.type !== "color" ? 3 : 4;
            const write = (next: (current: number, original: number, i: number) => number) => {
                for (const { material, original } of targets) {
                    const current = material.getProperty(property) as number[];
                    material.setProperty(property, current.map((value, i) => i < channels ? next(value, original[i] ?? 0, i) : value));
                }
            };
            expression.deleteBind(bind);
            expression.addBind({
                applyWeight: weight => write((current, original, i) => current + weight * (target[i]! - original)),
                clearAppliedWeight: () => write((_, original) => original),
            });
            const name = surface.name;
            applied.add(`${name}|${isColor ? "materialColorBinds" : "textureTransformBinds"}`);
            applied.add(`${name}|${isColor ? V0_COLOR_PROPERTIES[bind.type] : "_MainTex_ST"}`);
        }
    return warning => !(warning.message.includes("does not apply expression material binds") && applied.has(`${warning.materialName}|${warning.property}`));
}
