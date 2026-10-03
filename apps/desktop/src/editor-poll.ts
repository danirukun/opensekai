import type { AppApi, AppStatus, ErrorCode } from '@opensekai/contracts';
import type { EditorModel } from './editor/model';
export function createEditorPoll(api: AppApi, model: EditorModel, publish: (status: AppStatus) => void, fail: (code: ErrorCode) => void) {
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
    const view = model.read();
    if (!view.pending && (view.scene === null || reply.data.revision !== null && reply.data.revision !== view.scene.revision)) await model.load();
   } catch { if (!closed) fail('UNAVAILABLE'); }
   finally { active = false; }
  },
  close() { closed = true; }
 };
}
