import { expect, it } from 'vitest';
import { makeSmokeScene, ShowDocumentSchema, type SceneEntity } from '@opensekai/contracts';
import { createSession } from '../src/session';

const start = () => createSession(makeSmokeScene(), 's');
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const setValues = (s: ReturnType<typeof start>, materials: unknown, entityId = 'performer') => s.applyPatch(patch(s.inspect().revision, [{ kind: 'setMaterialValues', entityId, materials }]));
const entity = (s: ReturnType<typeof start>, id: string) => s.inspect().entities.find(item => item.id === id) as SceneEntity & { materials?: unknown };
const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const lamp = { id: 'lamp', name: 'Lamp', visible: true, transform, kind: 'light', light: { type: 'point', color: '#ffffff', intensity: 20, range: 10, affectCharacters: true, affectProps: true, affectEnvironment: true, shadow: { enabled: false, intensity: 1, soft: true, bias: -0.0005, normalBias: 0.02 } } };

it('replaces the group with one revision, and {} removes the field (R20)', () => {
 const s = start();
 expect(setValues(s, { Body: { baseColor: '#ff0000' }, Hair: { opacity: 0.5 } })).toEqual({ ok: true, data: { revision: 1 } });
 expect(setValues(s, { Body: { rimColor: '#00ff00' } })).toEqual({ ok: true, data: { revision: 2 } });
 expect(entity(s, 'performer').materials).toEqual({ Body: { rimColor: '#00ff00' } });
 expect(setValues(s, {})).toEqual({ ok: true, data: { revision: 3 } });
 expect('materials' in entity(s, 'performer')).toBe(false);
 // A prop takes the op with a box source or an asset source.
 expect(setValues(s, { Wall: { emissionStrength: 3 } }, 'reference').ok).toBe(true);
 expect(setValues(s, { Box: { baseColor: '#000000' } }, 'marker').ok).toBe(true);
 expect(entity(s, 'reference').materials).toEqual({ Wall: { emissionStrength: 3 } });
});

it('rejects another entity kind, a missing entity, and invalid values', () => {
 const s = start();
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: lamp }])).ok).toBe(true);
 const noMaterials = { ok: false, error: { code: 'INVALID_INPUT', message: 'Entity has no materials', ids: ['lamp'] } };
 expect(setValues(s, { Body: { opacity: 1 } }, 'lamp')).toEqual(noMaterials);
 expect(setValues(s, { Body: { opacity: 1 } }, 'camera_wide')).toMatchObject({ ok: false, error: { message: 'Entity has no materials' } });
 expect(setValues(s, { Body: { opacity: 1 } }, 'nobody')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(setValues(s, { Body: { opacity: 2 } })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.inspect().revision).toBe(1);
});

it('keeps the group through a model change of a character and a prop (R21)', () => {
 const s = start();
 setValues(s, { Body: { baseColor: '#123456' } });
 setValues(s, { Wall: { baseColor: '#654321' } }, 'marker');
 expect(s.applyPatch(patch(s.inspect().revision, [{ kind: 'setAvatarModel', entityId: 'performer', assetId: 'other_model' }, { kind: 'setMeshModel', entityId: 'marker', assetId: 'scene_other' }])).ok).toBe(true);
 expect(entity(s, 'performer').materials).toEqual({ Body: { baseColor: '#123456' } });
 expect(entity(s, 'marker').materials).toEqual({ Wall: { baseColor: '#654321' } });
});

it('stores no field for createEntity with an empty group', () => {
 const s = start();
 const avatar = { ...makeSmokeScene().entities.find(item => item.id === 'performer')!, id: 'second', materials: {} };
 expect(s.applyPatch(patch(0, [{ kind: 'createEntity', entity: avatar }])).ok).toBe(true);
 expect('materials' in entity(s, 'second')).toBe(false);
});

it('keeps the group through a show save and open', () => {
 const s = start();
 setValues(s, { Body: { baseColor: '#ff8000', outlineWidth: 0.01 }, ['__proto__']: { opacity: 0.25 } });
 setValues(s, { Wall: { emissionColor: '#102030' } }, 'reference');
 const saved = JSON.stringify({ schemaVersion: 1, name: 'Concert', scene: s.inspect(), blueprints: [] });
 const opened = ShowDocumentSchema.parse(JSON.parse(saved));
 const next = start();
 expect(next.replaceScene(opened.scene, 0).ok).toBe(true);
 expect(entity(next, 'performer').materials).toEqual({ Body: { baseColor: '#ff8000', outlineWidth: 0.01 }, ['__proto__']: { opacity: 0.25 } });
 expect(Object.keys(entity(next, 'performer').materials as object)).toEqual(['Body', '__proto__']);
 expect(entity(next, 'reference').materials).toEqual({ Wall: { emissionColor: '#102030' } });
});
