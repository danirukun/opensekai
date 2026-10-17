import { expect, it } from "vitest";
import { makeSmokeScene, validateCall, requiredCapability, tagId, encodeMarker, SceneViewSchema } from "../src/index";
it("rejects nonfinite transforms and method mismatch", () => {
    const transform = makeSmokeScene().entities[0].transform;
    transform.position[0] = NaN;
    expect(validateCall("scenePatch", {
        sceneId: "scene_smoke",
        expectedRevision: 0,
        operations: [
            {
                kind: "setTransform",
                entityId: "marker",
                transform
            }
        ]
    })).toMatchObject({
        ok: false
    });
    expect(validateCall("appStatus", {
        runId: "x"
    })).toMatchObject({
        ok: false
    });
});
it("validates references atomically", () => {
    const scene = makeSmokeScene();
    scene.outputs[0].cameraId = "marker";
    expect(SceneViewSchema.safeParse(scene).success).toBe(false);
});
it("pins roles and marker bits", () => {
    expect(requiredCapability("scenePatch")).toBe("edit");
    expect(tagId("hello")).toBe(1335831723);
    const bits = encodeMarker({
        sessionTag: 0,
        sequence: 4294967295,
        tick: 0,
        revision: 0,
        cameraTag: 0
    });
    expect([
        ...bits.slice(0, 8)
    ]).toEqual([
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0
    ]);
    expect([
        ...bits.slice(40, 72)
    ]).toEqual(Array(32).fill(1));
});
import vectors from "../../../fixtures/protocol/validation-vectors.json";
import validFrame from "../../../fixtures/protocol/valid-frame.json";
import validApplied from "../../../fixtures/protocol/valid-applied.json";
import invalidRole from "../../../fixtures/protocol/invalid-role.json";
import { parseWire, RuntimeFrameSchema, FrameAppliedSchema, ConnectionDescriptorSchema } from "../src/index";
it("accepts shared frames and acknowledgements and rejects shared role", () => {
    expect(RuntimeFrameSchema.safeParse(validFrame).success).toBe(true);
    expect(FrameAppliedSchema.safeParse(validApplied).success).toBe(true);
    expect(ConnectionDescriptorSchema.safeParse(invalidRole).success).toBe(false);
});
import { AssetListSchema, AssetRecordSchema, CaptureRecordSchema } from "../src/index";
for (const vector of vectors)
    it(`shared vector ${vector.name}`, () => {
        if (vector.valid && vector.target === "scene") {
            expect(SceneViewSchema.safeParse(vector.payload).success).toBe(true);
            return;
        }
        if (vector.valid && vector.target === "applied") {
            expect(FrameAppliedSchema.safeParse(vector.payload).success).toBe(true);
            return;
        }
        if (vector.valid) {
            expect(() => parseWire(vector.payload as string)).not.toThrow();
            return;
        }
        if (vector.target === "asset")
            expect(AssetRecordSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "assetList")
            expect(AssetListSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "captureRecord")
            expect(CaptureRecordSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "scene")
            expect(SceneViewSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "call")
            expect(validateCall("method" in vector ? vector.method : undefined, vector.payload)).toMatchObject({
                ok: false,
                error: {
                    code: vector.errorCode
                }
            });
        else if (vector.target === "descriptor")
            expect(ConnectionDescriptorSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "marker")
            expect(DiagnosticMarkerSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "applied")
            expect(FrameAppliedSchema.safeParse(vector.payload).success).toBe(false);
        else if (vector.target === "captureReplyData")
            expect(CaptureReplyDataSchema.safeParse(vector.payload).success).toBe(false);
        else
            expect(() => parseWire(vector.target === "wireText" ? vector.payload as string : JSON.stringify(vector.payload))).toThrow();
    });
it("pins UTF8 hash, zero words, rollover", () => {
    expect(tagId("\u732B")).toBe(731413007);
    const zero = encodeMarker({
        sessionTag: 0,
        sequence: 0,
        tick: 0,
        revision: 0,
        cameraTag: 0
    });
    expect([
        ...zero.slice(8)
    ]).toEqual(Array(160).fill(0));
    expect(encodeMarker({
        sessionTag: 0,
        sequence: 4294967296,
        tick: 0,
        revision: 0,
        cameraTag: 0
    })).toEqual(zero);
});
import { DiagnosticMarkerSchema, CaptureReplyDataSchema } from "../src/index";
it("bounds marker words, capture dimensions and credential endpoints", () => {
    expect(DiagnosticMarkerSchema.safeParse({
        sessionTag: 4294967296,
        sequence: 0,
        tick: 0,
        revision: 0,
        cameraTag: 0
    }).success).toBe(false);
    expect(ConnectionDescriptorSchema.safeParse({
        ...invalidRole,
        role: "operator",
        outputId: null,
        wsUrl: "ws://127.0.0.1:9999/ws"
    }).success).toBe(false);
    expect(CaptureReplyDataSchema.safeParse({
        metadata: {
            frame: validApplied,
            width: 1921,
            height: 1080
        },
        pngBase64: ""
    }).success).toBe(false);
});
