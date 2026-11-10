import { expect, it } from "vitest";
import { CAPTURE_MESSAGE_BYTES, captureUrl, encodeCaptureChunk, openCaptureSocket, parseCaptureChunk, parseCaptureConfig } from "../src/capture";
import type { ConnectionDescriptor } from "@opensekai/contracts";
// B31 R13: the binary chunk message and the captureConfig text message.
it("parses the binary chunk message: flags, big-endian timestamp, and the AVCC bytes", () => {
    const bytes = new Uint8Array([1, 0, 0, 0, 0, 0, 0x01, 0x02, 0x03, 0xaa, 0xbb]);
    expect(parseCaptureChunk(bytes.buffer)).toEqual({ key: true, timestampUs: 0x010203, data: new Uint8Array([0xaa, 0xbb]) });
    expect(parseCaptureChunk(new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 5, 9]))).toMatchObject({ key: false, timestampUs: 5 });
    const round = { key: false, timestampUs: 2 ** 40 + 7, data: new Uint8Array([1, 2, 3]) };
    expect(parseCaptureChunk(encodeCaptureChunk(round))).toEqual(round);
});
it("rejects a chunk without data, over 4 MiB, or with an unsafe timestamp", () => {
    expect(parseCaptureChunk(new Uint8Array(9))).toBeNull();
    expect(parseCaptureChunk(new Uint8Array(CAPTURE_MESSAGE_BYTES + 1))).toBeNull();
    expect(parseCaptureChunk(new Uint8Array([1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 1]))).toBeNull();
});
const config = { kind: "captureConfig", codec: "avc1.4d0029", description: "AU1AKf/hAAA=", codedWidth: 1920, codedHeight: 1080 };
it("parses captureConfig and rejects other text", () => {
    expect(parseCaptureConfig(JSON.stringify(config))).toEqual({ codec: "avc1.4d0029", description: Uint8Array.from(atob(config.description), c => c.charCodeAt(0)), codedWidth: 1920, codedHeight: 1080 });
    for (const bad of [{ ...config, kind: "captureStatus" }, { ...config, codec: "vp09.00.10.08" }, { ...config, codedWidth: 3840 }, { ...config, description: "" }, { ...config, description: "%%%=" }, { ...config, extra: 1 }]) expect(parseCaptureConfig(JSON.stringify(bad))).toBeNull();
    expect(parseCaptureConfig("not json")).toBeNull();
});
class FakeSocket extends EventTarget { binaryType = "blob"; sent: string[] = []; closed = false; constructor(public url: string) { super(); } send(text: string) { this.sent.push(text); } close() { this.closed = true; } }
const descriptor: ConnectionDescriptor = { schemaVersion: 1, sessionId: "session", httpOrigin: "http://127.0.0.1:4100/", wsUrl: "ws://127.0.0.1:4100/ws", role: "renderer", token: "secret-token", capabilities: ["read"], outputId: "output_main" };
it("sends captureAuth first, keeps the token out of the URL, and closes on a chunk before the config", () => {
    let socket!: FakeSocket;
    const events: string[] = [];
    openCaptureSocket(descriptor, "a".repeat(32), { config: () => events.push("config"), chunk: chunk => events.push(`chunk:${chunk.key}`), closed: code => events.push(`closed:${code}`) }, url => (socket = new FakeSocket(url)) as never);
    expect(socket.url).toBe("ws://127.0.0.1:4100/capture");
    expect(captureUrl(descriptor)).not.toContain("secret");
    expect(socket.binaryType).toBe("arraybuffer");
    socket.dispatchEvent(new Event("open"));
    expect(JSON.parse(socket.sent[0]!)).toEqual({ kind: "captureAuth", token: "secret-token", outputId: "output_main", streamId: "a".repeat(32) });
    socket.dispatchEvent(new MessageEvent("message", { data: encodeCaptureChunk({ key: true, timestampUs: 1, data: new Uint8Array([1]) }).buffer }));
    expect(events).toEqual(["closed:1002"]);
    expect(socket.closed).toBe(true);
});
it("delivers the config and then chunks, and reports the host close code once", () => {
    let socket!: FakeSocket;
    const events: string[] = [];
    openCaptureSocket(descriptor, "b".repeat(32), { config: c => events.push(`config:${c.codedWidth}`), chunk: chunk => events.push(`chunk:${chunk.timestampUs}`), closed: code => events.push(`closed:${code}`) }, url => (socket = new FakeSocket(url)) as never);
    socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(config) }));
    socket.dispatchEvent(new MessageEvent("message", { data: encodeCaptureChunk({ key: true, timestampUs: 33, data: new Uint8Array([1]) }).buffer }));
    socket.dispatchEvent(new CloseEvent("close", { code: 4404 }));
    socket.dispatchEvent(new CloseEvent("close", { code: 1000 }));
    expect(events).toEqual(["config:1920", "chunk:33", "closed:4404"]);
});
it("refuses an operator descriptor", () => {
    expect(() => openCaptureSocket({ ...descriptor, role: "operator", outputId: null, capabilities: ["read", "edit"] }, "c".repeat(32), { config() {}, chunk() {}, closed() {} }, url => new FakeSocket(url) as never)).toThrow();
});
import { connectWithPorts, type RendererClient } from "../src/client";
class WireSocket extends EventTarget { bufferedAmount = 0; sent: string[] = []; closed = false; send(text: string) { this.sent.push(text); } close() { this.closed = true; } message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); } }
const connect = async (role: "renderer" | "operator") => {
    const sockets: WireSocket[] = [];
    const scoped: ConnectionDescriptor = role === "renderer" ? descriptor : { ...descriptor, role, outputId: null };
    const promise = connectWithPorts(scoped, { socket() { const s = new WireSocket(); sockets.push(s); return s as never; }, setTimeout, clearTimeout, fetch });
    sockets[0]!.dispatchEvent(new Event("open"));
    sockets[0]!.message({ kind: "authReply", sessionId: "session", schemaVersion: 1, capabilities: ["read"] });
    return { client: await promise as RendererClient, socket: sockets[0]! };
};
const status = { kind: "captureStatus", revision: 4, screens: [{ entityId: "desk", streamId: "d".repeat(32), state: "live", width: 1920, height: 1080 }] };
it("gives a renderer the latest captureStatus now and on each change (B31 R9)", async () => {
    const { client, socket } = await connect("renderer");
    socket.message(status);
    const seen: number[] = [];
    const off = client.onCaptureStatus(value => seen.push(value.revision));
    socket.message({ ...status, revision: 5 });
    off();
    socket.message({ ...status, revision: 6 });
    expect(seen).toEqual([4, 5]);
    expect(socket.closed).toBe(false);
});
it("closes an operator connection that receives captureStatus", async () => {
    const { socket } = await connect("operator");
    socket.message(status);
    expect(socket.closed).toBe(true);
});
