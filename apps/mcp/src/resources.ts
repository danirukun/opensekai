import { createHash } from 'node:crypto';
import { McpServer, type RegisteredResource } from '@modelcontextprotocol/server';
import { LIMITS, type AppApi } from '@opensekai/contracts';
export function validEvidenceUri(uri: string): boolean {
 return /^opensekai:\/\/evidence\/[A-Za-z0-9_-]+\/(?:capture\.png|summary\.json)$/.test(uri);
}
export function registerResources(server: McpServer, api: AppApi, readResource: (uri: string) => Promise<Uint8Array>) {
 const retained = new Map<string, RegisteredResource>();
 server.registerResource('status', 'opensekai://status', {mimeType:'application/json'}, async uri => {
  const reply = await api.appStatus({});
  if (!reply.ok) throw new Error(reply.error.code);
  return {contents:[{uri:uri.href,mimeType:'application/json',text:JSON.stringify(reply.data)}]};
 });
 const registerScene = (sceneId: string) => {
  const uri = `opensekai://scene/${encodeURIComponent(sceneId)}`;
  if (retained.has(uri)) return;
  retained.set(uri, server.registerResource(sceneId, uri, {mimeType:'application/json'}, async () => {
   const reply = await api.sceneInspect({sceneId});
   if (!reply.ok) throw new Error(reply.error.code);
   return {contents:[{uri,mimeType:'application/json',text:JSON.stringify(reply.data)}]};
  }));
 };
 const registerEvidence = (record: {uri:string;mimeType:string;sha256:string;bytes:number}) => {
  if (!validEvidenceUri(record.uri) || record.bytes > LIMITS.pngBytes) throw new Error('INVALID_INPUT');
  if (retained.has(record.uri)) return;
  const uri = record.uri;
  retained.set(uri, server.registerResource(uri, uri, {mimeType:record.mimeType}, async () => {
   // Verify connection and grants on every read, including previously registered records.
   const status = await api.appStatus({});
   if (!status.ok) throw new Error(status.error.code);
   let bytes: Uint8Array;
   try { bytes = await readResource(uri); }
   catch { retained.get(uri)?.remove(); retained.delete(uri); throw new Error('UNAVAILABLE'); }
   if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('INVALID_INPUT');
   return {contents:[{uri,mimeType:record.mimeType,blob:Buffer.from(bytes).toString('base64')}]};
  }));
  // Native retains eight captures. Bound local registrations as well.
  const evidence = [...retained.keys()].filter(validEvidenceUri);
  while (evidence.length > 8) { const oldest = evidence.shift()!; retained.get(oldest)?.remove(); retained.delete(oldest); }
 };
 return {registerScene, registerEvidence};
}
