import {expect,it,vi} from 'vitest';
import {connectWithPorts} from '../src/client';
import type {BrowserClient,ConnectionDescriptor} from '@opensekai/contracts';
const descriptor:ConnectionDescriptor={schemaVersion:1,sessionId:'session_smoke',httpOrigin:'http://127.0.0.1:1234/',wsUrl:'ws://127.0.0.1:1234/ws',role:'operator',token:'local_test',capabilities:['read'],outputId:null};
class Socket extends EventTarget {bufferedAmount=0;send(){} close(){} }
function body(chunks:number[][]){return new ReadableStream<Uint8Array>({start(c){for(const chunk of chunks)c.enqueue(new Uint8Array(chunk));c.close();}});}
async function client(response:()=>Response){
 const socket=new Socket();
 const ready=connectWithPorts(descriptor,{socket:()=>socket,setTimeout,clearTimeout,fetch:vi.fn(async()=>response())});
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({kind:'authReply',schemaVersion:1,sessionId:descriptor.sessionId,capabilities:['read']})}));
 return await ready as BrowserClient;
}
it('reports streamed bytes against Content-Length and returns the whole asset',async()=>{
 const c=await client(()=>new Response(body([[1,2],[3,4,5]]),{headers:{'content-length':'5'}}));
 try{
  const progress=vi.fn();
  expect([...new Uint8Array(await c.readAsset('avatar_x',progress))]).toEqual([1,2,3,4,5]);
  expect(progress.mock.calls).toEqual([[2,5],[5,5]]);
 }finally{c.close();}
});
it('reports an unknown total without Content-Length',async()=>{
 const c=await client(()=>new Response(body([[9]])));
 try{const progress=vi.fn();await c.readAsset('avatar_x',progress);expect(progress.mock.calls).toEqual([[1,null]]);}finally{c.close();}
});
