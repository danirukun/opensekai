import type { AppApi, AppStatus, ErrorCode } from '@opensekai/contracts';
import type { EditorModel } from './editor/model';
import type { BlueprintSync } from './blueprints/blueprint-sync';
export function createEditorPoll(api: AppApi, model: EditorModel, publish: (status: AppStatus) => void, fail: (code: ErrorCode) => void, blueprints?: Pick<BlueprintSync, 'revision' | 'pull'>) {
 let active = false, closed = false;
 return {
  async poll() {
   if (active || closed) return;
   active = true;
   try {
    const reply = await api.appStatus({});
    if (closed) return;
    if (!reply.ok) { fail(reply.error.code); return; }
    publish(reply.data);
    if (blueprints && reply.data.blueprintRevision !== undefined && reply.data.blueprintRevision !== blueprints.revision()) await blueprints.pull();
    const view = model.read();
    if (!view.pending && (view.scene === null || reply.data.revision !== null && reply.data.revision !== view.scene.revision)) await model.load(reply.data.revision!==null&&view.scene!==null&&reply.data.revision<view.scene.revision);
   } catch { if (!closed) fail('UNAVAILABLE'); }
   finally { active = false; }
  },
  close() { closed = true; }
 };
}
