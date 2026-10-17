import type { AppApi, Reply } from '@opensekai/contracts';
import type { Session } from './session';

export const SESSION_METHODS = ['sceneInspect', 'scenePatch', 'sceneReplace', 'cameraSelect', 'blueprintRun', 'blueprintEdit', 'blueprintInspect', 'expressionGet', 'expressionSet'] as const;
export type SessionMethod = (typeof SESSION_METHODS)[number];
export const isSessionMethod = (method: string): method is SessionMethod => (SESSION_METHODS as readonly string[]).includes(method);

export function sessionApi(session: Session): Pick<AppApi, SessionMethod> {
 return {
  sceneInspect: async ({ sceneId }) => sceneId === session.inspect().sceneId
   ? { ok: true, data: session.inspect() }
   : { ok: false, error: { code: 'NOT_FOUND', message: 'Scene not found', ids: [sceneId] } },
  scenePatch: async patch => session.applyPatch(patch),
  sceneReplace: async ({ scene, expectedRevision }) => session.replaceScene(scene, expectedRevision),
  cameraSelect: async params => session.selectCamera(params),
  blueprintRun: async ({ graphId, triggerNodeId }) => session.runBlueprint(graphId, triggerNodeId),
  blueprintEdit: async batch => session.editBlueprints(batch),
  blueprintInspect: async ({ sinceRevision }) => ({ ok: true, data: session.inspectBlueprints(sinceRevision) }) satisfies Reply<unknown>,
  expressionGet: async ({ avatarId }) => session.getExpressions(avatarId),
  expressionSet: async ({ avatarId, name, active }) => session.setExpression(avatarId, name, active),
 };
}
