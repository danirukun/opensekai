import { Color, EquirectangularReflectionMapping, type Scene, type Texture } from 'three/webgpu';
import type { CameraSky } from '@opensekai/contracts';

export interface SkyState {
    background: Scene['background'];
    backgroundIntensity: number;
    backgroundBlurriness: number;
}

export const saveSky = (scene: Scene): SkyState => ({
    background: scene.background,
    backgroundIntensity: scene.backgroundIntensity,
    backgroundBlurriness: scene.backgroundBlurriness
});

export const restoreSky = (scene: Scene, state: SkyState): void => {
    scene.background = state.background;
    scene.backgroundIntensity = state.backgroundIntensity;
    scene.backgroundBlurriness = state.backgroundBlurriness;
};

export const clearSky = (scene: Scene): void => {
    scene.background = null;
    scene.backgroundIntensity = 1;
    scene.backgroundBlurriness = 0;
};

export interface SkyTextures {
    get(assetId: string): Texture | null;
}

export const applySky = (
    scene: Scene,
    sky: CameraSky | undefined,
    textures: SkyTextures
): void => {
    if (!sky || sky.kind === 'none') {
        clearSky(scene);
        return;
    }
    const intensity = sky.intensity ?? 1;
    if (sky.kind === 'color') {
        scene.background = new Color(sky.color);
        scene.backgroundIntensity = intensity;
        scene.backgroundBlurriness = 0;
        return;
    }
    // image or hdr
    const assetId = sky.assetId;
    if (!assetId) { clearSky(scene); return; }
    const tex = textures.get(assetId);
    if (!tex) { clearSky(scene); return; }
    tex.mapping = EquirectangularReflectionMapping;
    scene.background = tex;
    scene.backgroundIntensity = intensity;
    scene.backgroundBlurriness = sky.blurriness ?? 0;
};

export const skyNeedsTexture = (sky: CameraSky | undefined): string | null =>
    sky && (sky.kind === 'image' || sky.kind === 'hdr') && sky.assetId ? sky.assetId : null;
