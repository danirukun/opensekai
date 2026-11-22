import { describe, it, expect } from "vitest";
import { applySky, clearSky, saveSky, restoreSky, skyNeedsTexture, type SkyTextures } from "../src/sky";
import type { CameraSky } from "@opensekai/contracts";

const mockScene = () => ({
    background: null as unknown,
    backgroundIntensity: 1,
    backgroundBlurriness: 0,
});

const emptyTextures: SkyTextures = { get: () => null };

describe("skyNeedsTexture", () => {
    it("returns null for undefined sky", () => {
        expect(skyNeedsTexture(undefined)).toBeNull();
    });
    it("returns null for kind none", () => {
        expect(skyNeedsTexture({ kind: "none" })).toBeNull();
    });
    it("returns null for color sky", () => {
        expect(skyNeedsTexture({ kind: "color", color: "#ff0000" })).toBeNull();
    });
    it("returns assetId for image sky", () => {
        expect(skyNeedsTexture({ kind: "image", assetId: "img_1" })).toBe("img_1");
    });
    it("returns assetId for hdr sky", () => {
        expect(skyNeedsTexture({ kind: "hdr", assetId: "hdr_1" })).toBe("hdr_1");
    });
    it("returns null for image sky without assetId", () => {
        expect(skyNeedsTexture({ kind: "image" })).toBeNull();
    });
});

describe("clearSky", () => {
    it("resets background to transparent defaults", () => {
        const scene = mockScene();
        scene.background = "something";
        scene.backgroundIntensity = 2;
        scene.backgroundBlurriness = 0.5;
        clearSky(scene as never);
        expect(scene.background).toBeNull();
        expect(scene.backgroundIntensity).toBe(1);
        expect(scene.backgroundBlurriness).toBe(0);
    });
});

describe("saveSky / restoreSky", () => {
    it("round-trips scene background state", () => {
        const scene = mockScene();
        scene.background = "saved_bg";
        scene.backgroundIntensity = 1.5;
        scene.backgroundBlurriness = 0.3;
        const saved = saveSky(scene as never);
        clearSky(scene as never);
        expect(scene.background).toBeNull();
        restoreSky(scene as never, saved);
        expect(scene.background).toBe("saved_bg");
        expect(scene.backgroundIntensity).toBe(1.5);
        expect(scene.backgroundBlurriness).toBe(0.3);
    });
});

describe("applySky", () => {
    it("clears for undefined sky", () => {
        const scene = mockScene();
        scene.background = "old";
        applySky(scene as never, undefined, emptyTextures);
        expect(scene.background).toBeNull();
    });

    it("clears for kind none", () => {
        const scene = mockScene();
        scene.background = "old";
        applySky(scene as never, { kind: "none" }, emptyTextures);
        expect(scene.background).toBeNull();
    });

    it("sets color background", () => {
        const scene = mockScene();
        const sky: CameraSky = { kind: "color", color: "#ff0000", intensity: 1.5 };
        applySky(scene as never, sky, emptyTextures);
        expect(scene.background).toBeTruthy();
        expect(scene.backgroundIntensity).toBe(1.5);
        expect(scene.backgroundBlurriness).toBe(0);
    });

    it("defaults intensity to 1", () => {
        const scene = mockScene();
        applySky(scene as never, { kind: "color", color: "#00ff00" }, emptyTextures);
        expect(scene.backgroundIntensity).toBe(1);
    });

    it("clears when image sky has no texture loaded", () => {
        const scene = mockScene();
        scene.background = "old";
        applySky(scene as never, { kind: "image", assetId: "missing" }, emptyTextures);
        expect(scene.background).toBeNull();
    });

    it("sets texture for image sky with loaded texture", () => {
        const scene = mockScene();
        const fakeTexture = { mapping: 0 };
        const textures: SkyTextures = { get: (id) => id === "img_1" ? fakeTexture as never : null };
        applySky(scene as never, { kind: "image", assetId: "img_1", intensity: 0.8, blurriness: 0.5 }, textures);
        expect(scene.background).toBe(fakeTexture);
        expect(scene.backgroundIntensity).toBe(0.8);
        expect(scene.backgroundBlurriness).toBe(0.5);
    });

    it("clears for image sky without assetId", () => {
        const scene = mockScene();
        applySky(scene as never, { kind: "image" }, emptyTextures);
        expect(scene.background).toBeNull();
    });
});
