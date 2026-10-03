import { expect, it, vi } from 'vitest';
import { connectWithPorts } from '../src/client';
import type { BrowserClient, ConnectionDescriptor } from '@opensekai/contracts';
const descriptor: ConnectionDescriptor = {schemaVersion:1,sessionId:'session_smoke',httpOrigin:'http://127.0.0.1:1234/',wsUrl:'ws://127.0.0.1:1234/ws',role:'operator',token:'local_test',capabilities:['read'],outputId:null};
class Socket extends EventTarget {bufferedAmount=0;send(){} close(){} }
async function client() {
 const socket=new Socket(), read=vi.fn(async()=>new Response(new Uint8Array([7])));
 const ready=connectWithPorts(descriptor,{socket:()=>socket,setTimeout,clearTimeout,fetch:read});
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'authReply',schemaVersion:1,sessionId:descriptor.sessionId,capabilities:['read']})}));
 return {client:await ready as BrowserClient,read};
}
it('maps an exact app evidence URI to authenticated loopback bytes',async()=>{
 const c=await client();try {
  expect(await c.client.readResource('opensekai://evidence/capture_1/capture.png')).toEqual(new Uint8Array([7]));
  const [url,init]=c.read.mock.calls[0] as unknown as [URL,RequestInit];
  expect(String(url)).toBe('http://127.0.0.1:1234/evidence/capture_1/capture.png');
  expect(init.headers).toEqual({Authorization:'Bearer local_test'});
 } finally {c.client.close();}
});
it.each(['opensekai://elsewhere/a/capture.png','opensekai://user@evidence/a/capture.png','opensekai://evidence:80/a/capture.png','opensekai://evidence/a/../a/capture.png','opensekai://evidence/%61/capture.png','opensekai://evidence/a/capture.png?x=1','opensekai://evidence/a/capture.png#x','opensekai://evidence/a/other.png','/evidence/a/capture.png','http://127.0.0.1:1234/evidence/a/capture.png','https://elsewhere.invalid/capture.png'])('rejects unregistered URI syntax %s before fetch',async uri=>{
 const c=await client();try {expect(()=>c.client.readResource(uri)).toThrow('Invalid resource URI');expect(c.read).not.toHaveBeenCalled();}finally{c.client.close();}
});
