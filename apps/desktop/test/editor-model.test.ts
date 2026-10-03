import { expect, it, vi } from 'vitest';
import { makeSmokeScene, type AppApi, type Reply } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { createEditorModel } from '../src/editor/model';
function fixture() {
 const session = createSession(makeSmokeScene(), 'test_session');
 const unsupported = async (): Promise<Reply<never>> => ({ ok: false, error: { code: 'UNSUPPORTED', message: 'Unsupported', ids: [] } });
 const api: AppApi = {
  appStatus: unsupported, sceneInspect: vi.fn(async () => ({ ok: true as const, data: session.inspect() })),
  scenePatch: vi.fn(async params => session.applyPatch(params)), cameraSelect: vi.fn(async params => session.selectCamera(params)),
  captureFrame: unsupported, benchmarkStart: unsupported, benchmarkStatus: unsupported, benchmarkCancel: unsupported, evidenceRead: unsupported,
 };
 return { session, api, model: createEditorModel(api) };
}
it('loads persistent plain state, publishes selection, and unsubscribes', async () => {
 const { model, session } = fixture(); const listener = vi.fn(); const stop = model.subscribe(listener);
 await model.load(); model.select('performer');
 session.advance(1000); await model.load();
 expect(model.read().selectedId).toBe('performer');
 expect(model.read().scene).toEqual(session.inspect());
 expect(Object.keys(model.read()).sort()).toEqual(['error', 'pending', 'scene', 'selectedId']);
 stop(); const count = listener.mock.calls.length; model.select('marker'); expect(listener).toHaveBeenCalledTimes(count);
});
it('commits position and visibility using current revision and preserves rotation and scale', async () => {
 const { model, session, api } = fixture(); await model.load();
 const before = session.inspect().entities.find(e => e.id === 'marker')!;
 expect((await model.setPosition('marker', [1, 2, 3])).ok).toBe(true);
 expect(model.read().scene?.entities.find(e => e.id === 'marker')?.transform).toEqual({ ...before.transform, position: [1, 2, 3] });
 expect((await model.setVisibility('marker', false)).ok).toBe(true);
 expect(model.read().scene?.revision).toBe(2); expect(api.scenePatch).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 1 }));
});
it('reloads after a conflict, preserves the conflict indication, and never retries', async () => {
 const { model, session, api } = fixture(); await model.load(); model.select('marker');
 session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setVisibility', entityId: 'performer', visible: false }] });
 expect(await model.setPosition('marker', [5, 0, 0])).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
 expect(api.scenePatch).toHaveBeenCalledTimes(1); expect(model.read()).toMatchObject({ error: 'CONFLICT', pending: false, selectedId: 'marker', scene: { revision: 1 } });
 expect(model.read().scene).toEqual(session.inspect());
 expect((await model.setPosition('marker', [5, 0, 0])).ok).toBe(true); expect(model.read().error).toBeNull();
});
it('rejects invalid selection and nonfinite input without sending edits', async () => {
 const { model, api } = fixture(); await model.load(); model.select('missing'); expect(model.read().selectedId).toBeNull();
 expect(await model.setPosition('marker', [NaN, 0, 0])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(api.scenePatch).not.toHaveBeenCalled();
});
it('selects both output and preview cameras with sequential revisions', async () => {
 const { model, api } = fixture(); await model.load(); expect((await model.selectCamera('camera_close')).ok).toBe(true);
 expect(api.cameraSelect).toHaveBeenNthCalledWith(1, { outputId: 'output_main', cameraId: 'camera_close', expectedRevision: 0 });
 expect(api.cameraSelect).toHaveBeenNthCalledWith(2, { outputId: 'preview_main', cameraId: 'camera_close', expectedRevision: 1 });
 expect(model.read().scene?.outputs.every(output => output.cameraId === 'camera_close')).toBe(true);
});
it('blocks overlapping mutations and settles pending state on a transport failure', async () => {
 const { model, api } = fixture(); await model.load();
 let reject!: (cause: Error) => void;
 vi.mocked(api.scenePatch).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
 const first = model.setVisibility('marker', false);
 expect(model.read().pending).toBe(true);
 expect(await model.setVisibility('marker', true)).toMatchObject({ ok: false, error: { code: 'BUSY' } });
 expect(api.scenePatch).toHaveBeenCalledTimes(1);
 reject(new Error('Socket closed'));
 expect(await first).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
 expect(model.read()).toMatchObject({ pending: false, error: 'UNAVAILABLE' });
});
it('reports inspection failure without replacing persistent state', async () => {
 const { model, api } = fixture(); await model.load(); const scene = model.read().scene;
 vi.mocked(api.sceneInspect).mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', message: 'Disconnected', ids: [] } });
 await model.load(); expect(model.read()).toMatchObject({ scene, error: 'UNAVAILABLE', pending: false });
});
it('protects model state from listener and caller mutations', async () => {
 const { model } = fixture(); await model.load();
 model.subscribe(view => { if (view.scene) view.scene.entities.length = 0; });
 const copy = model.read(); copy.scene!.entities.length = 0;
 expect(model.read().scene?.entities.length).toBeGreaterThan(0);
});
it('reinspects partial camera success without replaying either mutation', async () => {
 const { model, api, session } = fixture(); await model.load();
 vi.mocked(api.cameraSelect).mockImplementationOnce(async params => session.selectCamera(params));
 vi.mocked(api.cameraSelect).mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', message: 'Preview unavailable', ids: [] } });
 expect(await model.selectCamera('camera_close')).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
 expect(api.cameraSelect).toHaveBeenCalledTimes(2);
 expect(model.read()).toMatchObject({ error: 'UNAVAILABLE', pending: false, scene: { revision: 1 } });
 expect(model.read().scene).toEqual(session.inspect());
 expect((await model.setVisibility('marker', false)).ok).toBe(true);
 expect(api.scenePatch).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 1 }));
});
it('clears recovered inspection errors while preserving conflict indication', async () => {
 const { model, api, session } = fixture(); await model.load();
 vi.mocked(api.sceneInspect).mockResolvedValueOnce({ ok: false, error: { code: 'UNAVAILABLE', message: 'Disconnected', ids: [] } });
 await model.load(); expect(model.read().error).toBe('UNAVAILABLE');
 await model.load(); expect(model.read().error).toBeNull();
 session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setVisibility', entityId: 'marker', visible: false }] });
 await model.setVisibility('marker', true); await model.load(); expect(model.read().error).toBe('CONFLICT');
});

it('commits a complete validated transform and clears selection', async () => {
 const { model, api } = fixture(); await model.load(); model.select('marker');
 const transform = { position: [1, 2, 3] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [2, 2, 2] as [number, number, number] };
 expect((await model.setTransform('marker', transform, 0)).ok).toBe(true);
 expect(model.read().scene?.entities.find(e => e.id === 'marker')?.transform).toEqual(transform);
 model.clearSelection(); expect(model.read().selectedId).toBeNull();
 const count = vi.mocked(api.scenePatch).mock.calls.length;
 expect(await model.setTransform('marker', { ...transform, scale: [0, 1, 1] })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(api.scenePatch).toHaveBeenCalledTimes(count);
});
it('rejects a gesture revision after a refresh instead of replacing it with the latest revision', async () => {
 const { model, api, session } = fixture(); await model.load();
 const transform = model.read().scene!.entities.find(e => e.id === 'marker')!.transform;
 session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setVisibility', entityId: 'marker', visible: false }] });
 await model.load();
 expect(await model.setTransform('marker', transform, 0)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
 expect(api.scenePatch).not.toHaveBeenCalled(); expect(model.read().error).toBe('CONFLICT');
});
