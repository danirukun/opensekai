import { describe, expect, it } from "vitest";
import { AvatarLightingSchema, DEFAULT_AVATAR_LIGHTING, PatchOpSchema, SceneEntitySchema, avatarLighting, type AvatarLighting, type SceneEntity } from "../src/index";
const avatar = { id: "performer", name: "Performer", visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: "avatar", assetId: null };
const lit = (change: Partial<AvatarLighting>): AvatarLighting => ({ ...DEFAULT_AVATAR_LIGHTING, ...change });
describe("avatar lighting", () => {
    it("is optional on an avatar and checks each range", () => {
        expect(SceneEntitySchema.safeParse(avatar).success).toBe(true);
        expect(SceneEntitySchema.safeParse({ ...avatar, lighting: DEFAULT_AVATAR_LIGHTING }).success).toBe(true);
        for (const edge of [{ rimStrength: 0, rimWidth: 0, shadowStrength: 0, environmentFill: 0 }, { rimStrength: 2, rimWidth: 1, shadowStrength: 1, environmentFill: 2, rimTint: "#00ff7f" }])
            expect(AvatarLightingSchema.safeParse(lit(edge)).success, JSON.stringify(edge)).toBe(true);
        for (const bad of [{ rimStrength: 2.01 }, { rimStrength: -0.01 }, { rimWidth: -0.01 }, { rimWidth: 1.01 }, { shadowStrength: 1.01 }, { shadowStrength: -0.01 }, { environmentFill: 2.01 }, { environmentFill: -0.01 }, { rimStrength: Number.NaN }, { rimTint: "red" }, { rimTint: "#FFFFFF" }])
            expect(AvatarLightingSchema.safeParse(lit(bad)).success, JSON.stringify(bad)).toBe(false);
        const { rimTint: _rimTint, ...missing } = DEFAULT_AVATAR_LIGHTING;
        expect(AvatarLightingSchema.safeParse(missing).success).toBe(false);
        expect(AvatarLightingSchema.safeParse({ ...DEFAULT_AVATAR_LIGHTING, extra: 1 }).success).toBe(false);
    });
    it("has a patch operation that sets or removes the group", () => {
        expect(PatchOpSchema.safeParse({ kind: "setAvatarLighting", entityId: "performer", lighting: DEFAULT_AVATAR_LIGHTING }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setAvatarLighting", entityId: "performer", lighting: null }).success).toBe(true);
        expect(PatchOpSchema.safeParse({ kind: "setAvatarLighting", entityId: "performer" }).success).toBe(false);
        expect(PatchOpSchema.safeParse({ kind: "setAvatarLighting", entityId: "performer", lighting: lit({ rimStrength: 3 }) }).success).toBe(false);
    });
    it("keeps frozen defaults and gives them to an avatar without a group", () => {
        expect(DEFAULT_AVATAR_LIGHTING).toEqual({ rimStrength: 1, rimWidth: 0.5, rimTint: "#ffffff", shadowStrength: 0.6, environmentFill: 1 });
        expect(Object.isFrozen(DEFAULT_AVATAR_LIGHTING)).toBe(true);
        expect(avatarLighting(avatar as SceneEntity)).toEqual(DEFAULT_AVATAR_LIGHTING);
        const group = lit({ rimStrength: 1.5, rimTint: "#ff0000" });
        expect(avatarLighting({ ...avatar, lighting: group } as SceneEntity)).toEqual(group);
    });
});
