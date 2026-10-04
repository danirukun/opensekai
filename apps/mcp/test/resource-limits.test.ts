import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { AppApi } from '@opensekai/contracts';
import type { McpServer } from '@modelcontextprotocol/server';
import { registerResources, validEvidenceUri } from '../src/resources';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function setup(bytes=new Uint8Array([1,2,3])) {
 const callbacks=new Map<string,Function>(), removals=new Map<string,ReturnType<typeof vi.fn>>();
 const server={registerResource(_name:string,uri:string,_metadata:unknown,callback:Function){callbacks.set(uri,callback);const remove=vi.fn(()=>callbacks.delete(uri));removals.set(uri,remove);return {remove};}} as unknown as McpServer;
 const api={appStatus:vi.fn(async()=>({ok:true,data:{}}))} as unknown as AppApi;
 const reader=vi.fn(async()=>bytes);
 return {callbacks,removals,reader,resources:registerResources(server,api,reader)};
}
it.each(['opensekai://evidence/'+ 'x'.repeat(257)+'/capture.png','opensekai://evidence/x/capture.png\n','opensekai://evidence/x/../x/capture.png'])('rejects noncanonical or oversized resource IDs',uri=>{expect(validEvidenceUri(uri)).toBe(false);});
it.each(['bytes','hash'])('refuses tampered resource %s',async field=>{
 const s=setup(),uri='opensekai://evidence/capture_1/capture.png';
 s.resources.registerEvidence({uri,mimeType:'image/png',sha256:field==='hash'?'0'.repeat(64):hash(new Uint8Array([1,2,3])),bytes:field==='bytes'?4:3});
 await expect(s.callbacks.get(uri)!()).rejects.toThrow('INVALID_INPUT');
});
it('evicts the oldest registered evidence resource after the ninth',()=>{
 const s=setup();for(let i=0;i<9;i++)s.resources.registerEvidence({uri:`opensekai://evidence/capture_${i}/capture.png`,mimeType:'image/png',sha256:hash(new Uint8Array([1,2,3])),bytes:3});
 expect(s.removals.get('opensekai://evidence/capture_0/capture.png')).toHaveBeenCalledOnce();
 expect([...s.callbacks.keys()].filter(validEvidenceUri)).toHaveLength(8);
});
