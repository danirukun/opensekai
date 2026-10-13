import { McpServer } from '@modelcontextprotocol/server';
import { type AppApi, type CaptureRecord, type EvidenceManifest, type Reply, type SceneView } from '@opensekai/contracts';
import { failure, invokeTool, ParamSchemas, toolMethods } from './tools';
import { BlueprintExportParams, BlueprintImportParams, exportBlueprintTool, importBlueprintTool } from './blueprint-files';
import { registerResources } from './resources';
const descriptions: Record<string, string> = {blueprint_edit:'Apply ordered Blueprint operations as one batch. Each batch needs a new batchId. Resending the identical batch is safe. Read opensekai://blueprint-nodes for node types, ports, and settings.',blueprint_inspect:'Read Blueprint documents, or the batches after a revision.',blueprint_run:'Fire a Manual Trigger in an enabled Blueprint.'};
const respond = (reply: Reply<unknown>) => ({isError:!reply.ok,content:[{type:'text' as const,text:JSON.stringify(reply)}],structuredContent:reply});
export function createMcpServer(api: AppApi, readResource: (uri: string) => Promise<Uint8Array>): McpServer {
 const server = new McpServer({name:'opensekai',version:'0.1.0'});
 const resources = registerResources(server, api, readResource);
 for (const [name, method] of Object.entries(toolMethods)) {
  server.registerTool(name, {description:descriptions[name] ?? `OpenSekai ${name.replaceAll('_', ' ')}`, inputSchema:ParamSchemas[method]}, async (params: unknown) => {
   let reply = await invokeTool(api, method, params);
   if (reply.ok) {
    try {
     if (method === 'sceneInspect') resources.registerScene((reply.data as SceneView).sceneId);
     if (method === 'captureFrame') { const r = reply.data as CaptureRecord; resources.registerEvidence({uri:r.resourceUri,mimeType:r.mimeType,bytes:r.bytes,sha256:r.sha256}); }
     if (method === 'evidenceRead') for (const r of (reply.data as EvidenceManifest).resources) resources.registerEvidence(r);
    } catch { reply = failure('INVALID_INPUT', 'Invalid evidence resource'); }
   }
   return respond(reply);
  });
  if (name === 'blueprint_inspect') {
   server.registerTool('blueprint_export', {description:'Export a stored Blueprint as an OpenSekai Blueprint file object, with the name and kind of each referenced entity.', inputSchema:BlueprintExportParams}, async (params: unknown) => respond(await exportBlueprintTool(api, params)));
   server.registerTool('blueprint_import', {description:'Import an OpenSekai Blueprint file object as a new Blueprint. References match by ID, then by unique name and kind. A Blueprint with a missing reference is imported disabled.', inputSchema:BlueprintImportParams}, async (params: unknown) => respond(await importBlueprintTool(api, params)));
  }
 }
 return server;
}
