import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetRecord, type BlueprintGraph, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { sessionApi } from '../src/session-api';

const record: AssetRecord = {
 id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1, name: 'Rem',
 expressions: [], meshes: [{ node: 3, name: 'Body' }, { node: 4, name: 'Face' }, { node: 5, name: 'Hair' }],
};
const start = (scene: SceneView = makeSmokeScene(), records: AssetRecord[] = [record]) => createSession(scene, 's', records);
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const hide = (s: ReturnType<typeof start>, hiddenMeshes: string[], entityId = 'performer') => s.applyPatch(patch(s.inspect().revision, [{ kind: 'setHiddenMeshes', entityId, hiddenMeshes }]));
const hidden = (s: ReturnType<typeof start>) => { const avatar = s.inspect().entities.find(item => item.id === 'performer'); return avatar?.kind === 'avatar' ? avatar.hiddenMeshes : 'none'; };

const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: unknown = {}, inputs?: unknown) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const graph = (nodes: unknown[], connections: unknown[]) => ({ schemaVersion: 1, id: 'outfit', name: 'Outfit', enabled: true, variables: [], nodes, connections } as unknown as BlueprintGraph);
const load = (s: ReturnType<typeof start>, nodes: unknown[], connections: unknown[]) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs: [graph(nodes, connections)] }] });

it('replaces the hidden list with one revision, and an empty list removes the field', () => {
 const s = start();
 expect(hide(s, ['Hair', 'Tail'])).toEqual({ ok: true, data: { revision: 1 } });
 expect(hidden(s)).toEqual(['Hair', 'Tail']);
 expect(hide(s, [])).toEqual({ ok: true, data: { revision: 2 } });
 expect(hidden(s)).toBeUndefined();
 expect('hiddenMeshes' in s.inspect().entities.find(item => item.id === 'performer')!).toBe(false);
});

it('rejects the op on a missing entity and on another kind', () => {
 const s = start();
 expect(hide(s, ['Hair'], 'nobody')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found' } });
 expect(hide(s, ['Hair'], 'camera_wide')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity is not an avatar' } });
 expect(s.inspect().revision).toBe(0);
});

it('stores no field for createEntity with an empty list', () => {
 const s = start();
 const avatar = { ...makeSmokeScene().entities.find(item => item.id === 'performer')!, id: 'second', hiddenMeshes: [] };
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: avatar }])).ok).toBe(true);
 expect('hiddenMeshes' in s.inspect().entities.find(item => item.id === 'second')!).toBe(false);
});

it('keeps unknown names through a model change', () => {
 const s = start();
 hide(s, ['Hair', 'Tail']);
 expect(s.applyPatch(patch(1, [{ kind: 'setAvatarModel', entityId: 'performer', assetId: null }])).ok).toBe(true);
 expect(hidden(s)).toEqual(['Hair', 'Tail']);
});

it('answers meshList with the state and the unknown names', async () => {
 const s = start();
 const api = sessionApi(s);
 hide(s, ['Tail', 'Hair']);
 expect(await api.meshList({ avatarId: 'performer' })).toEqual({ ok: true, data: { meshes: [{ name: 'Body', hidden: false }, { name: 'Face', hidden: false }, { name: 'Hair', hidden: true }], unknown: ['Tail'] } });
 expect(s.meshList('nobody')).toMatchObject({ ok: false, error: { message: 'Entity not found' } });
 expect(s.meshList('marker')).toMatchObject({ ok: false, error: { message: 'Entity is not an avatar' } });
 expect(start(makeSmokeScene(), []).meshList('performer')).toMatchObject({ ok: false, error: { message: 'Asset has no mesh list' } });
 const { meshes: _, ...old } = record;
 expect(start(makeSmokeScene(), [old]).meshList('performer')).toMatchObject({ ok: false, error: { message: 'Asset has no mesh list' } });
});

it('toggles meshes from a Blueprint run, and a second run restores the list', () => {
 const s = start();
 expect(load(s, [node('run', 'event.manual'), node('toggle', 'character.toggleMeshes', { entityId: 'performer', meshes: ['Hair', 'Face'] })], [wire('a', 'run', 'flow', 'toggle', 'flow')]).ok).toBe(true);
 expect(s.runBlueprint('outfit', 'run')).toEqual({ ok: true, data: { revision: 1 } });
 expect(hidden(s)).toEqual(['Hair', 'Face']);
 expect(s.runBlueprint('outfit', 'run')).toEqual({ ok: true, data: { revision: 2 } });
 expect(hidden(s)).toBeUndefined();
});

it('commits one revision with the final list for two mesh nodes in one run', () => {
 const s = start();
 hide(s, ['Body']);
 expect(load(s, [
  node('run', 'event.manual'),
  node('toggle', 'character.toggleMeshes', { entityId: 'performer', meshes: ['Hair'] }),
  node('show', 'character.setMeshesVisible', { entityId: 'performer', meshes: ['Body'] }),
  node('hide', 'character.setMeshesVisible', { entityId: 'performer', meshes: ['Face'] }, { visible: false }),
 ], [wire('a', 'run', 'flow', 'toggle', 'flow'), wire('b', 'toggle', 'exit', 'show', 'flow'), wire('c', 'show', 'exit', 'hide', 'flow')]).ok).toBe(true);
 expect(s.runBlueprint('outfit', 'run')).toEqual({ ok: true, data: { revision: 2 } });
 expect(hidden(s)).toEqual(['Hair', 'Face']);
});

it('commits nothing for a run that changes nothing', () => {
 const s = start();
 expect(load(s, [node('run', 'event.manual'), node('show', 'character.setMeshesVisible', { entityId: 'performer', meshes: ['Hair'] })], [wire('a', 'run', 'flow', 'show', 'flow')]).ok).toBe(true);
 expect(s.runBlueprint('outfit', 'run')).toEqual({ ok: true, data: { revision: 0 } });
 expect(hidden(s)).toBeUndefined();
});

it('fails a run whose character is missing or is not an avatar, with no state change', () => {
 for (const [entityId, message] of [['nobody', 'Entity not found'], ['marker', 'Entity is not an avatar']]) {
  const s = start();
  expect(load(s, [
   node('run', 'event.manual'),
   node('flip', 'scene.toggleVisibility', { entityId: 'performer' }),
   node('toggle', 'character.toggleMeshes', { entityId, meshes: ['Hair'] }),
  ], [wire('a', 'run', 'flow', 'flip', 'flow'), wire('b', 'flip', 'exit', 'toggle', 'flow')]).ok).toBe(true);
  expect(s.runBlueprint('outfit', 'run')).toMatchObject({ ok: false, error: { message } });
  expect(s.inspect().revision).toBe(0);
  expect(s.inspect().entities.find(item => item.id === 'performer')?.visible).toBe(true);
 }
});
