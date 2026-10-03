import { expect, it } from "vitest";
import { makeSmokeScene } from "@opensekai/contracts";
import { createSession } from "../src/session";
it("keeps a failed multi-edit atomic and rejects stale edits", () => {
    const s = createSession(makeSmokeScene(), "test");
    const before = s.inspect();
    expect(s.applyPatch({ sceneId: before.sceneId, expectedRevision: 0, operations: [{ kind: "setVisibility", entityId: "marker", visible: false }, { kind: "setVisibility", entityId: "missing", visible: false }] })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(s.inspect()).toEqual(before);
    expect(s.applyPatch({ sceneId: before.sceneId, expectedRevision: 1, operations: [{ kind: "setVisibility", entityId: "marker", visible: false }] })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
});
it("commits once and isolates input, patch, inspection and frames", () => {
    const scene = makeSmokeScene();
    const s = createSession(scene, "test");
    scene.entities[0]!.visible = false;
    const transform = structuredClone(s.inspect().entities[0]!.transform);
    transform.position[0] = 3;
    expect(s.applyPatch({ sceneId: scene.sceneId, expectedRevision: 0, operations: [{ kind: "setTransform", entityId: "marker", transform }, { kind: "setVisibility", entityId: "performer", visible: false }] })).toEqual({ ok: true, data: { revision: 1 } });
    transform.position[0] = 99;
    const inspection = s.inspect();
    inspection.entities[0]!.transform.position[0] = 99;
    const frame = s.advance(0);
    frame.scene.entities[0]!.transform.position[0] = 99;
    expect(s.inspect().entities[0]!.transform.position[0]).toBe(3);
});
it("rejects duplicate IDs and invalid transforms", () => {
    const scene = makeSmokeScene();
    scene.entities.push(structuredClone(scene.entities[0]!));
    expect(() => createSession(scene, "test")).toThrow();
    const s = createSession(makeSmokeScene(), "test");
    for (const value of [NaN, 0]) {
        const transform = structuredClone(s.inspect().entities[0]!.transform);
        transform.scale[0] = value;
        expect(s.applyPatch({ sceneId: "scene_smoke", expectedRevision: 0, operations: [{ kind: "setTransform", entityId: "marker", transform }] })).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    }
    expect(s.inspect().revision).toBe(0);
});
it("validates camera targets, output and revision", () => {
    const s = createSession(makeSmokeScene(), "test");
    for (const cameraId of ["missing", "marker"])
        expect(s.selectCamera({ outputId: "output_main", cameraId, expectedRevision: 0 }).ok).toBe(false);
    expect(s.selectCamera({ outputId: "missing", cameraId: "camera_close", expectedRevision: 0 })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(s.selectCamera({ outputId: "output_main", cameraId: "camera_close", expectedRevision: 0 })).toEqual({ ok: true, data: { revision: 1 } });
    expect(s.selectCamera({ outputId: "output_main", cameraId: "camera_wide", expectedRevision: 0 })).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(s.inspect().outputs[0]!.cameraId).toBe("camera_close");
});
