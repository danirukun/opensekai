import {expect,it,vi} from "vitest";
import {connectWithPorts} from "../src/client";
import type {ConnectionDescriptor,PublisherClient} from "@opensekai/contracts";
class Socket extends EventTarget {
 bufferedAmount=0; close=vi.fn(); send=vi.fn();
 message(value: unknown) {this.dispatchEvent(new MessageEvent("message",{data:JSON.stringify(value)}));}
}
const descriptor: ConnectionDescriptor={schemaVersion:1,sessionId:"test",httpOrigin:"http://127.0.0.1:1234",wsUrl:"ws://127.0.0.1:1234/ws",role:"publisher",token:"test",capabilities:["read"],outputId:null};
it("retains the first pulse before subscription, survives reconnect, unsubscribes and closes cleanly",async()=>{
 vi.useFakeTimers();
 const sockets:Socket[]=[];
 const ready=connectWithPorts(descriptor,{socket:()=>{const s=new Socket();sockets.push(s);return s;},setTimeout,clearTimeout,fetch});
 const auth={kind:"authReply",schemaVersion:1,sessionId:"test",capabilities:["read"]};
 sockets[0]!.message(auth); sockets[0]!.message({kind:"clock",sessionId:"test",elapsedMs:0});
 const client=await ready as PublisherClient, clock=vi.fn(); const remove=client.onClock(clock);
 expect(clock).toHaveBeenCalledWith(0);
 sockets[0]!.dispatchEvent(new Event("close")); await vi.advanceTimersByTimeAsync(100);
 sockets[1]!.message(auth); sockets[1]!.message({kind:"clock",sessionId:"test",elapsedMs:1000});
 expect(clock.mock.calls.map(c=>c[0])).toEqual([0,1000]);
 remove(); sockets[1]!.message({kind:"clock",sessionId:"test",elapsedMs:2000}); expect(clock).toHaveBeenCalledTimes(2);
 client.close(); expect(sockets[1]!.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
});
it.each(["operator","renderer"] as const)("rejects publisher clocks for %s",async role=>{
 const socket=new Socket(); const ready=connectWithPorts({...descriptor,role,outputId:role==="renderer"?"output_main":null},{socket:()=>socket,setTimeout,clearTimeout,fetch});
 socket.message({kind:"authReply",schemaVersion:1,sessionId:"test",capabilities:["read"]}); const client=await ready;
 socket.message({kind:"clock",sessionId:"test",elapsedMs:0}); expect(socket.close).toHaveBeenCalled(); client.close();
});
it("rejects wrong-session clocks",async()=>{
 const socket=new Socket(); const ready=connectWithPorts(descriptor,{socket:()=>socket,setTimeout,clearTimeout,fetch});
 socket.message({kind:"authReply",schemaVersion:1,sessionId:"test",capabilities:["read"]}); const client=await ready;
 socket.message({kind:"clock",sessionId:"other",elapsedMs:0}); expect(socket.close).toHaveBeenCalled(); client.close();
});

it('retains tracking with the latest pre-subscription pulse and forwards live updates',async()=>{
 const socket=new Socket();const ready=connectWithPorts(descriptor,{socket:()=>socket,setTimeout,clearTimeout,fetch});
 socket.message({kind:'authReply',schemaVersion:1,sessionId:'test',capabilities:['read']});
 const client=await ready as PublisherClient;
 const tracking={samples:[{sourceId:'source',generation:1,receivedAtMs:10000,bones:{},expressions:{jawOpen:.7}}],statuses:[]};
 socket.message({kind:'clock',sessionId:'test',elapsedMs:9990});socket.message({kind:'clock',sessionId:'test',elapsedMs:10000,tracking});
 const clock=vi.fn();client.onClock(clock);expect(clock).toHaveBeenLastCalledWith(10000,tracking);
 socket.message({kind:'clock',sessionId:'test',elapsedMs:10010,tracking});expect(clock).toHaveBeenLastCalledWith(10010,tracking);client.close();
});
it("passes clock input to the listener as its third argument",async()=>{
 const sockets:Socket[]=[];
 const ready=connectWithPorts(descriptor,{socket:()=>{const s=new Socket();sockets.push(s);return s;},setTimeout,clearTimeout,fetch});
 sockets[0]!.message({kind:"authReply",schemaVersion:1,sessionId:"test",capabilities:["read"]});
 const client=await ready as PublisherClient, clock=vi.fn(); client.onClock(clock);
 const input={events:[{kind:"keystroke",accelerator:"Control+Alt+KeyH"}]};
 sockets[0]!.message({kind:"clock",sessionId:"test",elapsedMs:5,input});
 expect(clock).toHaveBeenCalledWith(5,undefined,input); client.close();
});
