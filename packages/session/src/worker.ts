import { connectPublisher } from "@opensekai/browser-client";
import { ConnectionDescriptorSchema, SceneViewSchema, type ConnectionDescriptor, type PublisherClient, type Reply, type SceneView } from "@opensekai/contracts";
import { createSession } from "./session";
export interface WorkerPorts {
    connect(descriptor: ConnectionDescriptor): Promise<PublisherClient>;
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(timer: unknown): void;
}
export type SessionWorkerMessage = {
    descriptor: ConnectionDescriptor;
    scene: SceneView;
} | {
    kind: "stop";
};
export function createWorkerHost(ports: WorkerPorts) {
    let generation = 0;
    let active = false;
    let cleanup: (() => void) | undefined;
    return {
        async handle(message: SessionWorkerMessage): Promise<void> {
            if ("kind" in message && message.kind === "stop") {
                generation += 1;
                active = false;
                cleanup?.();
                cleanup = undefined;
                return;
            }
            if (!("descriptor" in message) || active)
                return;
            const descriptor = ConnectionDescriptorSchema.parse(message.descriptor);
            if (descriptor.role !== "publisher")
                throw new Error("Publisher descriptor required");
            const session = createSession(SceneViewSchema.parse(message.scene), descriptor.sessionId);
            active = true;
            const current = ++generation;
            let client: PublisherClient;
            try {
                client = await ports.connect(descriptor);
            }
            catch (error) {
                if (generation === current)
                    active = false;
                throw error;
            }
            if (generation !== current) {
                client.close();
                return;
            }
            let remove: (() => void) | undefined;
            try {
                const origin = ports.now();
                remove = client.onCall(async (call) => {
                    switch (call.method) {
                        case "sceneInspect":
                            return call.params.sceneId === session.inspect().sceneId
                                ? { ok: true, data: session.inspect() }
                                : { ok: false, error: { code: "NOT_FOUND", message: "Scene not found", ids: [call.params.sceneId] } };
                        case "scenePatch": return session.applyPatch(call.params);
                        case "cameraSelect": return session.selectCamera(call.params);
                        default: return { ok: false, error: { code: "UNSUPPORTED", message: "Method is not owned by the session", ids: [] } } satisfies Reply<never>;
                    }
                });
                const timer = ports.setInterval(() => {
                    if (generation === current && active)
                        client.publishFrame(session.advance(ports.now() - origin));
                }, 1000 / 60);
                const unsubscribe = remove;
                cleanup = () => { ports.clearInterval(timer); unsubscribe(); client.close(); };
            }
            catch (error) {
                remove?.();
                client.close();
                if (generation === current)
                    active = false;
                throw error;
            }
        },
    };
}
const scope = globalThis as typeof globalThis & {
    importScripts?: unknown;
};
if (typeof scope.importScripts === "function" && typeof document === "undefined") {
    const host = createWorkerHost({
        connect: connectPublisher,
        now: () => performance.now(),
        setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
        clearInterval: timer => globalThis.clearInterval(timer as ReturnType<typeof setInterval>),
    });
    globalThis.addEventListener("message", event => {
        void host.handle((event as MessageEvent<SessionWorkerMessage>).data).catch(error => {
            globalThis.postMessage({ kind: "error", error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Worker startup failed", ids: [] } });
        });
    });
}
