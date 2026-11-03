import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/mesh-names.json';
import { meshEntries, meshList, nodeDefinition, setMeshesVisible, toggleMeshes } from '../src';

for (const vector of vectors.cases)
 it(`mesh name vector: ${vector.name}`, () => {
  expect(meshEntries({ nodes: vector.nodes })).toEqual(vector.expected);
 });

it('reads no meshes from a document without nodes', () => {
 expect(meshEntries({})).toEqual([]);
 expect(meshEntries(null)).toEqual([]);
});

it('toggles each listed name and keeps the order of the current list', () => {
 expect(toggleMeshes(['Hat', 'Hair'], ['Hair', 'Jacket'])).toEqual(['Hat', 'Jacket']);
 expect(toggleMeshes(toggleMeshes([], ['Hair', 'Hat']), ['Hair', 'Hat'])).toEqual([]);
 expect(toggleMeshes([], ['Hair', 'Hair'])).toEqual(['Hair']);
 expect(toggleMeshes(['Hair'], ['Hair', 'Hair'])).toEqual([]);
});

it('sets listed names visible or hidden', () => {
 expect(setMeshesVisible(['Hat', 'Hair'], ['Hair', 'Tail'], true)).toEqual(['Hat']);
 expect(setMeshesVisible(['Hat'], ['Hair', 'Hat', 'Hair'], false)).toEqual(['Hat', 'Hair']);
 expect(setMeshesVisible([], ['Hair'], true)).toEqual([]);
});

it('lists the record meshes with their state and the unknown hidden names', () => {
 const meshes = [{ node: 0, name: 'Body' }, { node: 2, name: 'Hair' }];
 expect(meshList(meshes, ['Tail', 'Hair'])).toEqual({ meshes: [{ name: 'Body', hidden: false }, { name: 'Hair', hidden: true }], unknown: ['Tail'] });
 expect(meshList(meshes)).toEqual({ meshes: [{ name: 'Body', hidden: false }, { name: 'Hair', hidden: false }], unknown: [] });
});

it('defines the two mesh nodes with 1 to 16 unique names', () => {
 const toggle = nodeDefinition('character.toggleMeshes')!;
 expect(toggle.label).toBe('Toggle Character Meshes');
 expect(toggle.defaults({ avatarId: 'performer', mesh: 'Hair', keystroke: { code: 'KeyJ', control: true, shift: true, alt: false, meta: false } })).toEqual({ entityId: 'performer', meshes: ['Hair'] });
 expect(toggle.defaults({ avatarId: 'performer' } as never)).toBeNull();
 expect(toggle.settings.safeParse({ entityId: 'a', meshes: [] }).success).toBe(false);
 expect(toggle.settings.safeParse({ entityId: 'a', meshes: ['Hair', 'Hair'] }).success).toBe(false);
 expect(toggle.settings.safeParse({ entityId: 'a', meshes: Array.from({ length: 17 }, (_, i) => `m${i}`) }).success).toBe(false);
 const set = nodeDefinition('character.setMeshesVisible')!;
 expect(set.ports({ entityId: 'a', meshes: ['Hair'] })).toEqual({ inputs: { flow: 'flow', visible: 'boolean' }, outputs: { exit: 'flow' } });
 expect(set.inputDefaults).toEqual({ visible: true });
});

// The fixture VRMs are in fixtures/local only after `pnpm fixtures`.
const glbJson = (path: string) => {
 const bytes = readFileSync(path);
 const length = bytes.readUInt32LE(12);
 return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as unknown;
};
const manifest = new URL('../../../fixtures/local/manifest.json', import.meta.url);
it.skipIf(!existsSync(manifest))('reads the mesh names of the fixture VRMs', () => {
 const assets = (JSON.parse(readFileSync(manifest, 'utf8')) as { assets: { path: string; record: { id: string } }[] }).assets;
 const names = (id: string) => meshEntries(glbJson(assets.find(asset => asset.record.id === id)!.path)).map(entry => entry.name);
 expect(names('fixture_vrm_1')).toEqual(['Body', 'Face', 'Hair']);
 expect(names('fixture_vrm0_arkit')).toHaveLength(57);
});
