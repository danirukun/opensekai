import { expect, it } from "vitest";
import { reconnectDelay } from "../src/reconnect";
it("caps reconnect backoff", () => {
    expect([
        0,
        1,
        2,
        3,
        4,
        100
    ].map(reconnectDelay)).toEqual([
        100,
        250,
        500,
        1000,
        1000,
        1000
    ]);
});
import { vi } from "vitest";
import { connectWithPorts } from "../src/client";
import { makeSmokeFrame } from "@opensekai/contracts";
import type { BrowserClient, ConnectionDescriptor } from "@opensekai/contracts";
class FakeSocket extends EventTarget {
    bufferedAmount = 0;
    sent: string[] = [];
    send(data: string) {
        this.sent.push(data);
    }
    closed = false;
    close() {
        this.closed = true;
    }
    message(value: unknown) {
        this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify(value)
        }));
    }
}
const descriptor: ConnectionDescriptor = {
    schemaVersion: 1,
    sessionId: "session_smoke",
    httpOrigin: "http://127.0.0.1:1234",
    wsUrl: "ws://127.0.0.1:1234/ws",
    role: "operator",
    token: "test",
    capabilities: [
        "read"
    ],
    outputId: null
};
function start() {
    const sockets: FakeSocket[] = [];
    const promise = connectWithPorts(descriptor, {
        socket() {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        },
        setTimeout,
        clearTimeout,
        fetch
    });
    return {
        sockets,
        promise
    };
}
function authenticate(socket: FakeSocket) {
    socket.dispatchEvent(new Event("open"));
    socket.message({
        kind: "authReply",
        sessionId: descriptor.sessionId,
        schemaVersion: 1,
        capabilities: [
            "read"
        ]
    });
}
it("rejects wrong-session auth and clears timeout", async () => {
    vi.useFakeTimers();
    const { sockets, promise } = start();
    sockets[0].message({
        kind: "authReply",
        sessionId: "wrong",
        schemaVersion: 1,
        capabilities: [
            "read"
        ]
    });
    await expect(promise).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(sockets[0].closed).toBe(true);
    vi.useRealTimers();
});
it("rejects pending on disconnect and allows only one reconnect timer", async () => {
    vi.useFakeTimers();
    const { sockets, promise } = start();
    authenticate(sockets[0]);
    const client = await promise as BrowserClient;
    const call = client.api.appStatus({});
    sockets[0].dispatchEvent(new Event("close"));
    sockets[0].dispatchEvent(new Event("error"));
    expect(await call).toMatchObject({
        ok: false,
        error: {
            code: "UNAVAILABLE"
        }
    });
    expect(vi.getTimerCount()).toBe(1);
    client.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});
it("buffers newest frame, drops reordered frames and resets after reconnect", async () => {
    vi.useFakeTimers();
    const { sockets, promise } = start();
    authenticate(sockets[0]);
    const client = await promise as BrowserClient;
    sockets[0].message({
        kind: "frame",
        frame: makeSmokeFrame({
            sequence: 8
        })
    });
    sockets[0].message({
        kind: "frame",
        frame: makeSmokeFrame({
            sequence: 7
        })
    });
    const received: number[] = [];
    client.onFrame(f => received.push(f.sequence));
    expect(received).toEqual([
        8
    ]);
    sockets[0].dispatchEvent(new Event("close"));
    vi.advanceTimersByTime(100);
    authenticate(sockets[1]);
    sockets[1].message({
        kind: "frame",
        frame: makeSmokeFrame({
            sequence: 1
        })
    });
    expect(received).toEqual([
        8,
        1
    ]);
    client.close();
    vi.useRealTimers();
});
it("validates result against pending method and times out without replay", async () => {
    vi.useFakeTimers();
    const { sockets, promise } = start();
    authenticate(sockets[0]);
    const client = await promise as BrowserClient;
    const first = client.api.sceneInspect({
        sceneId: "scene_smoke"
    });
    sockets[0].message({
        kind: "reply",
        requestId: "1",
        result: {
            ok: true,
            data: {
                revision: 0
            }
        }
    });
    expect(await first).toMatchObject({
        ok: false,
        error: {
            code: "INVALID_INPUT"
        }
    });
    const timed = client.api.appStatus({});
    vi.advanceTimersByTime(2000);
    expect(await timed).toMatchObject({
        ok: false,
        error: {
            code: "TIMEOUT"
        }
    });
    client.close();
    vi.useRealTimers();
});
it("times out stalled publisher handlers and clears timers on close", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const p = connectWithPorts({
        ...descriptor,
        role: "publisher"
    }, {
        socket() {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        },
        setTimeout,
        clearTimeout,
        fetch
    });
    authenticate(sockets[0]);
    const client = await p as import("@opensekai/contracts").PublisherClient;
    client.onCall(() => new Promise(() => {
    }));
    sockets[0].message({
        kind: "call",
        requestId: "server1",
        method: "sceneInspect",
        params: {
            sceneId: "scene_smoke"
        }
    });
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets[0].sent.some(text => text.includes("TIMEOUT"))).toBe(true);
    client.close();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});
