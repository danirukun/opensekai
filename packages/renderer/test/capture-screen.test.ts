import { expect, it } from "vitest";
import type { CaptureStatus, SceneEntity } from "@opensekai/contracts";
import type { CaptureHandlers } from "@opensekai/browser-client";
import { CAPTURE_CODEC_UNSUPPORTED, CAPTURE_FAILED, CAPTURE_NOT_IN_VIEW, CAPTURE_RETRY_MS, captureMessage, captureScreenPlan, captureWarning, createCaptureScreens, createChunkGate, createNewestFrame, createRetries, probeVideoDecoder, wantedStreams, type CaptureEnv } from "../src/capture-screen";

const frame = (id: number, log: number[]) => ({ id, close() { log.push(id); } });
it("keeps only the newest frame and closes each older one at once (B31 R14)", () => {
    const closed: number[] = [];
    const newest = createNewestFrame<ReturnType<typeof frame>>();
    newest.offer(frame(1, closed)); newest.offer(frame(2, closed)); newest.offer(frame(3, closed));
    expect(closed).toEqual([1, 2]);
    expect(newest.take()?.id).toBe(3);
    expect(newest.take()).toBeNull();
    newest.offer(frame(4, closed)); newest.clear();
    expect(closed).toEqual([1, 2, 4]);
});
it("starts at a key frame and drops to the next key frame when the decode queue is more than 4 above the decoder depth", () => {
    const gate = createChunkGate();
    expect(gate.accept(false, 0)).toBe(false);
    expect(gate.accept(true, 0)).toBe(true);
    // Before the first output the decoder may hold one key frame interval (the depth is 30).
    expect(gate.accept(false, 34)).toBe(true);
    expect(gate.accept(false, 35)).toBe(false);
    expect(gate.accept(true, 0)).toBe(true);
    // The first outputs measure the hold: the largest of them, 5. A queue of 9 decodes; 10 drops to the next key frame.
    gate.output(3); gate.output(5); gate.output(4); gate.output(5); gate.output(5); gate.output(4); gate.output(5); gate.output(5);
    expect(gate.accept(false, 9)).toBe(true);
    expect(gate.accept(false, 10)).toBe(false);
    expect(gate.accept(true, 10)).toBe(false);
    expect(gate.accept(false, 0)).toBe(false);
    expect(gate.accept(true, 2)).toBe(true);
    // After 8 outputs the depth stays: a slow decoder does not raise the limit.
    for (let i = 0; i < 4; i++) gate.output(20);
    expect(gate.accept(false, 10)).toBe(false);
    // A new config measures again; a decoder without a hold gets the R14 limit of 4.
    gate.reset();
    expect(gate.accept(false, 0)).toBe(false);
    expect(gate.accept(true, 0)).toBe(true);
    gate.output(0);
    expect(gate.accept(false, 4)).toBe(true);
    expect(gate.accept(false, 5)).toBe(false);
});
it("retries 3 times for one content value, then fails; a value that leaves starts again", () => {
    const retries = createRetries();
    expect([retries.fail("a"), retries.fail("a"), retries.fail("a"), retries.fail("a")]).toEqual(["retry", "retry", "retry", "failed"]);
    expect(retries.failed("a")).toBe(true);
    expect(retries.failed("b")).toBe(false);
    retries.prune(new Set(["b"]));
    expect(retries.failed("a")).toBe(false);
});
it("gives the R15 messages", () => {
    expect(captureMessage("notAllowed", null)).toBe("Choose the source again");
    expect(captureMessage("notFound", null)).toBe("Source not found");
    expect(captureMessage("ended", null)).toBe("Source not found");
    expect(captureMessage("paused", null)).toBe("Source hidden");
    expect(captureMessage("permissionNeeded", null)).toBe("Screen Recording permission needed");
    expect(captureMessage("unsupported", null)).toBe("Capture not supported on this platform");
    expect(captureMessage("failed", null)).toBe("Capture failed");
    for (const state of ["starting", "idle", "live"] as const) expect(captureMessage(state, null)).toBeNull();
    expect(captureMessage(null, null)).toBeNull();
    expect(captureMessage("live", CAPTURE_CODEC_UNSUPPORTED)).toBe("Capture codec not supported");
    expect(captureWarning(CAPTURE_NOT_IN_VIEW)).toBe("Capture: Capture not supported in this view");
});

