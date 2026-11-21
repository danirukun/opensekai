import { expect, it } from 'vitest';
import { hexLinear, linearHex, makeSmokeScene, mixHex, type AssetMaterial, type AssetRecord, type SceneEntity, type SceneView } from '@opensekai/contracts';
import { applyOverrides, dropOverrides, EMPTY_OVERRIDES, materialKey, parseMaterialKey, resolveMaterialWrite, takeIdle, type MaterialWrite } from '../src/overrides';
import { advanceTweens, dropTweens, EMPTY_TWEENS, tweening, writeTransitioned, type PropertyLayers, type TransitionEnd } from '../src/tweens';

// B38 R24–R27: material writes go through the override layer, with transitions, and commit as one group.
const scene = makeSmokeScene();
const ok = <T>(reply: { ok: true; data: T } | { ok: false; error?: unknown }): T => { if (!reply.ok) throw new Error(JSON.stringify(reply.error)); return reply.data; };
const EMPTY: PropertyLayers = { overrides: EMPTY_OVERRIDES, tweens: EMPTY_TWEENS };
const material = (name: string, profile: AssetMaterial['profile'], model: AssetMaterial['model'], blend = false, outline = false): AssetMaterial => ({ index: 0, name, profile, blend, outline, model });
const records: Record<string, Partial<AssetRecord>> = {
 fixture_vrm_1: { materials: [material('Body', 'mtoon', { baseColor: '#ff0000', shadeColor: '#800000' }, true, true), material('Face', 'unlit', { baseColor: '#ffffff' })] },
 fixture_glb_1: { materials: [material('Wall', 'pbr', { emissionStrength: 1 })] },
};
const record = (assetId: string) => records[assetId] as AssetRecord | undefined;
const write = (fields: Partial<MaterialWrite>): MaterialWrite => ({ kind: 'setMaterial', entityId: 'performer', target: 'avatar', material: 'Body', parameter: 'baseColor', value: '#00ff00', ...fields });
const resolved = (fields: Partial<MaterialWrite>, s: SceneView = scene) => ok(resolveMaterialWrite(s, write(fields), record));
const set = (layers: PropertyLayers, fields: Partial<MaterialWrite>, at = 0, end?: TransitionEnd) => ok(writeTransitioned(layers, scene, resolved(fields), 'g', at, at, end));
const materialsAt = (layers: PropertyLayers, id = 'performer') => (applyOverrides(scene, layers.overrides).entities.find(e => e.id === id) as SceneEntity & { materials?: unknown }).materials;
const linear = { seconds: 1, easing: 'Linear' as const };

it('mixes colors in linear light and keeps each byte through a round trip', () => {
 for (let byte = 0; byte < 256; byte++) {
  const hex = `#${byte.toString(16).padStart(2, '0').repeat(3)}`;
  expect(linearHex(hexLinear(hex))).toBe(hex);
 }
 expect(mixHex('#ff0000', '#0000ff', 0)).toBe('#ff0000');
 expect(mixHex('#ff0000', '#0000ff', 1)).toBe('#0000ff');
 // Half of white and black in linear light is 0.5, which is #bcbcbc in sRGB, not #808080.
 expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#bcbcbc');
});

it('encodes the parameter first, so a name with a colon parses', () => {
 const key = materialKey('rimColor', 'a:b');
 expect(key).toBe('material:rimColor:a:b');
 expect(parseMaterialKey(key)).toEqual({ parameter: 'rimColor', name: 'a:b' });
 expect(parseMaterialKey('position')).toBeNull();
});

