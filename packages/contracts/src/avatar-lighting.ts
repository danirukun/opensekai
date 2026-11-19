import { z } from "zod";
import type { SceneEntity } from "./types";
// Avatar lighting: rim, shade shadows, and environment fill for MToon avatars.
const n = z.number().finite();
// The same rule as `LightColorSchema`; schema.ts imports this file, so it cannot import it back.
const LightColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export const AvatarLightingSchema = z.strictObject({
    rimStrength: n.min(0).max(2),
    rimWidth: n.min(0).max(1),
    rimTint: LightColorSchema,
    shadowStrength: n.min(0).max(1),
    environmentFill: n.min(0).max(2),
});
export type AvatarLighting = z.infer<typeof AvatarLightingSchema>;
export const DEFAULT_AVATAR_LIGHTING: AvatarLighting = Object.freeze({
    rimStrength: 1,
    rimWidth: 0.5,
    rimTint: "#ffffff",
    shadowStrength: 0.6,
    environmentFill: 1,
});
/** The group of the avatar, or the default when the avatar has none. */
export const avatarLighting = (entity: SceneEntity): AvatarLighting =>
    (entity.kind === "avatar" && entity.lighting) || DEFAULT_AVATAR_LIGHTING;
