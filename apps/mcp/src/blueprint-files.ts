import { z } from 'zod';
import { exportBlueprint, faceOnlyBodyMotionTemplate, importBlueprint, type AppApi, type BlueprintFile, type BlueprintImportReport, type BlueprintInspect, type Reply, type SceneView } from '@opensekai/contracts';
import { invokeTool } from './tools';

const Id = z.string().min(1).max(256);
export const BlueprintExportParams = z.strictObject({ sceneId: Id, graphId: Id });
// A file, or a bundled template for one character. One object, so MCP gets an object schema without a top-level union.
export const BlueprintImportParams = z.strictObject({ sceneId: Id, file: z.record(z.string(), z.unknown()).optional(), template: z.literal('face-only-body-motion').optional(), avatarId: Id.optional() })
 .superRefine((params, context) => {
  if ((params.file === undefined) === (params.template === undefined)) context.addIssue({ code: 'custom', message: 'Give file or template', path: ['template'] });
  if (params.template !== undefined && params.avatarId === undefined) context.addIssue({ code: 'custom', message: 'Template needs avatarId', path: ['avatarId'] });
  if (params.template === undefined && params.avatarId !== undefined) context.addIssue({ code: 'custom', message: 'avatarId needs template', path: ['avatarId'] });
 });
// The Face-Only Body Motion template for a character of the scene.
const templateFile = (scene: SceneView, avatarId: string): Reply<BlueprintFile> => {
 const avatar = scene.entities.find(entity => entity.id === avatarId && entity.kind === 'avatar');
 return avatar ? { ok: true, data: faceOnlyBodyMotionTemplate({ id: avatar.id, name: avatar.name }) } : { ok: false, error: { code: 'INVALID_INPUT', message: 'Character not found', ids: [avatarId] } };
};
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
 const view = scene.data as SceneView;
 const source: Reply<unknown> = valid.data.file ? { ok: true, data: valid.data.file } : templateFile(view, valid.data.avatarId!);
 if (!source.ok) return source;
 const imported = importBlueprint(source.data, view, newId);
 if (!imported.ok) return imported;
 const edit = await invokeTool(api, 'blueprintEdit', { clientId: 'mcp-import', batchId: newId(), ops: [{ kind: 'createGraph', graph: imported.data.graph }] });
 if (!edit.ok) return edit;
 return { ok: true, data: { revision: (edit.data as { revision: number }).revision, report: imported.data.report } };
}
