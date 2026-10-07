import type { AppApi, AppStatus, ErrorCode } from '@opensekai/contracts';
import type { EditorModel } from './editor/model';
import type { BlueprintSync } from './blueprints/blueprint-sync';
export function createEditorPoll(api: AppApi, model: EditorModel, publish: (status: AppStatus) => void, fail: (code: ErrorCode) => void, blueprints?: Pick<BlueprintSync, 'revision' | 'issue' | 'poll'>, blueprintsVisible: () => boolean = () => false) {
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
    if (blueprints) {
     const moved = reply.data.blueprintRevision !== undefined && reply.data.blueprintRevision !== blueprints.revision();
     // The panel also shows runtime errors, which do not bump the revision, so it pulls on every tick.
     if (moved || blueprintsVisible() || blueprints.issue()?.kind === 'unavailable') await blueprints.poll();
    }
    const view = model.read();
    if (!view.pending && (view.scene === null || reply.data.revision !== null && reply.data.revision !== view.scene.revision)) await model.load(reply.data.revision!==null&&view.scene!==null&&reply.data.revision<view.scene.revision);
   } catch { if (!closed) fail('UNAVAILABLE'); }
   finally { active = false; }
  },
  close() { closed = true; }
 };
}
