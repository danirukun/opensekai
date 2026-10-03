import { TransformSchema } from '@opensekai/contracts';
import type { AppApi, ErrorCode, Id, PatchOp, Reply, SceneView, Vec3, Transform } from '@opensekai/contracts';
export interface EditorView {
 scene: SceneView | null;
 selectedId: Id | null;
 error: ErrorCode | null;
 pending: boolean;
}
const failure = (code: ErrorCode): Reply<never> => ({ ok: false, error: { code, message: code, ids: [] } });
export function createEditorModel(api: AppApi) {
 let view: EditorView = { scene: null, selectedId: null, error: null, pending: false };
 let inspecting = false;
 const listeners = new Set<(view: EditorView) => void>();
 const read = (): EditorView => structuredClone(view);
 function publish(next: Partial<EditorView>) {
  view = { ...view, ...next };
  for (const listener of listeners) listener(read());
 }
 async function inspect(): Promise<void> {
  const reply = await api.sceneInspect({ sceneId: view.scene?.sceneId ?? 'scene_smoke' });
  if (!reply.ok) { publish({ error: reply.error.code }); return; }
  if (view.scene && reply.data.revision < view.scene.revision) return;
  const selectedId = reply.data.entities.some(entity => entity.id === view.selectedId) ? view.selectedId : null;
  publish({ scene: structuredClone(reply.data), selectedId, error: view.error === 'CONFLICT' ? 'CONFLICT' : null });
 }
 async function execute(command: () => Promise<Reply<{ revision: number }>>, reinspectOnFailure = false): Promise<Reply<{ revision: number }>> {
  if (view.pending) return failure('BUSY');
  if (!view.scene) { publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE'); }
  publish({ pending: true, error: null });
  try {
   const reply = await command();
   if (reply.ok || reply.error.code === 'CONFLICT' || reinspectOnFailure) {
    try { await inspect(); } catch { publish({ error: 'UNAVAILABLE' }); }
   }
   if (!reply.ok) publish({ error: reply.error.code });
   return reply;
  } catch {
   if (reinspectOnFailure) { try { await inspect(); } catch {} }
   publish({ error: 'UNAVAILABLE' }); return failure('UNAVAILABLE');
  }
  finally { publish({ pending: false }); }
 }
 function patch(operation: PatchOp, expectedRevision?: number) {
  if (expectedRevision !== undefined && expectedRevision !== view.scene?.revision) {
   publish({ error: 'CONFLICT' }); return Promise.resolve(failure('CONFLICT'));
  }
  const revision = expectedRevision ?? view.scene?.revision;
  return execute(() => api.scenePatch({ sceneId: view.scene!.sceneId, expectedRevision: revision!, operations: [operation] }));
 }
 return {
  read,
  subscribe(listener: (view: EditorView) => void) { listeners.add(listener); listener(read()); return () => { listeners.delete(listener); }; },
  async load(): Promise<void> {
   if (view.pending || inspecting) return;
   inspecting = true;
   const initial = view.scene === null;
   if (initial) publish({ pending: true });
   try { await inspect(); } catch { publish({ error: 'UNAVAILABLE' }); }
   finally { inspecting = false; if (initial) publish({ pending: false }); }
  },
  select(entityId: Id): void {
   if (view.scene?.entities.some(entity => entity.id === entityId)) publish({ selectedId: entityId });
  },
  clearSelection(): void { publish({ selectedId: null }); },
  setTransform(entityId: Id, transform: Transform, expectedRevision?: number): Promise<Reply<{ revision: number }>> {
   const parsed = TransformSchema.safeParse(transform);
   if (!parsed.success) { publish({ error: 'INVALID_INPUT' }); return Promise.resolve(failure('INVALID_INPUT')); }
   if (!view.scene?.entities.some(entity => entity.id === entityId)) { publish({ error: 'NOT_FOUND' }); return Promise.resolve(failure('NOT_FOUND')); }
   return patch({ kind: 'setTransform', entityId, transform: structuredClone(parsed.data) }, expectedRevision);
  },
  async setPosition(entityId: Id, position: Vec3): Promise<Reply<{ revision: number }>> {
   if (!position.every(Number.isFinite)) { publish({ error: 'INVALID_INPUT' }); return failure('INVALID_INPUT'); }
   const entity = view.scene?.entities.find(entity => entity.id === entityId);
   if (!entity) { publish({ error: 'NOT_FOUND' }); return failure('NOT_FOUND'); }
   return patch({ kind: 'setTransform', entityId, transform: { ...structuredClone(entity.transform), position: [...position] } });
  },
  setVisibility(entityId: Id, visible: boolean, expectedRevision?: number): Promise<Reply<{ revision: number }>> { return patch({ kind: 'setVisibility', entityId, visible }, expectedRevision); },
  selectCamera(cameraId: Id, expectedRevision?: number): Promise<Reply<{ revision: number }>> {
   if (expectedRevision !== undefined && expectedRevision !== view.scene?.revision) { publish({ error: 'CONFLICT' }); return Promise.resolve(failure('CONFLICT')); }
   return execute(async () => {
    let revision = view.scene!.revision;
    for (const outputId of ['output_main', 'preview_main']) {
     const reply = await api.cameraSelect({ outputId, cameraId, expectedRevision: revision });
     if (!reply.ok) return reply;
     revision = reply.data.revision;
    }
    return { ok: true, data: { revision } };
   }, true);
  },
 };
}
export type EditorModel = ReturnType<typeof createEditorModel>;
export interface EditorPanelProps { model: EditorModel; view: EditorView }
