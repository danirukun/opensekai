import { expect, it } from 'vitest';
import { SceneEntitySchema, type AssetRecord } from '@opensekai/contracts';
import { addLimitReached, importFailure, makeAuthoringEntity, makeEmptyScene } from '../src/editor/authoring';
import { settleCheckbox } from '../src/editor/live-fields';
import { IMPORT_SCENE, creditLine, sceneSourceOptions, sourceAction } from '../src/editor/environment';
const record = (id: string, name: string): AssetRecord => ({ id, format: 'glb', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: '', importerVersion: 1, name, expressions: [] });
it('creates an environment without a model', () => {
    const entity = makeAuthoringEntity('environment', 'stage', makeEmptyScene().entities);
    expect(SceneEntitySchema.safeParse(entity).success).toBe(true);
    expect(entity).toMatchObject({ kind: 'environment', name: 'Environment', assetId: null, visible: true });
});
it('writes the CC credit line of the sample room', () => {
    expect(creditLine({ title: 'Anime stylized room free', sourceUrl: 'https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d', author: 'CG Lads (https://sketchfab.com/CGlads)', license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)' }))
        .toBe('This work is based on "Anime stylized room free" (https://sketchfab.com/3d-models/anime-stylized-room-free-223df82515de41e684720e2eaa02e93d) by CG Lads (https://sketchfab.com/CGlads) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)');
    expect(creditLine({ title: 'Room', sourceUrl: null, author: null, license: 'CC0' })).toBe('This work is based on "Room" licensed under CC0');
    expect(creditLine({ title: null, sourceUrl: null, author: null, license: null })).toBeNull();
});
it('lists scene assets, a missing model, and the import action', () => {
    const assets = [record('scene_a', 'Room'), record('avatar_b', 'Rem')];
    expect(sceneSourceOptions(null, assets)).toEqual([{ value: '', label: 'Choose model…' }, { value: 'scene_a', label: 'Room' }, { value: IMPORT_SCENE, label: 'Import file…' }]);
    expect(sceneSourceOptions('scene_gone', assets).map(o => o.label)).toEqual(['Choose model…', 'Room', 'Missing model', 'Import file…']);
});
it('maps a Source value to an action', () => {
    expect(sourceAction(IMPORT_SCENE)).toEqual({ kind: 'import' });
    expect(sourceAction('')).toEqual({ kind: 'select', assetId: null });
    expect(sourceAction('scene_a')).toEqual({ kind: 'select', assetId: 'scene_a' });
});
it('disables Add › Environment while the scene has an environment', () => {
    const scene = makeEmptyScene().entities;
    expect(addLimitReached('environment', scene)).toBe(false);
    expect(addLimitReached('environment', [...scene, makeAuthoringEntity('environment', 'stage', scene)])).toBe(true);
});
it('shows the scene import error, cut to 160 characters, or a safe fallback', () => {
    expect(importFailure({ code: 'INVALID_INPUT', message: 'x'.repeat(200), ids: [] }, 'Could not import model')).toBe('x'.repeat(160));
    expect(importFailure(new Error('private path'), 'Could not import model')).toBe('Could not import model');
});
it('shows the scene value again when the Render Environment change fails', () => {
    const box = { checked: false };
    settleCheckbox(box, { ok: false, error: { code: 'CONFLICT', message: 'stale', ids: [] } }, true);
    expect(box.checked).toBe(true);
    const kept = { checked: false };
    settleCheckbox(kept, { ok: true, data: {} }, true);
    expect(kept.checked).toBe(false);
});
