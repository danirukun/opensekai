import { McpServer } from '@modelcontextprotocol/server';
import { type AppApi, type CaptureRecord, type EvidenceManifest, type Reply, type SceneView } from '@opensekai/contracts';
import { failure, invokeTool, ParamSchemas, toolMethods } from './tools';
import { BlueprintExportParams, BlueprintImportParams, exportBlueprintTool, importBlueprintTool } from './blueprint-files';
import { registerResources } from './resources';
const descriptions: Record<string, string> = {blueprint_edit:'Apply ordered Blueprint operations as one batch. Each batch needs a new batchId. Resending the identical batch is safe. Read opensekai://blueprint-nodes for node types, ports, settings, and data types. A data input without a wire reads its inline value (node inputs, set with setNodeInput; value null removes it), else the default of its type. An integer output connects to a number input. duplicateGraph copies a Blueprint as a disabled copy with new node IDs. addComment, updateComment, and removeComment change the comment boxes (at most 32, text up to 512 characters).',blueprint_inspect:'Read Blueprint documents, or the batches after a revision.',blueprint_run:'Fire a Manual Trigger in an enabled Blueprint.',blueprint_debug_log:'Read the Blueprint debug log of this session: Log lines (level, message), Show Toast entries (variant, header, caption), and Emit Debug Event entries (name, payload type and text), each with seq, session time atMs, graphId, and nodeId, plus the latest text of each Debug Value node. Without since, returns the last 50 entries and all values. Pass next as since to read newer entries; read again while next is less than latest. dropped counts entries over the rate limits (10 a second for each node, 5 toasts a second for each graph). The session keeps the last 1000 entries and saves none.',expression_get:'List the triggerable expressions of a character with their layer, fade, tracking suppression, active state, and current weight.',expression_set:'Activate or deactivate a character expression. It fades over its fade time and replaces an active expression on the same layer. Change settings with setAvatarExpression in scene_patch.',camera_screenshot:'Save a transparent 1920 x 1080 PNG of a camera in the app screenshots folder. Returns the file name, not a path. At most one screenshot each second.',scene_patch:'Apply ordered scene operations at an expected revision. setLight replaces the settings of a light entity (type, color, intensity, range, affect flags, shadow, cone, volumetric). The type is directional, point, spot (needs a cone), or ambient (no shadow); a scene holds at most 8 lights and 2 shadow lights. setHaze replaces the density, smoke, intensity, and drift of a haze entity; a scene holds at most 1 haze. setEnvironmentReflections sets the reflections intensity of the environment (0 to 2). createEntity with kind tracking adds a VMC, iFacialMocap, or MediaPipe source (at most 4). setTrackingConfig replaces the config of a source of the same kind. setAvatarTracking sets the body and face source of a character; a patch that makes two characters use one source fails with INVALID_INPUT and the character IDs, and one character can use one source for body and face. setTrackingSmoothing sets the One Euro filter of a source.',app_status:'Read the app status: readiness, scene revision, warnings, outputs, trackingStatus of each source (state, packets, invalidPackets, unmatchedPackets, error), and localAddresses (the IPv4 addresses of this computer, to enter in the iFacialMocap phone app).',asset_list:'List stored assets by ID, kind, name, and credits. Use a scene ID with setEnvironmentModel in scene_patch. Pass next as after to read the next page.'};
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