const screen = (id: string, visible = true, cursor = true): SceneEntity => ({ id, name: "Screen", visible, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: "screen", content: { kind: "capture", target: "display", source: { kind: "display", name: "Display", ordinal: 0 }, cursor } });
const image = (id: string): SceneEntity => ({ ...screen(id), content: { kind: "image", assetId: null } } as SceneEntity);
const S1 = "1".repeat(32), S2 = "2".repeat(32);
const status = (screens: [string, string | null, CaptureStatus["screens"][number]["state"]][]): CaptureStatus => ({ kind: "captureStatus", revision: 1, screens: screens.map(([entityId, streamId, state]) => ({ entityId, streamId, state, width: 1280, height: 720 })) });
it("plans one socket for each stream that a visible screen uses in a socket state", () => {
    const plans = captureScreenPlan([screen("a"), screen("b"), screen("c", false), screen("d"), image("e")], status([["a", S1, "live"], ["b", S1, "paused"], ["c", S2, "live"], ["d", null, "notAllowed"]]));
    expect(plans.map(plan => plan.entityId)).toEqual(["a", "b", "c", "d"]);
    expect([...wantedStreams(plans, () => false)]).toEqual([S1]);
    expect([...wantedStreams(plans, plan => plan.entityId !== "b")]).toEqual([S1]);
    expect([...wantedStreams(plans, () => true)]).toEqual([]);
    expect([...wantedStreams(captureScreenPlan([screen("a")], status([["a", S1, "ended"]])), () => false)]).toEqual([]);
});