it("rejects a method result from a different session", async () => {
    const { sockets, promise } = start();
    authenticate(sockets[0]);
    const client = await promise as BrowserClient;
    const call = client.api.appStatus({});
    sockets[0].message({
        kind: "reply",
        requestId: "1",
        result: {
            ok: true,
            data: {
                schemaVersion: 1,
                sessionId: "wrong",
                ready: true,
                revision: 0,
                capabilities: [
                    "read"
                ],
                warnings: [],
                outputs: []
            }
        }
    });
    expect(await call).toMatchObject({
        ok: false,
        error: {
            code: "INVALID_INPUT"
        }
    });
    client.close();
});
it("rejects duplicate auth grants instead of substituting a missing grant", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const promise = connectWithPorts({
        ...descriptor,
        capabilities: ["read", "edit"]
    }, {
        socket() {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        },
        setTimeout,
        clearTimeout,
        fetch
    });
    sockets[0].message({
        kind: "authReply",
        sessionId: descriptor.sessionId,
        schemaVersion: 1,
        capabilities: ["read", "read"]
    });
    let rejected = false;
    void promise.catch(() => {
        rejected = true;
    });
    await Promise.resolve();
    expect(rejected).toBe(true);
    expect(sockets[0].closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
});
it("reads same-origin resources with trailing slash descriptor origin", async () => {
    const sockets: FakeSocket[] = [];
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([7])));
    const promise = connectWithPorts({
        ...descriptor,
        httpOrigin: descriptor.httpOrigin + "/"
    }, {
        socket() {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        },
        setTimeout,
        clearTimeout,
        fetch: fetchMock
    });
    authenticate(sockets[0]);
    const client = await promise as BrowserClient;
    try {
        expect(await client.readResource("opensekai://evidence/a/capture.png")).toEqual(new Uint8Array([7]));
        expect(fetchMock).toHaveBeenCalledOnce();
    }
    finally {
        client.close();
    }
});
it("old handler completion cannot remove a new connection request with the same ID", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const promise = connectWithPorts({
        ...descriptor,
        role: "publisher"
    }, {
        socket() {
            const s = new FakeSocket();
            sockets.push(s);
            return s;
        },
        setTimeout,
        clearTimeout,
        fetch
    });
    authenticate(sockets[0]);
    const client = await promise as import("@opensekai/contracts").PublisherClient;
    client.onCall(() => new Promise(() => {
    }));
    const call = {
        kind: "call",
        requestId: "same",
        method: "sceneInspect",
        params: {
            sceneId: "scene_smoke"
        }
    };
    sockets[0].message(call);
    await Promise.resolve();
    sockets[0].dispatchEvent(new Event("close"));
    vi.advanceTimersByTime(100);
    authenticate(sockets[1]);
    sockets[1].message(call);
    await Promise.resolve();
    await Promise.resolve();
    sockets[1].message(call);
    expect(sockets[1].closed).toBe(true);
    client.close();
    vi.useRealTimers();
});
it('returns availability errors before grant errors while reconnecting',async()=>{vi.useFakeTimers();const {sockets,promise}=start();authenticate(sockets[0]);const client=await promise as BrowserClient;expect(await client.api.cameraSelect({outputId:'output_main',cameraId:'camera_wide',expectedRevision:0})).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});sockets[0].dispatchEvent(new Event('close'));expect(await client.api.appStatus({})).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});client.close();vi.useRealTimers();});
it('publishes diagnostics only through a scoped renderer client',async()=>{
 const socket=new FakeSocket();const renderer={...descriptor,role:'renderer' as const,outputId:'output_main'};
 const promise=connectWithPorts(renderer,{socket:()=>socket,setTimeout,clearTimeout,fetch});authenticate(socket);
 const client=await promise as BrowserClient;
 const snapshot={sessionId:descriptor.sessionId,outputId:'output_main',rendererEpoch:'epoch_1',sequence:1,revision:0,backend:'webgl2' as const,geometries:1,textures:2,liveMaterials:1,assetCacheEntries:1,activeRenderJob:false,queuedFrames:0,queuedCaptures:0};
 client.sendDiagnostics!(snapshot);expect(JSON.parse(socket.sent.at(-1)!)).toEqual({kind:'diagnostics',diagnostics:snapshot});
 expect(()=>client.sendDiagnostics!({...snapshot,outputId:'preview_main'})).toThrow('scope');client.close();
 const ordinary=start();authenticate(ordinary.sockets[0]);const operator=await ordinary.promise as BrowserClient;expect(()=>operator.sendDiagnostics!(snapshot)).toThrow('scope');operator.close();
});
