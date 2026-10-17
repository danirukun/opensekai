import { expect, it, vi } from 'vitest';
import { makeSmokeScene, type Reply, type SceneView } from '@opensekai/contracts';
import { openShowDocument, showDirty } from '../src/editor/show-management';

const document = () => ({ schemaVersion: 1, name: 'Live', scene: makeSmokeScene(), blueprints: [] });
it('adopts a validated show only after scene replacement succeeds', async () => {
 const adopted = vi.fn();
 const conflict: Reply<SceneView> = { ok: false, error: { code: 'CONFLICT', message: 'Changed', ids: [] } };
 const replace = vi.fn(async () => conflict);
 expect(await openShowDocument(document(), replace, adopted)).toBe(conflict);
 expect(adopted).not.toHaveBeenCalled();
 replace.mockImplementationOnce(async () => ({ ok: true, data: makeSmokeScene() }));
 expect((await openShowDocument(document(), replace, adopted)).ok).toBe(true);
 expect(adopted).toHaveBeenCalledOnce();
});

it('rejects invalid show files before touching the live scene', async () => {
 const replace = vi.fn();
 await expect(openShowDocument({ ...document(), schemaVersion: 2 }, replace, vi.fn())).rejects.toThrow();
 expect(replace).not.toHaveBeenCalled();
});

it('marks the show unsaved when the scene, Blueprints, or name move from the saved mark', () => {
 const saved = { name: 'Live', revision: 4, blueprintRevision: 2 };
 expect(showDirty(saved, saved)).toBe(false);
 expect(showDirty(saved, { ...saved, revision: 5 })).toBe(true);
 expect(showDirty(saved, { ...saved, blueprintRevision: 3 })).toBe(true);
 expect(showDirty(saved, { ...saved, name: 'Encore' })).toBe(true);
 expect(showDirty(null, { ...saved, revision: 5 })).toBe(false);
 expect(showDirty(saved, { ...saved, revision: null })).toBe(false);
});