// A fake host and decoder for the socket rules: the headless check covers the real decode.
const fakes = (decoder?: { supported?: boolean }) => {
    let clock = 0, listener: ((s: CaptureStatus) => void) | undefined;
    const opened: { streamId: string; handlers: CaptureHandlers; closed: boolean }[] = [];
    const decoders: { init: { error(e: unknown): void; output(f: unknown): void }; closed: boolean }[] = [];
    class Decoder { state = "unconfigured"; decodeQueueSize = 0; init: never; constructor(init: never) { this.init = init; decoders.push(this as never); } configure() { this.state = "configured"; } decode() {} reset() {} close() { this.state = "closed"; (this as unknown as { closed: boolean }).closed = true; } static async isConfigSupported() { return { supported: decoder?.supported ?? true }; } }
    const env: CaptureEnv = { VideoDecoder: decoder ? Decoder as never : undefined, EncodedVideoChunk: class {} as never, createImageBitmap: async () => ({}) as never, now: () => clock };
    const host = { onStatus(next: (s: CaptureStatus) => void) { listener = next; return () => { listener = undefined; }; }, open(streamId: string, handlers: CaptureHandlers) { const entry = { streamId, handlers, closed: false }; opened.push(entry); return { close() { if (entry.closed) return; entry.closed = true; handlers.closed(1000); } }; } };
    return { env, host, opened, decoders, send: (s: CaptureStatus) => listener?.(s), tick: (ms: number) => { clock += ms; } };
};
const config = { codec: "avc1.4d0029", description: new Uint8Array([1]), codedWidth: 1280, codedHeight: 720 };
it("opens no socket for a scene without a capture screen and one shared socket for two screens of one stream", () => {
    const f = fakes({});
    const captures = createCaptureScreens({ host: f.host, upload: "frame", env: f.env });
    f.send(status([]));
    expect(captures.apply([image("e")]).size).toBe(0);
    expect(f.opened).toHaveLength(0);
    f.send(status([["a", S1, "live"], ["b", S1, "live"]]));
    const views = captures.apply([screen("a"), screen("b")]);
    expect(f.opened.map(entry => entry.streamId)).toEqual([S1]);
    expect(views.get("a")).toMatchObject({ texture: null, aspect: 1280 / 720, warning: null });
    captures.apply([screen("a"), screen("b", false)]);
    expect(f.opened).toHaveLength(1);
    captures.apply([screen("a", false), screen("b", false)]);
    expect(f.opened[0]!.closed).toBe(true);
    captures.dispose();
});
it("closes the sockets on pause and opens them again on the next frame", () => {
    const f = fakes({});
    const captures = createCaptureScreens({ host: f.host, upload: "frame", env: f.env });
    f.send(status([["a", S1, "paused"]]));
    expect(captures.apply([screen("a")]).get("a")?.warning?.message).toBe("Capture: Source hidden");
    captures.pause();
    expect(f.opened[0]!.closed).toBe(true);
    captures.apply([screen("a")]);
    expect(f.opened).toHaveLength(2);
});
it("opens the socket again 1 s after a decoder error, 3 times, then fails the screen", async () => {
    const f = fakes({});
    const captures = createCaptureScreens({ host: f.host, upload: "frame", env: f.env });
    f.send(status([["a", S1, "live"]]));
    for (let attempt = 0; attempt < 4; attempt++) {
        captures.apply([screen("a")]);
        expect(f.opened).toHaveLength(attempt + 1);
        f.opened[attempt]!.handlers.config(config);
        await Promise.resolve(); await Promise.resolve();
        f.decoders[attempt]!.init.error(new Error("decode"));
        captures.apply([screen("a")]);
        expect(f.opened).toHaveLength(attempt + 1);
        f.tick(CAPTURE_RETRY_MS);
    }
    const views = captures.apply([screen("a")]);
    expect(f.opened).toHaveLength(4);
    expect(views.get("a")?.warning?.message).toBe(captureWarning(CAPTURE_FAILED));
    // A new content value starts again.
    captures.apply([screen("a", true, false)]);
    expect(f.opened).toHaveLength(5);
});
it("fails a stream whose codec the decoder does not support, and a view without VideoDecoder", async () => {
    const f = fakes({ supported: false });
    const captures = createCaptureScreens({ host: f.host, upload: "frame", env: f.env });
    f.send(status([["a", S1, "live"]]));
    captures.apply([screen("a")]);
    f.opened[0]!.handlers.config(config);
    await Promise.resolve(); await Promise.resolve();
    f.tick(5000);
    expect(captures.apply([screen("a")]).get("a")?.warning?.message).toBe(captureWarning(CAPTURE_CODEC_UNSUPPORTED));
    expect(f.opened).toHaveLength(1);
    const g = fakes();
    const none = createCaptureScreens({ host: g.host, upload: "frame", env: g.env });
    g.send(status([["a", S1, "live"]]));
    expect(none.apply([screen("a")]).get("a")?.warning).toEqual({ code: "UNSUPPORTED", message: captureWarning(CAPTURE_NOT_IN_VIEW), ids: ["a"] });
    expect(g.opened).toHaveLength(0);
});
it("reports the VideoDecoder probe", async () => {
    expect(await probeVideoDecoder({})).toBe("missing");
    expect(await probeVideoDecoder({ VideoDecoder: { isConfigSupported: async () => ({ supported: true }) } as never })).toBe("supported");
    expect(await probeVideoDecoder({ VideoDecoder: { isConfigSupported: async () => ({ supported: false }) } as never })).toBe("unsupported");
});
it("puts the screen entity ID in each Capture warning, for the Inspector (B31 R15)", () => {
    const f = fakes({});
    const captures = createCaptureScreens({ host: f.host, upload: "frame", env: f.env });
    f.send(status([["a", null, "notAllowed"], ["b", S1, "paused"], ["c", null, "notFound"]]));
    const views = captures.apply([screen("a"), screen("b"), screen("c")]);
    expect(views.get("a")?.warning).toEqual({ code: "UNAVAILABLE", message: "Capture: Choose the source again", ids: ["a"] });
    expect(views.get("b")?.warning).toEqual({ code: "UNAVAILABLE", message: "Capture: Source hidden", ids: ["b"] });
    expect(views.get("c")?.warning).toEqual({ code: "UNAVAILABLE", message: "Capture: Source not found", ids: ["c"] });
    captures.dispose();
});
it("treats a throw from the socket open as an error of that screen, not of the frame (review fix)", async () => {
    const f = fakes({});
    const host = { ...f.host, open() { throw new Error("blocked"); } };
    const captures = createCaptureScreens({ host, upload: "frame", env: f.env });
    f.send(status([["a", S1, "live"]]));
    expect(() => captures.apply([screen("a")])).not.toThrow();
    await Promise.resolve();
    expect(captures.sockets()).toEqual([]);
    captures.dispose();
});
it("keeps the host message of a state without a socket when the view has no VideoDecoder (review fix, R15)", () => {
    const g = fakes();
    const none = createCaptureScreens({ host: g.host, upload: "frame", env: g.env });
    g.send(status([["a", null, "notAllowed"], ["b", S1, "live"]]));
    const views = none.apply([screen("a"), screen("b")]);
    expect(views.get("a")?.warning?.message).toBe("Capture: Choose the source again");
    expect(views.get("b")?.warning?.message).toBe(captureWarning(CAPTURE_NOT_IN_VIEW));
});
