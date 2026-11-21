import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetMaterial, type AssetRecord, type SceneEntity, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { sessionApi } from '../src/session-api';

const material = (index: number, name: string, extra: Partial<AssetMaterial> = {}): AssetMaterial => ({ index, name, profile: 'pbr', blend: false, outline: false, model: { baseColor: '#ffffff', emissionColor: '#000000', emissionStrength: 1 }, ...extra });
const base = { sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1 as const, expressions: [] };
const avatar: AssetRecord = { ...base, id: 'fixture_vrm_1', format: 'vrm', name: 'Rem', materials: [
 material(0, 'Skin', { profile: 'mtoon', outline: true, model: { baseColor: '#ffeeee', emissionColor: '#000000', emissionStrength: 1, shadeColor: '#ff0000', rimColor: '#000000', outlineColor: '#000000', outlineWidth: 0.01 } }),
 material(1, 'Hair', { blend: true, model: { baseColor: '#000000', opacity: 0.5, emissionColor: '#000000', emissionStrength: 1 } }),
] };
const prop: AssetRecord = { ...base, id: 'fixture_glb_1', format: 'glb', name: 'Room', materials: [material(0, 'Floor', { profile: 'unlit', model: { baseColor: '#808080' } })] };
const start = (records: AssetRecord[] = [avatar, prop], scene: SceneView = makeSmokeScene()) => createSession(scene, 's', records);
const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const lamp = { id: 'lamp', name: 'Lamp', visible: true, transform, kind: 'light', light: { type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } } } as SceneEntity;

it('lists the materials of a character in record order with the parameters that apply', async () => {
 expect(await sessionApi(start()).materialList({ entityId: 'performer' })).toEqual({ ok: true, data: { materials: [
  { name: 'Skin', profile: 'mtoon', parameters: [
   { parameter: 'baseColor', model: '#ffeeee' }, { parameter: 'emissionColor', model: '#000000' }, { parameter: 'emissionStrength', model: 1 },
   { parameter: 'shadeColor', model: '#ff0000' }, { parameter: 'rimColor', model: '#000000' }, { parameter: 'outlineColor', model: '#000000' }, { parameter: 'outlineWidth', model: 0.01 },
  ] },
  { name: 'Hair', profile: 'pbr', parameters: [
   { parameter: 'baseColor', model: '#000000' }, { parameter: 'opacity', model: 0.5 }, { parameter: 'emissionColor', model: '#000000' }, { parameter: 'emissionStrength', model: 1 },
  ] },
 ], unknown: [] } });
});

it('lists the materials of a prop with an asset source', () => {
 expect(start().materialList('reference')).toEqual({ ok: true, data: { materials: [{ name: 'Floor', profile: 'unlit', parameters: [{ parameter: 'baseColor', model: '#808080' }] }], unknown: [] } });
});

it('adds the saved value of each parameter and the saved names that the record does not have (R30)', () => {
 const s = start();
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setMaterialValues', entityId: 'performer', materials: { Cape: { baseColor: '#00ff00' }, Hair: { opacity: 1 } } }] } as never).ok).toBe(true);
 const list = s.materialList('performer');
 if (!list.ok) throw new Error('no list');
 expect(list.data.materials[1]!.parameters.find(view => view.parameter === 'opacity')).toEqual({ parameter: 'opacity', model: 0.5, value: 1 });
 expect(list.data.materials[0]!.parameters.every(view => !('value' in view))).toBe(true);
 expect(list.data.unknown).toEqual(['Cape']);
});

it('fails for an unknown entity, another kind, and an entity without a model', () => {
 const s = start();
 expect(s.materialList('nobody')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Entity not found', ids: ['nobody'] } });
 const noMaterials = { ok: false, error: { code: 'INVALID_INPUT', message: 'Entity has no materials' } };
 expect(s.materialList('camera_wide')).toMatchObject(noMaterials);
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'createEntity', entity: lamp }] } as never).ok).toBe(true);
 expect(s.materialList('lamp')).toMatchObject(noMaterials);
 // A box prop, a character without a model, a record without a list, and a model ID without a record.
 expect(s.materialList('marker')).toMatchObject(noMaterials);
 expect(s.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 1, operations: [{ kind: 'setAvatarModel', entityId: 'performer', assetId: null }] } as never).ok).toBe(true);
 expect(s.materialList('performer')).toMatchObject(noMaterials);
 const { materials: _, ...old } = avatar;
 expect(start([old, prop]).materialList('performer')).toMatchObject(noMaterials);
 expect(start([prop]).materialList('performer')).toMatchObject(noMaterials);
});
