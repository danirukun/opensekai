import scene from "../../../fixtures/protocol/valid-scene.json";
import frame from "../../../fixtures/protocol/valid-frame.json";
import type { SceneView, RuntimeFrame } from "./types";
export const smokeSceneJson = scene;
export function makeSmokeScene(): SceneView { return structuredClone(scene) as SceneView; }
export function makeSmokeFrame(overrides: Partial<Pick<RuntimeFrame, "sequence" | "tick">>): RuntimeFrame { return {
    ...structuredClone(frame),
    ...overrides
} as RuntimeFrame; }
