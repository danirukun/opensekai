import { Layers, PostProcessing, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { pass, renderOutput, uniform } from "three/tsl";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { gradingChainKey, isNeutralGrading, type CameraAntiAliasing, type CameraGrading } from "@opensekai/contracts";
import { bloomComposite, createGrading } from "./grading";
import { HAZE_BLUR, HAZE_LAYER, HAZE_RESOLUTION, hazeComposite, type Haze } from "./haze";
import { BEAM_RESOLUTION, beamLayers, type Beams } from "./beam";

/** A chain is needed for FXAA, for a visible haze, for a grading that changes a pixel, or for a beam; otherwise the renderer draws directly (B13 R8, CAM-06 R7, stage beams R13). */
export const needsChain = (mode: CameraAntiAliasing, haze: boolean, grading?: CameraGrading | null, beams = false): boolean => mode === "fxaa" || haze || !isNeutralGrading(grading) || beams;
/** The chain is built again only when this changes, or the scene or camera changes. The numbers of a grading are uniforms (CAM-06 R11). */
export const chainKey = (mode: CameraAntiAliasing, haze: boolean, grading?: CameraGrading | null, beams = false): string => `${mode}:${haze ? "haze" : "clear"}:${gradingChainKey(grading)}${beams ? ":beams" : ""}`;

export const hazeLayers = (): Layers => { const layers = new Layers(); layers.disableAll(); layers.enable(HAZE_LAYER); return layers; };

type Chain = { scene: Scene; camera: Camera; key: string; post: PostProcessing; haze: Haze | null; beams: Beams | null; depth: () => import("three/webgpu").Texture; dispose(): void };
// Draws with the output camera's anti-aliasing, the haze, and the grading: the scene pass, the haze pass at a quarter of the
// resolution, blurred and added with premultiplied alpha, the bloom, the grade, then the display transform and FXAA (B13 R8, CAM-06 R8).
export function createPostChain(renderer: WebGPURenderer) {
    let chain: Chain | null = null;
    const grade = createGrading();
    const release = () => { chain?.dispose(); chain = null; };
    const build = (scene: Scene, camera: Camera, mode: CameraAntiAliasing, haze: Haze | null, grading: CameraGrading | null, beams: Beams | null = null): Chain => {
        const post = new PostProcessing(renderer);
        const scenePass = pass(scene, camera);
        const owned: { dispose(): void }[] = [scenePass];
        let color = scenePass as unknown as Parameters<typeof hazeComposite>[0];
        if (haze) {
            const hazePass = pass(scene, camera, { depthBuffer: false, samples: 0 });
            hazePass.setLayers(hazeLayers());
            hazePass.setResolution(HAZE_RESOLUTION);
            const blurred = gaussianBlur(hazePass, uniform(HAZE_BLUR));
            color = hazeComposite(color, blurred as unknown as typeof color, haze.intensity) as unknown as typeof color;
            owned.push(hazePass, blurred);
        }
        // The beam cones at half of the resolution, after the haze and before the bloom, with the same composite (stage beams R12).
        if (beams) {
            const beamPass = pass(scene, camera, { depthBuffer: false, samples: 0 });
            beamPass.setLayers(beamLayers());
            beamPass.setResolution(BEAM_RESOLUTION);
            color = hazeComposite(color, beamPass as unknown as typeof color, uniform(1)) as unknown as typeof color;
            owned.push(beamPass);
        }
        if (grading) {
            if (grading.bloom.intensity > 0) {
                const glow = grade.bloom(color);
                color = bloomComposite(color, glow) as unknown as typeof color;
                owned.push(glow);
            }
            color = grade.grade(color, grading.toneMapping) as unknown as typeof color;
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
        return { scene, camera, key: chainKey(mode, haze !== null, grading, beams !== null), post, haze, beams, depth: () => scenePass.getTexture("depth"), dispose() { post.dispose(); for (const node of owned) node.dispose(); } };
    };
    return {
        async render(scene: Scene, camera: Camera, mode: CameraAntiAliasing = "none", haze: Haze | null = null, grading: CameraGrading | null = null, beams: Beams | null = null) {
            if (!needsChain(mode, haze !== null, grading, beams !== null)) { release(); await renderer.renderAsync(scene, camera); return; }
            const graded = grading && !isNeutralGrading(grading) ? grading : null;
            if (!chain || chain.scene !== scene || chain.camera !== camera || chain.key !== chainKey(mode, haze !== null, graded, beams !== null) || chain.haze !== haze || chain.beams !== beams) { release(); chain = build(scene, camera, mode, haze, graded, beams); }
            if (graded) grade.update(graded);
            // The haze material hides haze behind objects with the scene pass depth (B13 R7).
            haze?.setDepth(chain.depth());
            beams?.setDepth(chain.depth());
            await chain.post.renderAsync();
        },
        dispose: release,
    };
}
