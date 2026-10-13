import { z } from 'zod';
import { exportBlueprint, importBlueprint, type AppApi, type BlueprintFile, type BlueprintImportReport, type BlueprintInspect, type Reply, type SceneView } from '@opensekai/contracts';
import { invokeTool } from './tools';

const Id = z.string().min(1).max(256);
export const BlueprintExportParams = z.strictObject({ sceneId: Id, graphId: Id });
export const BlueprintImportParams = z.strictObject({ sceneId: Id, file: z.record(z.string(), z.unknown()) });
const invalid: Reply<never> = { ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid tool parameters', ids: [] } };

export async function exportBlueprintTool(api: AppApi, params: unknown): Promise<Reply<{ file: BlueprintFile }>> {
 const valid = BlueprintExportParams.safeParse(params);
 if (!valid.success) return invalid;
 const [scene, inspect] = await Promise.all([invokeTool(api, 'sceneInspect', { sceneId: valid.data.sceneId }), invokeTool(api, 'blueprintInspect', {})]);
 if (!scene.ok) return scene;
 if (!inspect.ok) return inspect;
 const stored = inspect.data as BlueprintInspect;
 const graph = stored.kind === 'snapshot' ? stored.blueprints.find(item => item.id === valid.data.graphId) : undefined;
 if (!graph) return { ok: false, error: { code: 'NOT_FOUND', message: 'Blueprint not found', ids: [valid.data.graphId] } };
 return { ok: true, data: { file: exportBlueprint(graph, scene.data as SceneView) } };
}

export async function importBlueprintTool(api: AppApi, params: unknown, newId: () => string = () => crypto.randomUUID()): Promise<Reply<{ revision: number; report: BlueprintImportReport }>> {
 const valid = BlueprintImportParams.safeParse(params);
 if (!valid.success) return invalid;
 const scene = await invokeTool(api, 'sceneInspect', { sceneId: valid.data.sceneId });
 if (!scene.ok) return scene;
 const imported = importBlueprint(valid.data.file, scene.data as SceneView, newId);
 if (!imported.ok) return imported;
 const edit = await invokeTool(api, 'blueprintEdit', { clientId: 'mcp-import', batchId: newId(), ops: [{ kind: 'createGraph', graph: imported.data.graph }] });
 if (!edit.ok) return edit;
 return { ok: true, data: { revision: (edit.data as { revision: number }).revision, report: imported.data.report } };
}
