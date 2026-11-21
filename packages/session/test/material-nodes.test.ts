import { expect, it } from 'vitest';
import { makeSmokeScene, mixHex, type AssetMaterial, type AssetRecord, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';

// B38 R22–R26 through the public session API: a manual run of a Set or Reset Material Property node.
type S = ReturnType<typeof createSession>;
const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const log = (id: string, message: string) => node(id, 'debug.log', { level: 'info' }, { message });
const material = (index: number, name: string, extra: Partial<AssetMaterial>): AssetMaterial => ({ index, name, profile: 'pbr', blend: false, outline: false, model: {}, ...extra });
const base = { sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1 as const, expressions: [] };
const avatar: AssetRecord = { ...base, id: 'fixture_vrm_1', format: 'vrm', name: 'Rem', materials: [
 material(0, 'Skin', { profile: 'mtoon', outline: true, model: { baseColor: '#ffeeee', shadeColor: '#ff0000', outlineWidth: 0.01 } }),
 material(1, 'Hair', { blend: true, model: { baseColor: '#000000', opacity: 0.5 } }),
] };
const prop: AssetRecord = { ...base, id: 'fixture_glb_1', format: 'glb', name: 'Room', materials: [material(0, 'Floor', { model: { baseColor: '#808080', emissionStrength: 1 } })] };
const setter = (settings: object, value?: string | number) => node('set', 'character.setMaterialProperty', { entityId: 'performer', material: 'Skin', parameter: 'baseColor', ...settings }, value === undefined ? undefined : { value });
const graph = (set: unknown) => ({ schemaVersion: 1, id: 'g', name: 'g', enabled: true, variables: [], nodes: [node('go', 'event.manual'), set, log('done', 'end'), log('after', 'exit')],
 connections: [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'transitionEnd', 'done', 'flow'), wire('c', 'set', 'exit', 'after', 'flow')] });
function start(set: unknown, scene: SceneView = makeSmokeScene()): S {
 const s = createSession(scene, 's', [avatar, prop]);
 s.advance(0);
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs: [graph(set)] }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 return s;
}
const materialsOf = (s: S, id = 'performer') => (s.inspect().entities.find(e => e.id === id) as { materials?: unknown }).materials;
const lines = (s: S) => s.debugBlueprints().entries.flatMap(entry => entry.kind === 'log' ? [entry.message] : []);

it('commits a Set without a transition before the reply of a manual run, then runs exit (R25, B33 R4)', () => {
 const s = start(setter({}, '#00ff00'));
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(materialsOf(s)).toEqual({ Skin: { baseColor: '#00ff00' } });
 expect(lines(s)).toEqual(['exit']);
 // The same value again changes nothing.
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
});

it('commits a Reset before the reply and removes the parameter (R25)', () => {
 const scene = makeSmokeScene();
 const saved = { ...scene, entities: scene.entities.map(e => e.id === 'reference' ? { ...e, materials: { Floor: { baseColor: '#123456', emissionStrength: 4 } } } : e) } as SceneView;
 const s = start(node('set', 'prop.resetMaterialProperty', { entityId: 'reference', material: 'Floor', parameter: 'emissionStrength' }), saved);
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 1 } });
 expect(materialsOf(s, 'reference')).toEqual({ Floor: { baseColor: '#123456' } });
});

it('clamps a number to the range of the parameter (R24)', () => {
 const s = start(setter({ material: 'Hair', parameter: 'opacity' }, 2));
 expect(s.runBlueprint('g', 'go').ok).toBe(true);
 expect(materialsOf(s)).toEqual({ Hair: { opacity: 1 } });
 // Without an inline value, the node reads the parameter default.
 const fallback = start(setter({ material: 'Hair', parameter: 'opacity' }));
 expect(fallback.runBlueprint('g', 'go').ok).toBe(true);
 expect(materialsOf(fallback)).toEqual({ Hair: { opacity: 1 } });
});

it('fails with no write and no output for a missing material or a parameter that does not apply (R24)', () => {
 const scene = makeSmokeScene();
 // A name that only the saved group has is not a record material.
 const saved = { ...scene, entities: scene.entities.map(e => e.id === 'performer' ? { ...e, materials: { Old: { baseColor: '#000000' } } } : e) } as SceneView;
 const cases: [object, string, SceneView?][] = [
  [{ material: 'Face' }, 'Material not found'],
  [{ material: 'Old' }, 'Material not found', saved],
  [{ entityId: 'reference' }, 'Entity is not an avatar'],
  [{ material: 'Hair', parameter: 'shadeColor' }, 'Material property does not apply'],
  [{ material: 'Skin', parameter: 'opacity' }, 'Material property does not apply'],
 ];
 for (const [settings, message, initial] of cases) {
  const s = start(setter(settings, 'parameter' in settings && settings.parameter === 'opacity' ? 0.5 : '#00ff00'), initial);
  expect(s.runBlueprint('g', 'go'), message).toMatchObject({ ok: false, error: { message } });
  expect(s.inspect().revision).toBe(0);
  expect(lines(s)).toEqual([]);
  expect(s.inspectBlueprints().errors).toMatchObject([{ graphId: 'g', kind: 'runtime', error: { message } }]);
 }
 // The box prop has no model record.
 const box = start(node('set', 'prop.setMaterialProperty', { entityId: 'marker', material: 'Floor', parameter: 'baseColor' }, { value: '#000000' }));
 expect(box.runBlueprint('g', 'go')).toMatchObject({ ok: false, error: { message: 'Material not found' } });
 // A character without a model record.
 const scene2 = makeSmokeScene();
 const noModel = { ...scene2, entities: scene2.entities.map(e => e.id === 'performer' ? { ...e, assetId: null } : e) } as SceneView;
 expect(start(setter({}, '#000000'), noModel).runBlueprint('g', 'go')).toMatchObject({ ok: false, error: { message: 'Material not found' } });
});

it('runs a transition with OutCubic by default, commits at the end, and then runs transitionEnd (R26)', () => {
 const s = start(setter({ transitionSeconds: 1 }, '#0000ff'));
 expect(s.runBlueprint('g', 'go')).toEqual({ ok: true, data: { revision: 0 } });
 expect(lines(s)).toEqual(['exit']);
 const frame = s.advance(500);
 const half = mixHex('#ffeeee', '#0000ff', 1 - 0.5 ** 3);
 expect((frame.scene.entities.find(e => e.id === 'performer') as { materials?: unknown }).materials).toEqual({ Skin: { baseColor: half } });
 expect(materialsOf(s)).toBeUndefined();
 for (let ms = 520; ms <= 1500; ms += 20) s.advance(ms);
 expect(materialsOf(s)).toEqual({ Skin: { baseColor: '#0000ff' } });
 expect(lines(s)).toEqual(['exit', 'end']);
});
