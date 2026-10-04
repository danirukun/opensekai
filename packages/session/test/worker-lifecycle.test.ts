import { expect, it, vi } from "vitest";
import { makeSmokeScene, type PublisherClient, type ConnectionDescriptor,defaultTrackingConfig,type SceneEntity,type TrackingUpdate } from "@opensekai/contracts";
import { createWorkerHost } from "../src/worker";
const descriptor: ConnectionDescriptor = { schemaVersion: 1, sessionId: "test", httpOrigin: "http://127.0.0.1:1234", wsUrl: "ws://127.0.0.1:1234/ws", role: "publisher", token: "test", capabilities: ["read", "edit"], outputId: null };
const initial = { descriptor, scene: makeSmokeScene() };
function fixture() {
 let pulse!: (elapsedMs: number,tracking?:TrackingUpdate) => void;
 const listeners: ((elapsedMs: number) => void)[] = [];
 const close = vi.fn(), removeCall = vi.fn(), removeClock = vi.fn(), publishFrame = vi.fn();
 const client: PublisherClient = { close, publishFrame, onCall: () => removeCall, onClock: fn => { pulse = fn; listeners.push(fn); return removeClock; } };
 return { listeners, client, close, removeCall, removeClock, publishFrame, pulse: (ms: number,tracking?:TrackingUpdate) => pulse(ms,tracking) };
}
it("uses zero origin, ignores duplicate/regressing pulses and retains origin on the same client", async () => {
 const f = fixture(), host = createWorkerHost({ connect: async () => f.client });
 await host.handle(initial); await host.handle(initial);
 f.pulse(0); f.pulse(0); f.pulse(1000); f.pulse(900); f.pulse(2000);
 expect(f.publishFrame.mock.calls.map(c => c[0].tick)).toEqual([0,60,120]);
 await host.handle({kind: "stop"}); f.pulse(3000);
 expect(f.publishFrame).toHaveBeenCalledTimes(3);
 expect(f.close).toHaveBeenCalledOnce(); expect(f.removeCall).toHaveBeenCalledOnce(); expect(f.removeClock).toHaveBeenCalledOnce();
 await host.handle(initial); f.listeners[0]!(8000); expect(f.publishFrame).toHaveBeenCalledTimes(3); f.pulse(9000); f.pulse(10000);
 expect(f.publishFrame.mock.calls.slice(3).map(c => c[0].tick)).toEqual([0,60]);
 await host.handle({kind: "stop"});
});
it("closes late startup exactly once and ignores its callbacks", async () => {
 const f = fixture(); let resolve!: (c: PublisherClient) => void;
 const host = createWorkerHost({connect: () => new Promise(r => resolve = r)});
 const pending = host.handle(initial); await host.handle({kind:"stop"}); resolve(f.client); await pending;
 expect(f.close).toHaveBeenCalledOnce(); expect(f.removeClock).not.toHaveBeenCalled();
});
it("cleans up failed clock subscription and permits retry", async () => {
 const f = fixture(), subscribe = f.client.onClock;
 f.client.onClock = vi.fn().mockImplementationOnce(() => {throw new Error("subscription failed");}).mockImplementation(subscribe);
 const host = createWorkerHost({connect: async () => f.client});
 await expect(host.handle(initial)).rejects.toThrow("subscription failed");
 expect(f.close).toHaveBeenCalledOnce(); expect(f.removeCall).toHaveBeenCalledOnce();
 await host.handle(initial); f.pulse(10); expect(f.publishFrame).toHaveBeenCalledOnce(); await host.handle({kind:"stop"});
});

it("keeps persistent mutations across native pulses without replay", async () => {
 const f = fixture(); let call!: Parameters<PublisherClient["onCall"]>[0];
 f.client.onCall = fn => {call=fn; return f.removeCall;};
 const host=createWorkerHost({connect:async()=>f.client}); await host.handle(initial);
 f.pulse(500);
 const edit={requestId:"edit",method:"scenePatch" as const,params:{sceneId:"scene_smoke",expectedRevision:0,operations:[{kind:"setVisibility" as const,entityId:"performer",visible:false}]}};
 expect(await call(edit)).toEqual({ok:true,data:{revision:1}});
 f.pulse(1500); f.pulse(1500); f.pulse(2500);
 expect(f.publishFrame.mock.calls.slice(1).map(c=>c[0].scene.revision)).toEqual([1,1]);
 expect(f.publishFrame.mock.calls[2]![0].scene.entities.find((e:{id:string})=>e.id==="performer").visible).toBe(false);
 expect(await call(edit)).toMatchObject({ok:false,error:{code:"CONFLICT"}});
 await host.handle({kind:"stop"});
});

function trackedScene(kind:'vmc'|'mediapipe'){
 const scene=makeSmokeScene();const config=defaultTrackingConfig(kind);config.enabled=true;
 scene.entities.push({id:'source',name:'Source',kind:'tracking',generation:1,visible:true,transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},config} as SceneEntity);
 const avatar=scene.entities.find(e=>e.kind==='avatar')!;if(avatar.kind==='avatar')avatar.tracking={bodySourceId:'source',faceSourceId:null};return scene;
}
const trackingSample={sourceId:'source',generation:1,receivedAtMs:10000,bones:{},expressions:{jawOpen:.8}};
it('keeps native receipt time after subtracting session clock origin',async()=>{
 const f=fixture(),post=vi.fn(),host=createWorkerHost({connect:async()=>f.client,post});
 await host.handle({descriptor,scene:trackedScene('vmc')});f.pulse(10000,{samples:[trackingSample],statuses:[]});
 expect(f.publishFrame.mock.calls[0]?.[0]).toMatchObject({elapsedMs:0,avatarPoses:[{avatarId:'performer',expressions:{jawOpen:.8}}]});
 expect(post).toHaveBeenCalledWith({kind:'clockSync',elapsedMs:10000});
 f.pulse(10625);expect(f.publishFrame.mock.calls[1]?.[0]?.avatarPoses[0].expressions.jawOpen).toBeCloseTo(.4);await host.handle({kind:'stop'});
});
it('accepts only current local MediaPipe data and ignores native MediaPipe status',async()=>{
 const f=fixture(),host=createWorkerHost({connect:async()=>f.client});await host.handle({descriptor,scene:trackedScene('mediapipe')});
 await host.handle({kind:'tracking',update:{samples:[trackingSample],statuses:[]}});
 f.pulse(10000,{samples:[],statuses:[{sourceId:'source',generation:1,state:'stopped',packets:0,invalidPackets:0,lastReceivedAtMs:null,error:null}]});
 expect(f.publishFrame.mock.calls[0]?.[0]?.avatarPoses[0].expressions.jawOpen).toBe(.8);
 await host.handle({kind:'tracking',update:{samples:[{...trackingSample,generation:0,receivedAtMs:10001,expressions:{jawOpen:1}}],statuses:[]}});
 f.pulse(10001);expect(f.publishFrame.mock.calls[1]?.[0]?.avatarPoses[0].expressions.jawOpen).toBe(.8);
 await host.handle({kind:'stop'});await host.handle({kind:'tracking',update:{samples:[trackingSample],statuses:[]}});f.pulse(10002);expect(f.publishFrame).toHaveBeenCalledTimes(2);
 await host.handle({descriptor,scene:trackedScene('vmc')});await host.handle({kind:'tracking',update:{samples:[trackingSample],statuses:[]}});f.pulse(10000);
 expect(f.publishFrame.mock.calls[2]?.[0]?.avatarPoses[0].expressions).toEqual({});await host.handle({kind:'stop'});
});
