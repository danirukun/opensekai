import { ConnectionDescriptorSchema, CaptureBytesSchema, RuntimeFrameSchema, FrameAppliedSchema, RendererDiagnosticsSchema, ResultSchemas, LIMITS, validateCall, requiredCapability, replySchema, parseWire } from "@opensekai/contracts";
import type { AppApi, AppError, BrowserClient, CaptureBytes, CaptureParams, ConnectionDescriptor, FrameApplied, PublisherClient, Reply, RuntimeFrame, ValidatedCall, WireMessage } from "@opensekai/contracts";
import { reconnectDelay } from "./reconnect";
type Socket = Pick<WebSocket, "send" | "close" | "addEventListener" | "removeEventListener" | "bufferedAmount">;
export interface ClientPorts {
    socket(url: string): Socket;
    setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimeout(id: ReturnType<typeof setTimeout>): void;
    fetch: typeof fetch;
}
const defaults: ClientPorts = {
    socket: url => new WebSocket(url),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: timer => globalThis.clearTimeout(timer),
    fetch: (...args) => fetch(...args)
};
const error = (code: AppError["code"], message: string): Reply<never> => ({
    ok: false,
    error: {
        code,
        message,
        ids: []
    }
});
export function connectWithPorts(raw: ConnectionDescriptor, ports: ClientPorts = defaults): Promise<BrowserClient | PublisherClient> {
    const descriptor = ConnectionDescriptorSchema.parse(raw);
    let authenticatedGrants = new Set<ConnectionDescriptor["capabilities"][number]>();
    return new Promise((resolve, reject) => {
        let socket: Socket, closed = false, authenticated = false, everReady = false, attempt = 0, nextId = 0, sequence = -1, latest: RuntimeFrame | undefined;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined, authTimer: ReturnType<typeof setTimeout> | undefined;
        let pendingClock: number | undefined;
        const clocks = new Set<(elapsedMs: number) => void>();
        const frames = new Set<(f: RuntimeFrame) => void>();
        let capture: ((p: CaptureParams) => Promise<Reply<CaptureBytes>>) | undefined;
        let callListener: ((c: ValidatedCall & {
            requestId: string;
        }) => Promise<Reply<unknown>>) | undefined;
        const pending = new Map<string, {
            method: keyof AppApi;
            resolve: (value: Reply<unknown>) => void;
            timer: ReturnType<typeof setTimeout>;
        }>();
        const callbackTimers = new Map<ReturnType<typeof setTimeout>, () => void>();
        const bounded = <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => new Promise(resolveBounded => {
            const finish = (value: Reply<T>) => {
                if (!callbackTimers.has(timer))
                    return;
                clear(timer);
                callbackTimers.delete(timer);
                resolveBounded(value);
            };
            const timer = ports.setTimeout(() => finish(error("TIMEOUT", "Handler timed out")), LIMITS.rpcTimeoutMs);
            callbackTimers.set(timer, () => finish(error("UNAVAILABLE", "Connection closed")));
            Promise.resolve().then(operation).then(finish, () => finish(error("UNAVAILABLE", "Handler failed")));
        });
        const cancelCallbacks = () => {
            for (const cancel of [
                ...callbackTimers.values()
            ])
                cancel();
        };
        const active = new Set<string>();
        let generation = 0;
        let removeSocket = () => {
        };
        const clear = (timer: ReturnType<typeof setTimeout> | undefined) => {
            if (timer !== undefined)
                ports.clearTimeout(timer);
        };
        const failPending = () => {
            for (const item of pending.values()) {
                clear(item.timer);
                item.resolve(error("UNAVAILABLE", "Connection closed"));
            }
            pending.clear();
        };
        const send = (message: WireMessage) => {
            if (!authenticated && message.kind !== "auth")
                return false;
            const state = message.kind === "frame";
            try {
                const text = JSON.stringify(message);
                const bytes = new TextEncoder().encode(text).length;
                const limit = message.kind === "captureReply" ? LIMITS.captureEnvelopeBytes : message.kind === "diagnostics" ? LIMITS.diagnosticsBytes : LIMITS.jsonBytes;
                const queueLimit = LIMITS.jsonBytes * LIMITS.queuedFrames;
                const queueFull = state
                    ? socket.bufferedAmount + bytes > Math.min(bytes * LIMITS.queuedFrames, queueLimit)
                    : socket.bufferedAmount > queueLimit;
                if (bytes > limit || queueFull) {
                    if (!state)
                        disconnect();
                    return false;
                }
                socket.send(text);
                return true;
            }
            catch {
                disconnect();
                return false;
            }
        };
        const close = () => {
            if (closed)
                return;
            closed = true;
            cancelCallbacks();
            generation++;
            authenticated = false;
            authenticatedGrants.clear();
            clear(reconnectTimer);
            clear(authTimer);
            removeSocket();
            socket?.close();
            failPending();
            frames.clear();
            clocks.clear();
            pendingClock = undefined;
            latest = undefined;
            capture = undefined;
            callListener = undefined;
            active.clear();
            if (!everReady)
                reject(new Error("Connection closed before authentication"));
        };
        const api = Object.fromEntries(Object.keys(ResultSchemas).map(method => [
            method,
            (params: unknown) => new Promise<Reply<unknown>>(resolveCall => {
                const m = method as keyof AppApi;
                const valid = validateCall(m, params);
                if (!valid.ok) {
                    resolveCall(valid);
                    return;
                }
                if (!authenticated) {
                    resolveCall(error("UNAVAILABLE", "Connection unavailable"));
                    return;
                }
                if (!authenticatedGrants.has(requiredCapability(m))) {
                    resolveCall(error("FORBIDDEN", "Capability denied"));
                    return;
                }
                if (pending.size >= LIMITS.pendingCalls) {
                    resolveCall(error("BUSY", "Pending call limit"));
                    return;
                }
                const requestId = String(++nextId);
                const timer = ports.setTimeout(() => {
                    pending.delete(requestId);
                    resolveCall(error("TIMEOUT", "Call timed out"));
                }, LIMITS.rpcTimeoutMs);
                pending.set(requestId, {
                    method: m,
                    resolve: resolveCall,
                    timer
                });
                if (!send({
                    kind: "call",
                    requestId,
                    method: m,
                    params: valid.data.params
                })) {
                    pending.delete(requestId);
                    clear(timer);
                    resolveCall(error("UNAVAILABLE", "Connection closed"));
                }
            })
        ])) as unknown as AppApi;
        const read = async (path: string): Promise<Uint8Array> => {
            if (closed)
                throw new Error("Client closed");
            const response = await ports.fetch(new URL(path, descriptor.httpOrigin), {
                headers: {
                    Authorization: `Bearer ${descriptor.token}`
                }
            });
            if (!response.ok)
                throw new Error(`Resource unavailable: ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
        };
        const browser: BrowserClient = {
            api,
            onFrame(listener) {
                frames.add(listener);
                if (latest)
                    listener(latest);
                return () => {
                    frames.delete(listener);
                };
            },
            sendApplied(frame) {
                const parsed = FrameAppliedSchema.parse(frame);
                if (parsed.sessionId !== descriptor.sessionId || parsed.outputId !== descriptor.outputId)
                    throw new Error("Acknowledgement scope mismatch");
                send({
                    kind: "applied",
                    frame: parsed
                });
            },
            sendDiagnostics(diagnostics) {
                const parsed = RendererDiagnosticsSchema.parse(diagnostics);
                if (descriptor.role !== "renderer" || parsed.sessionId !== descriptor.sessionId || parsed.outputId !== descriptor.outputId) throw new Error("Diagnostics scope mismatch");
                send({kind: "diagnostics", diagnostics: parsed});
            },
            onCapture(listener) {
                capture = listener;
                return () => {
                    if (capture === listener)
                        capture = undefined;
                };
            },
            readResource(uri) {
                const match = /^opensekai:\/\/evidence\/([A-Za-z0-9_-]{1,256})\/(capture\.png|summary\.json)$/.exec(uri);
                if (!match || match[0] !== uri)
                    throw new Error("Invalid resource URI");
                return read(`/evidence/${match[1]}/${match[2]}`);
            },
            readAsset: async (id) => (await read(`/assets/${encodeURIComponent(id)}`)).buffer as ArrayBuffer,
            close
        };
        const publisher: PublisherClient = {
            onClock(listener) {
                clocks.add(listener);
                if (pendingClock !== undefined) { const elapsedMs = pendingClock; pendingClock = undefined; listener(elapsedMs); }
                return () => { clocks.delete(listener); };
            },
            onCall(listener) {
                callListener = listener;
                return () => {
                    if (callListener === listener)
                        callListener = undefined;
                };
            },
            publishFrame(frame) {
                const parsed = RuntimeFrameSchema.parse(frame);
                if (parsed.sessionId !== descriptor.sessionId)
                    throw new Error("Frame session mismatch");
                send({
                    kind: "frame",
                    frame: parsed
                });
            },
            close
        };
        const disconnect = () => {
            if (closed)
                return;
            authenticated = false;
            authenticatedGrants.clear();
            cancelCallbacks();
            generation++;
            latest = undefined;
            pendingClock = undefined;
            sequence = -1;
            active.clear();
            clear(authTimer);
            removeSocket();
            socket.close();
            failPending();
            if (!everReady) {
                close();
                return;
            }
            if (reconnectTimer === undefined)
                reconnectTimer = ports.setTimeout(() => {
                    reconnectTimer = undefined;
                    open();
                }, reconnectDelay(attempt++));
        };
        const handle = async (text: string) => {
            let message: WireMessage;
            try {
                message = parseWire(text);
            }
            catch {
                disconnect();
                return;
            }
            if (!authenticated) {
                if (message.kind !== "authReply" || message.sessionId !== descriptor.sessionId || new Set(message.capabilities).size !== new Set(descriptor.capabilities).size || !message.capabilities.every(c => new Set(descriptor.capabilities).has(c))) {
                    disconnect();
                    return;
                }
                authenticatedGrants = new Set(message.capabilities);
                authenticated = true;
                attempt = 0;
                clear(authTimer);
                authTimer = undefined;
                if (!everReady) {
                    everReady = true;
                    resolve(descriptor.role === "publisher" ? publisher : browser);
                }
                return;
            }
            if (message.kind === "clock") {
                if (descriptor.role !== "publisher" || message.sessionId !== descriptor.sessionId) { disconnect(); return; }
                if (clocks.size === 0) pendingClock = message.elapsedMs;
                for (const listener of clocks) listener(message.elapsedMs);
                return;
            }
            if (message.kind === "ping") {
                send({
                    kind: "pong",
                    requestId: message.requestId
                });
                return;
            }
            if (message.kind === "frame") {
                if (descriptor.role === "publisher" || message.frame.sessionId !== descriptor.sessionId) {
                    disconnect();
                    return;
                }
                if (message.frame.sequence <= sequence)
                    return;
                sequence = message.frame.sequence;
                latest = message.frame;
                for (const listener of frames)
                    listener(message.frame);
                return;
            }
            if (message.kind === "reply") {
                const item = pending.get(message.requestId);
                if (!item)
                    return;
                pending.delete(message.requestId);
                clear(item.timer);
                const result = replySchema(ResultSchemas[item.method]).safeParse(message.result);
                const scoped = result.success && (!result.data.ok || !(typeof result.data.data === "object" && result.data.data !== null && "sessionId" in result.data.data) || result.data.data.sessionId === descriptor.sessionId);
                item.resolve(scoped && result.success ? result.data : error("INVALID_INPUT", "Invalid method reply"));
                return;
            }
            if (message.kind === "captureRequest") {
                if (descriptor.role !== "renderer" || message.params.outputId !== descriptor.outputId || active.size >= LIMITS.pendingCalls || active.has(message.requestId)) {
                    disconnect();
                    return;
                }
                const gen = generation;
                active.add(message.requestId);
                let result: Reply<CaptureBytes>;
                try {
                    result = capture ? await bounded(() => capture!(message.params)) : error("UNAVAILABLE", "No capture listener");
                }
                catch {
                    result = error("UNAVAILABLE", "Capture failed");
                }
                if (closed || gen !== generation)
                    return;
                active.delete(message.requestId);
                if (result.ok) {
                    const valid = CaptureBytesSchema.safeParse(result.data);
                    if (!valid.success || valid.data.frame.sessionId !== descriptor.sessionId || valid.data.frame.outputId !== descriptor.outputId) {
                        send({
                            kind: "captureReply",
                            requestId: message.requestId,
                            result: error("INVALID_INPUT", "Invalid capture")
                        });
                        return;
                    }
                    let binary = "";
                    for (const byte of valid.data.png)
                        binary += String.fromCharCode(byte);
                    send({
                        kind: "captureReply",
                        requestId: message.requestId,
                        result: {
                            ok: true,
                            data: {
                                metadata: {
                                    frame: valid.data.frame,
                                    width: valid.data.width,
                                    height: valid.data.height
                                },
                                pngBase64: btoa(binary)
                            }
                        }
                    });
                }
                else
                    send({
                        kind: "captureReply",
                        requestId: message.requestId,
                        result
                    });
                return;
            }
            if (message.kind === "call") {
                if (descriptor.role !== "publisher" || active.size >= LIMITS.pendingCalls || active.has(message.requestId)) {
                    disconnect();
                    return;
                }
                const valid = validateCall(message.method, message.params);
                if (!valid.ok)
                    return;
                const gen = generation;
                active.add(message.requestId);
                let result: Reply<unknown>;
                try {
                    result = callListener ? await bounded(() => callListener!({
                        ...valid.data,
                        requestId: message.requestId
                    })) : error("UNAVAILABLE", "No publisher listener");
                }
                catch {
                    result = error("UNAVAILABLE", "Publisher failed");
                }
                if (closed || gen !== generation)
                    return;
                active.delete(message.requestId);
                const parsed = replySchema(ResultSchemas[message.method]).safeParse(result);
                send({
                    kind: "reply",
                    requestId: message.requestId,
                    result: parsed.success ? parsed.data : error("INVALID_INPUT", "Invalid publisher reply")
                });
                return;
            }
            disconnect();
        };
        function open() {
            if (closed)
                return;
            socket = ports.socket(descriptor.wsUrl);
            const onOpen = () => {
                send({
                    kind: "auth",
                    role: descriptor.role,
                    token: descriptor.token,
                    schemaVersion: 1,
                    outputId: descriptor.outputId
                });
            };
            const onMessage = (event: Event) => {
                const data = (event as MessageEvent).data;
                if (typeof data !== "string") {
                    disconnect();
                    return;
                }
                void handle(data).catch(disconnect);
            };
            const onClose = () => disconnect();
            socket.addEventListener("open", onOpen);
            socket.addEventListener("message", onMessage);
            socket.addEventListener("close", onClose);
            socket.addEventListener("error", onClose);
            removeSocket = () => {
                socket.removeEventListener("open", onOpen);
                socket.removeEventListener("message", onMessage);
                socket.removeEventListener("close", onClose);
                socket.removeEventListener("error", onClose);
            };
            authTimer = ports.setTimeout(disconnect, LIMITS.rpcTimeoutMs);
        }
        open();
    });
}
export async function connectClient(descriptor: ConnectionDescriptor): Promise<BrowserClient> {
    if (descriptor.role === "publisher")
        throw new Error("Publisher descriptor requires connectPublisher");
    return await connectWithPorts(descriptor) as BrowserClient;
}
export async function connectPublisher(descriptor: ConnectionDescriptor): Promise<PublisherClient> {
    if (descriptor.role !== "publisher")
        throw new Error("Publisher descriptor required");
    return await connectWithPorts(descriptor) as PublisherClient;
}
