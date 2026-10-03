import type { AppApi, ErrorCode, Id, PatchOp, Reply, SceneView, Vec3 } from '@opensekai/contracts';
export interface EditorView {
 scene: SceneView | null;
 selectedId: Id | null;
 error: ErrorCode | null;
 pending: boolean;
}
const failure = (code: ErrorCode): Reply<never> => ({ ok: false, error: { code, message: code, ids: [] } });
export function createEditorModel(api: AppApi) {
 let view: EditorView = { scene: null, selectedId: null, error: null, pending: false };
 const listeners = new Set<(view: EditorView) => void>();
 const read = (): EditorView => structuredClone(view);
 function publish(next: Partial<EditorView>) {
  view = { ...view, ...next };
  for (const listener of listeners) listener(read());
 }
 async function inspect(): Promise<void> {
  const reply = await api.sceneInspect({ sceneId: view.scene?.sceneId ?? 'scene_smoke' });
  if (!reply.ok) { publish({ error: reply.error.code }); return; }
  const selectedId = reply.data.entities.some(entity => entity.id === view.selectedId) ? view.selectedId : null;
  publish({ scene: structuredClone(reply.data), selectedId });
 }
 async function execute(command: () => Promise<Reply<{ revision: number }>>): Promise<Reply<{ revision: number }>> {
  if (view.pending) return failure('BUSY');
  if (!view.scene) { publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE'); }
  publish({ pending: true, error: null });
  try {
   const reply = await command();
   if (reply.ok || reply.error.code === 'CONFLICT') await inspect();
   if (!reply.ok) publish({ error: reply.error.code });
   return reply;
  } catch { publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE'); }
  finally { publish({ pending: false }); }
 }
 function patch(operation: PatchOp) {
  return execute(() => api.scenePatch({ sceneId: view.scene!.sceneId, expectedRevision: view.scene!.revision, operations: [operation] }));
 }
 return {
  read,
  subscribe(listener: (view: EditorView) => void) { listeners.add(listener); listener(read()); return () => { listeners.delete(listener); }; },
  async load(): Promise<void> {
   if (view.pending) return;
   publish({ pending: true });
   try { await inspect(); } catch { publish({ error: 'UNAVAILABLE' }); }
   finally { publish({ pending: false }); }
  },
  select(entityId: Id): void {
   if (view.scene?.entities.some(entity => entity.id === entityId)) publish({ selectedId: entityId });
  },
  async setPosition(entityId: Id, position: Vec3): Promise<Reply<{ revision: number }>> {
   if (!position.every(Number.isFinite)) { publish({ error: 'INVALID_INPUT' }); return failure('INVALID_INPUT'); }
   const entity = view.scene?.entities.find(entity => entity.id === entityId);
   if (!entity) { publish({ error: 'NOT_FOUND' }); return failure('NOT_FOUND'); }
   return patch({ kind: 'setTransform', entityId, transform: { ...structuredClone(entity.transform), position: [...position] } });
  },
  setVisibility(entityId: Id, visible: boolean): Promise<Reply<{ revision: number }>> { return patch({ kind: 'setVisibility', entityId, visible }); },
  selectCamera(cameraId: Id): Promise<Reply<{ revision: number }>> {
   return execute(async () => {
    let revision = view.scene!.revision;
    for (const outputId of ['output_main', 'preview_main']) {
     const reply = await api.cameraSelect({ outputId, cameraId, expectedRevision: revision });
     if (!reply.ok) return reply;
     revision = reply.data.revision;
    }
    return { ok: true, data: { revision } };
   });
  },
 };
}
export type EditorModel = ReturnType<typeof createEditorModel>;
export interface EditorPanelProps { model: EditorModel; view: EditorView }
