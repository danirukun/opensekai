import { McpServer } from '@modelcontextprotocol/server';
import { type AppApi, type CaptureRecord, type EvidenceManifest, type SceneView } from '@opensekai/contracts';
import { failure, invokeTool, ParamSchemas, toolMethods } from './tools';
import { registerResources } from './resources';
export function createMcpServer(api: AppApi, readResource: (uri: string) => Promise<Uint8Array>): McpServer {
 const server = new McpServer({name:'opensekai',version:'0.1.0'});
 const resources = registerResources(server, api, readResource);
 for (const [name, method] of Object.entries(toolMethods)) {
  server.registerTool(name, {description:`OpenSekai ${name.replaceAll('_', ' ')}`, inputSchema:ParamSchemas[method]}, async (params: unknown) => {
   let reply = await invokeTool(api, method, params);
   if (reply.ok) {
    try {
     if (method === 'sceneInspect') resources.registerScene((reply.data as SceneView).sceneId);
     if (method === 'captureFrame') { const r = reply.data as CaptureRecord; resources.registerEvidence({uri:r.resourceUri,mimeType:r.mimeType,bytes:r.bytes,sha256:r.sha256}); }
     if (method === 'evidenceRead') for (const r of (reply.data as EvidenceManifest).resources) resources.registerEvidence(r);
    } catch { reply = failure('INVALID_INPUT', 'Invalid evidence resource'); }
   }
   return {isError:!reply.ok,content:[{type:'text' as const,text:JSON.stringify(reply)}],structuredContent:reply};
  });
 }
 return server;
}