it('checks the target, the material, and the parameter, and clamps a number (R24)', () => {
 const error = (fields: Partial<MaterialWrite>) => { const reply = resolveMaterialWrite(scene, write(fields), record); return reply.ok ? null : reply.error; };
 expect(error({ entityId: 'nobody' })).toMatchObject({ code: 'NOT_FOUND' });
 expect(error({ entityId: 'reference' })).toMatchObject({ message: 'Entity is not an avatar' });
 expect(error({ entityId: 'performer', target: 'mesh' })).toMatchObject({ message: 'Entity is not a prop' });
 expect(error({ material: 'Hair' })).toMatchObject({ message: 'Material not found' });
 // The box prop has no record, so it has no material.
 expect(error({ entityId: 'marker', target: 'mesh', material: 'Wall' })).toMatchObject({ message: 'Material not found' });
 expect(error({ material: 'Face', parameter: 'rimColor' })).toMatchObject({ message: 'Material property does not apply' });
 expect(error({ material: 'Face', parameter: 'opacity', value: 0.5 })).toMatchObject({ message: 'Material property does not apply' });
 expect(error({ parameter: 'baseColor', value: 3 })).toMatchObject({ message: 'Invalid material value' });
 expect(resolved({ parameter: 'opacity', value: 4 })).toMatchObject({ value: 1, model: 1 });
 expect(resolved({ parameter: 'outlineWidth', value: -1 })).toMatchObject({ value: 0, model: 0 });
 expect(resolved({ parameter: 'shadeColor', value: null })).toMatchObject({ value: null, model: '#800000' });
 expect(resolved({ entityId: 'reference', target: 'mesh', material: 'Wall', parameter: 'emissionStrength', value: 2 })).toMatchObject({ model: 1 });
});

it('writes at once, commits the idle keys of an entity as one group, and a Reset removes the value (R25)', () => {
 let layers = set(EMPTY, { value: '#00ff00' });
 layers = set(layers, { parameter: 'opacity', value: 0.5 });
 expect(materialsAt(layers)).toEqual({ Body: { baseColor: '#00ff00', opacity: 0.5 } });
 expect(takeIdle(scene, layers.overrides, 100).operations).toEqual([]);
 const idle = takeIdle(scene, layers.overrides, 250);
 expect(idle.operations).toEqual([{ kind: 'setMaterialValues', entityId: 'performer', materials: { Body: { baseColor: '#00ff00', opacity: 0.5 } } }]);
 expect(idle.remaining.size).toBe(0);
 const saved = { ...scene, entities: scene.entities.map(e => e.id === 'performer' ? { ...e, materials: { Body: { baseColor: '#00ff00', opacity: 0.5 } } } : e) } as SceneView;
 const reset = ok(writeTransitioned(EMPTY, saved, resolved({ value: null }, saved), 'g', 0));
 expect(takeIdle(saved, reset.overrides, 250).operations).toEqual([{ kind: 'setMaterialValues', entityId: 'performer', materials: { Body: { opacity: 0.5 } } }]);
 const last = ok(writeTransitioned(reset, saved, resolved({ parameter: 'opacity', value: null }, saved), 'g', 0));
 expect(takeIdle(saved, last.overrides, 250).operations).toEqual([{ kind: 'setMaterialValues', entityId: 'performer', materials: {} }]);
 // A Reset of a value that is not saved changes nothing.
 expect(set(EMPTY, { value: null }).overrides.size).toBe(0);
});

it('runs a color transition from the model value in linear light and ends on the exact target (R25)', () => {
 let layers = set(EMPTY, { value: '#0000ff', transition: linear }, 1000);
 expect(tweening(layers.tweens, 'performer', materialKey('baseColor', 'Body'))).toBe(true);
 layers = advanceTweens(layers, scene, 1500).layers;
 expect(materialsAt(layers)).toEqual({ Body: { baseColor: mixHex('#ff0000', '#0000ff', 0.5) } });
 // The key waits for the tween before it commits.
 expect(takeIdle(scene, layers.overrides, 5000, (id, key) => tweening(layers.tweens, id, key)).operations).toEqual([]);
 const done = advanceTweens(layers, scene, 2000);
 expect(materialsAt(done.layers)).toEqual({ Body: { baseColor: '#0000ff' } });
 expect(done.layers.tweens.size).toBe(0);
});

it('runs a number transition, and a Reset transition ends with no saved value (R25)', () => {
 const saved = { ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, materials: { Wall: { emissionStrength: 5 } } } : e) } as SceneView;
 const prop = { entityId: 'reference', target: 'mesh' as const, material: 'Wall', parameter: 'emissionStrength' as const };
 let layers = ok(writeTransitioned(EMPTY, saved, ok(resolveMaterialWrite(saved, write({ ...prop, value: null, transition: linear }), record)), 'g', 0));
 layers = advanceTweens(layers, saved, 500).layers;
 const at = (l: PropertyLayers) => (applyOverrides(saved, l.overrides).entities.find(e => e.id === 'reference') as { materials?: unknown }).materials;
 expect(at(layers)).toEqual({ Wall: { emissionStrength: 3 } });
 const done = advanceTweens(layers, saved, 1000).layers;
 expect(at(done)).toBeUndefined();
 expect(takeIdle(saved, done.overrides, 2000).operations).toEqual([{ kind: 'setMaterialValues', entityId: 'reference', materials: {} }]);
});

