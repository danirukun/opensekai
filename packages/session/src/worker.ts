import { connectPublisher } from "@opensekai/browser-client";
import { ConnectionDescriptorSchema, SceneViewSchema, TrackingUpdateSchema, type TrackingUpdate, type ConnectionDescriptor, type PublisherClient, type Reply, type SceneView } from "@opensekai/contracts";
import { createSession } from "./session";
export interface WorkerPorts {
    connect(descriptor: ConnectionDescriptor): Promise<PublisherClient>;
    post?(message:{kind:"clockSync";elapsedMs:number}):void;
}
export type SessionWorkerMessage = {
    descriptor: ConnectionDescriptor;
    scene: SceneView;
} | {
    kind: "stop";
} | {kind:"tracking";update:TrackingUpdate};
export function createWorkerHost(ports: WorkerPorts) {
    let generation = 0;
    let active = false;
    let cleanup: (() => void) | undefined;
    let ingestLocal:((update:TrackingUpdate)=>void)|undefined;
    return {
        async handle(message: SessionWorkerMessage): Promise<void> {
            if ("kind" in message && message.kind === "stop") {
                generation += 1;
                active = false;
                cleanup?.();
                cleanup = undefined;
                ingestLocal=undefined;
                return;
            }
            if("kind" in message&&message.kind==="tracking"){
                const parsed=TrackingUpdateSchema.safeParse(message.update);
                if(active&&parsed.success)ingestLocal?.(parsed.data);
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
                if (generation === current){
                    active = false;
                    ingestLocal=undefined;
                }
                throw error;
            }
            if (generation !== current) {
                client.close();
                return;
            }
            let remove: (() => void) | undefined;
            let removeClock: (() => void) | undefined;
            try {
                let origin: number | undefined;
                let last: number | undefined;
                let syncedAt:number|undefined;
                const filterTracking=(update:TrackingUpdate,local:boolean):TrackingUpdate=>{
                    const sources=session.inspect().entities.filter(e=>e.kind==='tracking');
                    const accepts=(value:{sourceId:string;generation:number})=>sources.some(source=>source.id===value.sourceId&&source.generation===value.generation&&(source.config.kind==='mediapipe')===local);
                    return {samples:update.samples.filter(accepts),statuses:update.statuses.filter(accepts)};
                };
                ingestLocal=update=>session.ingestTracking(filterTracking(update,true));
                remove = client.onCall(async (call) => {
                    switch (call.method) {
                        case "sceneInspect":
                            return call.params.sceneId === session.inspect().sceneId
                                ? { ok: true, data: session.inspect() }
                                : { ok: false, error: { code: "NOT_FOUND", message: "Scene not found", ids: [call.params.sceneId] } };
                        case "scenePatch": return session.applyPatch(call.params);
                        case "sceneReplace": return session.replaceScene(call.params.scene, call.params.expectedRevision);
                        case "cameraSelect": return session.selectCamera(call.params);
                        case "blueprintRun": return session.runBlueprint(call.params.graph, call.params.triggerNodeId);
                        default: return { ok: false, error: { code: "UNSUPPORTED", message: "Method is not owned by the session", ids: [] } } satisfies Reply<never>;
                    }
                });
                removeClock = client.onClock((elapsedMs,tracking) => {
                    if (generation !== current || !active || (last !== undefined && elapsedMs <= last)) return;
                    origin ??= elapsedMs;
                    last = elapsedMs;
                    if(tracking)session.ingestTracking(filterTracking(tracking,false));
                    if(syncedAt===undefined||elapsedMs-syncedAt>=100){ports.post?.({kind:'clockSync',elapsedMs});syncedAt=elapsedMs;}
                    client.publishFrame(session.advance(elapsedMs - origin,elapsedMs));
                });
                const unsubscribe = remove, unsubscribeClock = removeClock;
                cleanup = () => { unsubscribeClock(); unsubscribe(); client.close(); };
            }
            catch (error) {
                removeClock?.();
                remove?.();
                client.close();
                if (generation === current){
                    active = false;
                    ingestLocal=undefined;
                }
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
        post:message=>globalThis.postMessage(message),
    });
    globalThis.addEventListener("message", event => {
        void host.handle((event as MessageEvent<SessionWorkerMessage>).data).catch(error => {
            globalThis.postMessage({ kind: "error", error: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Worker startup failed", ids: [] } });
        });
    });
}
