import scene from "../../../fixtures/protocol/valid-scene.json";
import frame from "../../../fixtures/protocol/valid-frame.json";
import { SceneViewSchema } from "./schema";
import type { SceneView, RuntimeFrame } from "./types";
export const smokeSceneJson = scene;
// SceneViewSchema.parse migrates each camera's legacy `{fovDegrees,near,far}` lens to the full physical shape (D12),
// so every caller gets a real CameraLens even though the fixture JSON still stores the legacy triple.
export function makeSmokeScene(): SceneView { return structuredClone(SceneViewSchema.parse(scene)) as SceneView; }
export function makeSmokeFrame(overrides: Partial<Pick<RuntimeFrame, "sequence" | "tick">>): RuntimeFrame { return {
    ...structuredClone(frame),
    ...overrides
} as RuntimeFrame; }
