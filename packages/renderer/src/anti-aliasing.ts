import { PostProcessing, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { pass, renderOutput } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import type { CameraAntiAliasing } from "@opensekai/contracts";
type Chain = { scene: Scene; camera: Camera; post: PostProcessing; dispose(): void };
// Draws with the output camera's post-process anti-aliasing. One chain is kept and built again only when the scene or camera changes.
export function createAntiAliasing(renderer: WebGPURenderer) {
    let chain: Chain | null = null;
    const release = () => { chain?.dispose(); chain = null; };
    const build = (scene: Scene, camera: Camera): Chain => {
        const post = new PostProcessing(renderer);
        // FXAA needs display-referred color, so apply the color transform before it (three.js FXAA example).
        post.outputColorTransform = false;
        const scenePass = pass(scene, camera);
        const filter = fxaa(renderOutput(scenePass));
        post.outputNode = filter;
        // PostProcessing.dispose releases only its quad material. The pass and the filter's input copy (an RTTNode, which has no dispose) own GPU resources too.
        const input = (filter as unknown as { textureNode?: { renderTarget?: { dispose(): void }; _quadMesh?: { material?: { dispose(): void } } } }).textureNode;
        return { scene, camera, post, dispose() { post.dispose(); filter.dispose(); scenePass.dispose(); input?.renderTarget?.dispose(); input?._quadMesh?.material?.dispose(); } };
    };
    return {
        async render(scene: Scene, camera: Camera, mode: CameraAntiAliasing = "none") {
            if (mode === "none") { release(); await renderer.renderAsync(scene, camera); return; }
            if (!chain || chain.scene !== scene || chain.camera !== camera) { release(); chain = build(scene, camera); }
            await chain.post.renderAsync();
        },
        dispose: release,
    };
}
