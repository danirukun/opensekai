import { Layers, PostProcessing, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { pass, renderOutput, uniform } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import type { CameraAntiAliasing } from "@opensekai/contracts";
import { HAZE_BLUR, HAZE_LAYER, HAZE_RESOLUTION, hazeComposite, type Haze } from "./haze";

/** A chain is needed for FXAA or for a visible haze; otherwise the renderer draws directly (B13 R8). */
export const needsChain = (mode: CameraAntiAliasing, haze: boolean): boolean => mode === "fxaa" || haze;
/** The chain is built again only when this changes, or the scene or camera changes. */
export const chainKey = (mode: CameraAntiAliasing, haze: boolean): string => `${mode}:${haze ? "haze" : "clear"}`;

export const hazeLayers = (): Layers => { const layers = new Layers(); layers.disableAll(); layers.enable(HAZE_LAYER); return layers; };

type Chain = { scene: Scene; camera: Camera; key: string; post: PostProcessing; haze: Haze | null; depth: () => import("three/webgpu").Texture; dispose(): void };
// Draws with the output camera's anti-aliasing and the haze: the scene pass, the haze pass at a quarter of the
// resolution, blurred and added with premultiplied alpha, then the display transform and FXAA (B13 R8).
export function createPostChain(renderer: WebGPURenderer) {
    let chain: Chain | null = null;
    const release = () => { chain?.dispose(); chain = null; };
    const build = (scene: Scene, camera: Camera, mode: CameraAntiAliasing, haze: Haze | null): Chain => {
        const post = new PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        const owned: { dispose(): void }[] = [scenePass];
        let color = scenePass as unknown as Parameters<typeof hazeComposite>[0];
        if (haze) {
            const hazePass = pass(scene, camera, { depthBuffer: false, samples: 0 });
            hazePass.setLayers(hazeLayers());
            hazePass.setResolution(HAZE_RESOLUTION);
            const blurred = gaussianBlur(hazePass, uniform(HAZE_BLUR));
            color = hazeComposite(color, blurred as unknown as typeof color, haze.intensity as unknown as typeof color) as unknown as typeof color;
            owned.push(hazePass, blurred);
        }
        if (mode === "fxaa") {
            // FXAA needs display-referred color, so apply the color transform before it (three.js FXAA example).
            post.outputColorTransform = false;
            const filter = fxaa(renderOutput(color));
            post.outputNode = filter;
            // PostProcessing.dispose releases only its quad material. The filter's input copy (an RTTNode, which has no dispose) owns GPU resources too.
            const input = (filter as unknown as { textureNode?: { renderTarget?: { dispose(): void }; _quadMesh?: { material?: { dispose(): void } } } }).textureNode;
            owned.push(filter, { dispose() { input?.renderTarget?.dispose(); input?._quadMesh?.material?.dispose(); } });
        } else post.outputNode = color;
        return { scene, camera, key: chainKey(mode, haze !== null), post, haze, depth: () => scenePass.getTexture("depth"), dispose() { post.dispose(); for (const node of owned) node.dispose(); } };
    };
    return {
        async render(scene: Scene, camera: Camera, mode: CameraAntiAliasing = "none", haze: Haze | null = null) {
            if (!needsChain(mode, haze !== null)) { release(); await renderer.renderAsync(scene, camera); return; }
            if (!chain || chain.scene !== scene || chain.camera !== camera || chain.key !== chainKey(mode, haze !== null) || chain.haze !== haze) { release(); chain = build(scene, camera, mode, haze); }
            // The haze material hides haze behind objects with the scene pass depth (B13 R7).
            haze?.setDepth(chain.depth());
            await chain.post.renderAsync();
        },
        dispose: release,
    };
}
