import { connectPublisher } from "@opensekai/browser-client";
import { AssetRecordSchema, ConnectionDescriptorSchema, type AssetRecord, SceneViewSchema, TrackingUpdateSchema, type TrackingUpdate, type ConnectionDescriptor, type PublisherClient, type Reply, type SceneView } from "@opensekai/contracts";
import { createSession } from "./session";
import { isSessionMethod, sessionApi } from "./session-api";
export interface WorkerPorts {
    connect(descriptor: ConnectionDescriptor): Promise<PublisherClient>;
    post?(message:{kind:"clockSync";elapsedMs:number}):void;
}
export type SessionWorkerMessage = {
    descriptor: ConnectionDescriptor;
    scene: SceneView;
    assets?: AssetRecord[];
} | {kind:"assets";records:AssetRecord[]} | {
    kind: "stop";
} | {kind:"tracking";update:TrackingUpdate};
export function createWorkerHost(ports: WorkerPorts) {
    let generation = 0;
    let active = false;
    let cleanup: (() => void) | undefined;
    let ingestLocal:((update:TrackingUpdate)=>void)|undefined;
    let records:AssetRecord[]=[];
    let storeRecords:((records:AssetRecord[])=>void)|undefined;
    const parseRecords=(list:unknown):AssetRecord[]=>Array.isArray(list)?list.flatMap(item=>{const parsed=AssetRecordSchema.safeParse(item);return parsed.success?[parsed.data]:[];}):[];
    return {
        async handle(message: SessionWorkerMessage): Promise<void> {
            if ("kind" in message && message.kind === "stop") {
                generation += 1;
                active = false;
                cleanup?.();
                cleanup = undefined;
                ingestLocal=undefined;
                storeRecords=undefined;
                return;
            }
            if("kind" in message&&message.kind==="assets"){
                records=parseRecords(message.records);
                storeRecords?.(records);
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
            if(message.assets!==undefined)records=parseRecords(message.assets);
            const session = createSession(SceneViewSchema.parse(message.scene), descriptor.sessionId, records);
            storeRecords=list=>session.setAssetRecords(list);
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
                let vmcFailed=false;
                const filterTracking=(update:TrackingUpdate,local:boolean):TrackingUpdate=>{
                    const sources=session.inspect().entities.filter(e=>e.kind==='tracking');
                    const accepts=(value:{sourceId:string;generation:number})=>sources.some(source=>source.id===value.sourceId&&source.generation===value.generation&&(source.config.kind==='mediapipe')===local);
                    return {samples:update.samples.filter(accepts),statuses:update.statuses.filter(accepts)};
                };
                ingestLocal=update=>session.ingestTracking(filterTracking(update,true));
                const calls = sessionApi(session);
                remove = client.onCall(async (call) => isSessionMethod(call.method)
                    ? (calls[call.method] as (params: unknown) => Promise<Reply<unknown>>)(call.params)
                    : { ok: false, error: { code: "UNSUPPORTED", message: "Method is not owned by the session", ids: [] } } satisfies Reply<never>);
                removeClock = client.onClock((elapsedMs,tracking,input) => {
                    if (generation !== current || !active || (last !== undefined && elapsedMs <= last)) return;
                    origin ??= elapsedMs;
                    last = elapsedMs;
                    if(tracking)session.ingestTracking(filterTracking(tracking,false));
                    if(syncedAt===undefined||elapsedMs-syncedAt>=100){ports.post?.({kind:'clockSync',elapsedMs});syncedAt=elapsedMs;}
                    const frame=session.advance(elapsedMs - origin,elapsedMs,input);
                    client.publishFrame(frame);
                    // A pose that fails its schema must not stop the frames of the next ticks.
                    try{const poses=session.vmcPoses(frame);if(poses)client.publishVmcPoses?.(poses);vmcFailed=false;}catch(error){if(!vmcFailed)console.error('VMC pose send failed',error);vmcFailed=true;}
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