it('joins a running tween to the same target, replaces one to another target, and writes at once with no change (R25)', () => {
 const end = (nodeId: string): TransitionEnd => ({ graphId: 'g', nodeId, logic: 'l' });
 let layers = set(EMPTY, { value: '#0000ff', transition: linear }, 0, end('a'));
 layers = set(layers, { value: '#0000ff', transition: linear }, 500, end('b'));
 const key = `performer\0${materialKey('baseColor', 'Body')}`;
 expect(layers.tweens.get(key)?.ends.map(item => item.nodeId)).toEqual(['a', 'b']);
 expect(layers.tweens.get(key)?.startMs).toBe(0);
 layers = advanceTweens(layers, scene, 500).layers;
 layers = set(layers, { value: '#00ff00', transition: linear }, 500, end('c'));
 expect(layers.tweens.get(key)).toMatchObject({ startMs: 500, ends: [end('c')], value: { from: mixHex('#ff0000', '#0000ff', 0.5), to: '#00ff00' } });
 // A target equal to the evaluated value (here the model value, with nothing saved) starts no tween and writes no override;
 // its end runs on the next step.
 const same = set(EMPTY, { value: '#ff0000', transition: linear }, 0, end('d'));
 expect(same.tweens.size).toBe(0);
 expect(same.overrides.size).toBe(0);
 expect(same.pending).toEqual([end('d')]);
});

it('writes no override for a Set that keeps the evaluated value, and a Reset always removes the key (R25)', () => {
 // A Set to the model value with nothing saved.
 expect(set(EMPTY, { value: '#ff0000' }).overrides.size).toBe(0);
 // A Set to the saved value writes nothing. A Reset of a saved value equal to the model value removes the key at once, also
 // with a transition.
 const saved = { ...scene, entities: scene.entities.map(e => e.id === 'performer' ? { ...e, materials: { Body: { baseColor: '#ff0000', opacity: 0.5 } } } : e) } as SceneView;
 const at = (fields: Partial<MaterialWrite>) => ok(writeTransitioned(EMPTY, saved, resolved(fields, saved), 'g', 0)).overrides.size;
 expect(at({ parameter: 'opacity', value: 0.5 })).toBe(0);
 const reset = ok(writeTransitioned(EMPTY, saved, resolved({ value: null, transition: linear }, saved), 'g', 0));
 expect(reset.tweens.size).toBe(0);
 expect(takeIdle(saved, reset.overrides, 250).operations).toEqual([{ kind: 'setMaterialValues', entityId: 'performer', materials: { Body: { opacity: 0.5 } } }]);
 expect(at({ parameter: 'opacity', value: null })).toBe(1);
 // A Set to the model value over a pending override of another value writes it.
 const pending = set(EMPTY, { value: '#00ff00' });
 expect(materialsAt(set(pending, { value: '#ff0000' }))).toEqual({ Body: { baseColor: '#ff0000' } });
});

it('refuses a write that gives more than 256 material names (R25)', () => {
 const full = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`Old ${i}`, { baseColor: '#000000' }]));
 const crowded = { ...scene, entities: scene.entities.map(e => e.id === 'performer' ? { ...e, materials: full } : e) } as SceneView;
 const reply = writeTransitioned(EMPTY, crowded, resolved({}, crowded), 'g', 0);
 expect(reply).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Too many materials', ids: ['performer'] } });
});

it('drops material overrides and tweens on a setMaterialValues or a model change (R27)', () => {
 let layers = set(EMPTY, { value: '#0000ff', transition: linear });
 layers = set(layers, { parameter: 'opacity', value: 0.5 });
 for (const operation of [{ kind: 'setMaterialValues', entityId: 'performer', materials: {} }, { kind: 'setAvatarModel', entityId: 'performer', assetId: 'other' }] as const) {
  expect(dropOverrides(layers.overrides, [operation]).size).toBe(0);
  expect(dropTweens(layers.tweens, [operation]).size).toBe(0);
 }
 const moved = dropOverrides(layers.overrides, [{ kind: 'setVisibility', entityId: 'performer', visible: false }]);
 expect(moved.get('performer')?.size).toBe(1);
});
