import { ParamSchemas, ResultSchemas, replySchema, validateCall, type AppApi, type Reply } from '@opensekai/contracts';
export const toolMethods = { app_status: 'appStatus', scene_inspect: 'sceneInspect', scene_patch: 'scenePatch', scene_replace: 'sceneReplace', camera_select: 'cameraSelect', camera_screenshot: 'cameraScreenshot', blueprint_run: 'blueprintRun', blueprint_edit: 'blueprintEdit', blueprint_inspect: 'blueprintInspect', blueprint_debug_log: 'blueprintDebug', tracking_probe: 'trackingProbe', capture_frame: 'captureFrame', benchmark_start: 'benchmarkStart', benchmark_status: 'benchmarkStatus', benchmark_cancel: 'benchmarkCancel', evidence_read: 'evidenceRead', asset_list: 'assetList', expression_get: 'expressionGet', expression_set: 'expressionSet' } as const;
export { ParamSchemas };
export const failure = (code: 'INVALID_INPUT' | 'UNAVAILABLE' | 'NOT_FOUND', message: string): Reply<never> => ({ok:false,error:{code,message,ids:[]}});
export async function invokeTool(api: AppApi, method: keyof AppApi, params: unknown): Promise<Reply<unknown>> {
 const valid = validateCall(method, params);
 if (!valid.ok) return valid;
 try {
  const call = api[method] as (params: unknown) => Promise<Reply<unknown>>;
  const result = replySchema(ResultSchemas[method]).safeParse(await call(valid.data.params));
  return result.success ? result.data : failure('INVALID_INPUT', 'Invalid application reply');
 } catch { return failure('UNAVAILABLE', 'Application connection unavailable'); }
}
