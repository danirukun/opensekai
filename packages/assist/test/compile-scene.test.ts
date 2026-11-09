import { describe, expect, it } from 'vitest';
import { LightSettingsSchema, PatchOpSchema, PROPOSAL_LIMITS, quaternionFromEuler, rotateByQuaternion, SceneViewSchema, type SceneEntity, type SceneView, type Vec3 } from '@opensekai/contracts';
import { applyToWorking, assignRefs, compileIntents, targetPoint, WORDS, type Intent, type Proposal } from '../src';
import { assets, ctx, data, lightEntity, scene, summaryRefs } from './context';

const createdEntities = (p: Proposal) => p.sceneOps.flatMap(o => o.kind === 'createEntity' ? [o.entity] : []);
const angle = (a: Vec3, b: Vec3) =>
 Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b)))) * 180 / Math.PI;
const aimError = (e: SceneEntity, target: Vec3) => {
 const p = e.transform.position;
 return angle(rotateByQuaternion([0, 0, -1], e.transform.rotation), [target[0] - p[0], target[1] - p[1], target[2] - p[2]]);
};
const performer = scene.entities.find(e => e.id === 'performer')!;
const withEntities = (...entities: SceneEntity[]): SceneView => ({ ...scene, entities: [...scene.entities, ...entities] });
const threePoint: Intent[] = [{ tool: 'light_setup', role: 'key' }, { tool: 'light_setup', role: 'fill' }, { tool: 'light_setup', role: 'rim' }];
// The light that arrives at the aim point from a spot light with decay 2.
const atTarget = (e: SceneEntity, target: Vec3) => e.kind === 'light' ? e.light.intensity / Math.hypot(...e.transform.position.map((v, k) => v - target[k]!) as Vec3) ** 2 : NaN;
const sun = (id: string, intensity: number, visible = true): SceneEntity => {
 const e = lightEntity(id);
 return e.kind === 'light' ? { ...e, visible, light: { ...e.light, type: 'directional', intensity, range: 0 } } : e;
};
// @e3 (`lamp`) as a directional light.
const withSun = (intensity: number, visible = true): SceneView => ({ ...scene, entities: scene.entities.map(e => e.id === 'lamp' ? sun('lamp', intensity, visible) : e) });

describe('compileIntents: lights', () => {
 it('compiles a three-point light around the selected avatar', () => {
  const p = data(compileIntents(threePoint, ctx({ selection: 'performer' })));
  const [key, fill, rim] = createdEntities(p);
  expect(p.sceneOps).toHaveLength(3);
  expect([key, fill, rim].map(e => e?.id)).toEqual(['chat_light_1', 'chat_light_2', 'chat_light_3']);
  expect([key, fill, rim].map(e => e?.name)).toEqual(['Key light', 'Fill light', 'Rim light']);
  for (const e of [key!, fill!, rim!]) {
   if (e.kind !== 'light') throw new Error('not a light');
   expect(LightSettingsSchema.safeParse(e.light).success).toBe(true);
   expect(e.light.type).toBe('spot');
   expect(aimError(e, targetPoint(performer))).toBeLessThan(1);
  }
  // Viewer's side: key is image-left (−X) and in front (+Z); fill is front-right; rim is behind.
  expect(key!.transform.position[0]).toBeLessThan(0);
  expect(key!.transform.position[2]).toBeGreaterThan(0);
  expect(fill!.transform.position[0]).toBeGreaterThan(0);
  expect(fill!.transform.position[2]).toBeGreaterThan(0);
  expect(rim!.transform.position[2]).toBeLessThan(0);
  expect(key!.kind === 'light' && key!.light.shadow.enabled).toBe(true);
  expect(p.created.entities).toEqual(['chat_light_1', 'chat_light_2', 'chat_light_3']);
  expect(p.touched.entities).toEqual([]);
  expect(p.created.entities.map(id => p.refs.entities[id])).toEqual(['@e7', '@e8', '@e9']);
  expect(p.notes).toEqual([{ code: 'targetDefaulted', ref: '@e1' }]);
 });

 it('follows the facing of a turned target', () => {
  const turned = { ...performer, transform: { ...performer.transform, rotation: quaternionFromEuler([0, 180, 0]) } };
  const p = data(compileIntents([{ tool: 'light_setup', role: 'key', target: '@e1' }], ctx({ scene: { ...scene, entities: [turned, ...scene.entities.slice(1)] } })));
  const [key] = createdEntities(p);
  expect(key!.transform.position[0]).toBeGreaterThan(0);
  expect(key!.transform.position[2]).toBeLessThan(0);
  expect(aimError(key!, targetPoint(turned))).toBeLessThan(1);
  expect(p.notes).toEqual([]);
 });

 it('uses the color, intensity, height, and name words', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'fill', target: '@e1', color: 'purple', intensity: 'bright', height: 'low', name: 'Purple fill' }], ctx()));
  const [e] = createdEntities(p);
  expect(e).toMatchObject({ name: 'Purple fill', light: { color: WORDS.color.purple } });
  expect(atTarget(e!, targetPoint(performer))).toBeCloseTo(WORDS.intensity.bright.spot, 1);
  expect(e!.transform.position[1]).toBeCloseTo(WORDS.height.low);
 });

 it('gives each spot light the word\'s light at the target, whatever its distance', () => {
  const p = data(compileIntents(threePoint, ctx({ selection: 'performer' })));
  const [key, fill, rim] = createdEntities(p);
  expect(atTarget(key!, targetPoint(performer))).toBeCloseTo(WORDS.intensity.normal.spot, 1);
  expect(atTarget(fill!, targetPoint(performer))).toBeCloseTo(WORDS.intensity.soft.spot, 1);
  expect(atTarget(rim!, targetPoint(performer))).toBeCloseTo(WORDS.intensity.normal.spot, 1);
  expect(key!.kind === 'light' && key!.light.intensity).not.toBe(fill!.kind === 'light' && fill!.light.intensity);
 });

 it('dims a bright directional light when it creates a key light', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'key', target: '@e1' }], ctx({ scene: withSun(3) })));
  const dim = p.sceneOps.find(o => o.kind === 'setLight');
  expect(dim).toMatchObject({ kind: 'setLight', entityId: 'lamp', light: { type: 'directional', intensity: WORDS.intensity.dim.directional, range: 0 } });
  expect(p.touched.entities).toEqual(['lamp']);
  expect(p.notes).toEqual([{ code: 'dimmedLight', ref: '@e3' }]);
 });

 it('leaves a directional light alone when it is already dim, hidden, or the light is not a new key', () => {
  for (const [intents, view] of [
   [[{ tool: 'light_setup', role: 'key', target: '@e1' }], withSun(WORDS.intensity.dim.directional)],
   [[{ tool: 'light_setup', role: 'key', target: '@e1' }], withSun(3, false)],
   [[{ tool: 'light_setup', role: 'fill', target: '@e1' }, { tool: 'light_setup', role: 'rim', target: '@e1' }], withSun(3)],
  ] as [Intent[], SceneView][]) {
   const p = data(compileIntents(intents, ctx({ scene: view })));
   expect(p.sceneOps.some(o => o.kind === 'setLight')).toBe(false);
   expect(p.notes).toEqual([]);
  }
  const replaced = data(compileIntents([{ tool: 'light_setup', role: 'key', target: '@e1', replace: '@e3' }], ctx({ scene: withEntities(sun('sun', 3)) })));
  expect(replaced.sceneOps.filter(o => o.kind === 'setLight').map(o => 'entityId' in o && o.entityId)).toEqual(['lamp']);
 });

 it('makes an ambient light with no shadow', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'ambient', shadow: true }], ctx()));
  const [e] = createdEntities(p);
  expect(e).toMatchObject({ name: 'Ambient light', light: { type: 'ambient', intensity: WORDS.intensity.soft.ambient, shadow: { enabled: false } } });
  expect(e!.kind === 'light' && LightSettingsSchema.safeParse(e!.light).success).toBe(true);
 });

 it('gives a key light no shadow when both shadow slots are used', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'key' }], ctx({ scene: withEntities(lightEntity('s1', true), lightEntity('s2', true)) })));
  const [key] = createdEntities(p);
  expect(key!.kind === 'light' && key!.light.shadow.enabled).toBe(false);
  expect(p.notes).toContainEqual({ code: 'shadowSkipped', ref: '@e7' });
 });

 it('counts shadow slots that an earlier intent took', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'key', shadow: true }, { tool: 'light_setup', role: 'rim', shadow: true }, { tool: 'light_setup', role: 'fill', shadow: true }], ctx()));
  expect(createdEntities(p).map(e => e.kind === 'light' && e.light.shadow.enabled)).toEqual([true, true, false]);
  expect(p.notes).toContainEqual({ code: 'shadowSkipped', ref: '@e9' });
 });

 it('fails at the light limit with a message that names it', () => {
  const eight = withEntities(...Array.from({ length: 7 }, (_, i) => lightEntity(`l${i}`)));
  const r = compileIntents([{ tool: 'light_setup', role: 'key' }], ctx({ scene: eight }));
  expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/8 lights/) } });
 });

 it('checks the light limit on the working copy across intents', () => {
  const seven = withEntities(...Array.from({ length: 6 }, (_, i) => lightEntity(`l${i}`)));
  expect(compileIntents(threePoint.slice(0, 1), ctx({ scene: seven })).ok).toBe(true);
  const r = compileIntents(threePoint.slice(0, 2), ctx({ scene: seven }));
  expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/8 lights/) } });
 });

 it('replaces an existing light in place', () => {
  const p = data(compileIntents([{ tool: 'light_setup', role: 'rim', target: '@e1', replace: '@e3' }], ctx()));
  expect(p.sceneOps.map(o => o.kind)).toEqual(['setLight', 'setTransform']);
  expect(p.sceneOps.every(o => 'entityId' in o && o.entityId === 'lamp')).toBe(true);
  expect(p.touched.entities).toEqual(['lamp']);
  expect(p.created.entities).toEqual([]);
  expect(p.notes).toEqual([{ code: 'replacedExisting', ref: '@e3' }]);
  const moved = p.sceneOps.reduce(applyToWorking, scene).entities.find(e => e.id === 'lamp')!;
  expect(moved.transform.position[2]).toBeLessThan(0);
  expect(aimError(moved, targetPoint(performer))).toBeLessThan(1);
 });

 it('replaces at the light limit and renames when a name is given', () => {
  const eight = withEntities(...Array.from({ length: 7 }, (_, i) => lightEntity(`l${i}`)));
  const p = data(compileIntents([{ tool: 'light_setup', role: 'key', replace: '@e3', name: 'Key' }], ctx({ scene: eight })));
  expect(p.sceneOps.map(o => o.kind)).toEqual(['setLight', 'setTransform', 'renameEntity']);
 });

 it('rejects replace on an entity that is not a light', () => {
  const r = compileIntents([{ tool: 'light_setup', role: 'key', replace: '@e2' }], ctx());
  expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e2'] } });
 });
});

describe('compileIntents: references', () => {
 it('rejects a reference to a removed entity', () => {
  const removed = { ...scene, entities: scene.entities.filter(e => e.id !== 'lamp') };
  for (const intent of [{ tool: 'light_setup', role: 'key', target: '@e3' }, { tool: 'light_setup', role: 'key', replace: '@e3' }, { tool: 'output_camera', camera: '@e3' }, { tool: 'prop_place', asset: '@a2', near: '@e3' }] as Intent[])
   expect(compileIntents([intent], ctx({ scene: removed }))).toEqual({ ok: false, error: { code: 'INVALID_INPUT', message: expect.any(String), ids: ['@e3'] } });
 });

 it('rejects a reference that is not in the table', () => {
  expect(compileIntents([{ tool: 'camera_add', framing: 'wide', target: '@e99' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e99'] } });
 });

 it('rejects a reference of the wrong kind', () => {
  expect(compileIntents([{ tool: 'output_camera', camera: '@e1' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e1'] } });
  expect(compileIntents([{ tool: 'camera_add', framing: 'wide', target: '@a1' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@a1'] } });
  expect(compileIntents([{ tool: 'environment_set', asset: '@e1' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@e1'] } });
  expect(compileIntents([{ tool: 'environment_set', asset: '@a3' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['@a3'] } });
 });

 it('accepts only avatar, mesh, camera, light, and environment entities as a target or near', () => {
  const fog: SceneEntity = { id: 'fog', name: 'Fog', visible: true, kind: 'haze', haze: WORDS.haze.light, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] } };
  const refs = assignRefs(summaryRefs, { entities: ['fog'], blueprints: [], assets: [] }), fogRef = refs.entities.fog!;
  const c = ctx({ scene: withEntities(fog), refs });
  for (const intent of [{ tool: 'light_setup', role: 'key', target: fogRef }, { tool: 'camera_add', framing: 'wide', target: fogRef }, { tool: 'prop_place', asset: '@a2', near: fogRef }] as Intent[])
   expect(compileIntents([intent], c)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: [fogRef] } });
  for (const target of ['@e1', '@e2', '@e3', '@e4'])
   expect(compileIntents([{ tool: 'camera_add', framing: 'wide', target }], c).ok).toBe(true);
  // A selected haze is not a target, so the fallback takes the first avatar.
  expect(data(compileIntents([{ tool: 'light_setup', role: 'key' }], { ...c, selection: 'fog' })).notes).toEqual([{ code: 'targetDefaulted', ref: '@e1' }]);
 });

 it('ignores a selection that is not in the scene', () => {
  expect(data(compileIntents([{ tool: 'light_setup', role: 'key' }], ctx({ selection: 'constructor' }))).notes).toEqual([{ code: 'targetDefaulted', ref: '@e1' }]);
 });

 it('a later intent uses a camera that an earlier intent created', () => {
  const ref = `@e${summaryRefs.next.e}`;
  const p = data(compileIntents([{ tool: 'camera_add', framing: 'closeUp', target: '@e1' }, { tool: 'output_camera', camera: ref }], ctx()));
  expect(p.refs.entities.chat_camera_1).toBe(ref);
  expect(p.output).toEqual({ outputId: 'output_main', cameraId: 'chat_camera_1' });
 });
});

describe('compileIntents: cameras, environment, props, haze', () => {
 it('places a camera by framing and side, aimed at the avatar', () => {
  const p = data(compileIntents([{ tool: 'camera_add', framing: 'closeUp', target: '@e1', side: 'left' }], ctx()));
  const [cam] = createdEntities(p);
  expect(cam).toMatchObject({ id: 'chat_camera_1', name: 'Close-up camera', kind: 'camera', lens: { fovDegrees: WORDS.framing.closeUp.fovDegrees } });
  const [x, y, z] = cam!.transform.position;
  expect([x, y, z].map(v => Number(v.toFixed(6)))).toEqual([-WORDS.framing.closeUp.distance, WORDS.framing.closeUp.aimHeight, 0]);
  expect(aimError(cam!, targetPoint(performer, 'closeUp'))).toBeLessThan(1);
 });

 it('fails at the camera limit with a message that names it', () => {
  const cams = Array.from({ length: 6 }, (_, i) => ({ ...scene.entities[1]!, id: `c${i}` }));
  expect(compileIntents([{ tool: 'camera_add', framing: 'wide' }], ctx({ scene: withEntities(...cams) })))
   .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/8 cameras/) } });
 });

 it('sets the environment model on the existing environment or creates one', () => {
  const created = data(compileIntents([{ tool: 'environment_set', asset: '@a1', reflections: 'low' }], ctx()));
  expect(created.sceneOps).toEqual([{ kind: 'createEntity', entity: { id: 'chat_environment_1', name: 'Concert stage', visible: true, kind: 'environment', assetId: 'stage', reflectionsIntensity: WORDS.reflections.low, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } }]);
  const env: SceneEntity = { id: 'env', name: 'Env', visible: true, kind: 'environment', assetId: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } };
  const changed = data(compileIntents([{ tool: 'environment_set', asset: '@a1', reflections: 'high' }], ctx({ scene: withEntities(env) })));
  expect(changed.sceneOps).toEqual([{ kind: 'setEnvironmentModel', entityId: 'env', assetId: 'stage' }, { kind: 'setEnvironmentReflections', entityId: 'env', reflectionsIntensity: WORDS.reflections.high }]);
  expect(changed.touched.entities).toEqual(['env']);
 });

 it('places 3 props around a reference and clamps nothing below 8', () => {
  const p = data(compileIntents([{ tool: 'prop_place', asset: '@a2', near: '@e5', count: 3 }], ctx()));
  const props = createdEntities(p);
  expect(props.map(e => e.id)).toEqual(['chat_prop_1', 'chat_prop_2', 'chat_prop_3']);
  expect(props.every(e => e.kind === 'mesh' && e.source.kind === 'asset' && e.source.assetId === 'crate')).toBe(true);
  expect(new Set(props.map(e => e.transform.position.join())).size).toBe(3);
  expect(props.every(e => e.transform.position[1] === 0.7)).toBe(true);
  expect(p.notes).toEqual([]);
 });

 it('places one prop in front and a row to one side', () => {
  const one = createdEntities(data(compileIntents([{ tool: 'prop_place', asset: '@a2', near: '@e1' }], ctx())));
  expect(one).toHaveLength(1);
  expect(one[0]!.transform.position[2]).toBeGreaterThan(0);
  const row = createdEntities(data(compileIntents([{ tool: 'prop_place', asset: '@a2', near: '@e1', relation: 'left', count: 2, name: 'Box' }], ctx())));
  expect(row.map(e => e.name)).toEqual(['Box 1', 'Box 2']);
  expect(row.every(e => e.transform.position[0] < 0)).toBe(true);
  expect(row[0]!.transform.position[2]).not.toBe(row[1]!.transform.position[2]);
 });

 it('clamps the prop count at the entity limit and notes it', () => {
  const full = withEntities(...Array.from({ length: 56 }, (_, i) => ({ ...scene.entities[3]!, id: `m${i}` })));
  const p = data(compileIntents([{ tool: 'prop_place', asset: '@a2', count: 4 }], ctx({ scene: full })));
  expect(createdEntities(p)).toHaveLength(2);
  expect(p.notes).toContainEqual({ code: 'countClamped', ref: '@a2' });
  const r = compileIntents([{ tool: 'prop_place', asset: '@a2' }], ctx({ scene: withEntities(...Array.from({ length: 58 }, (_, i) => ({ ...scene.entities[3]!, id: `m${i}` }))) }));
  expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(/64 entities/) } });
 });

 it('turns haze off with density 0', () => {
  const haze: SceneEntity = { id: 'fog', name: 'Fog', visible: true, kind: 'haze', haze: { density: 1, smoke: 1, intensity: 2.5, drift: 0.2 }, transform: { position: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [20, 8, 20] } };
  const p = data(compileIntents([{ tool: 'haze_set', density: 'off' }], ctx({ scene: withEntities(haze) })));
  expect(p.sceneOps).toEqual([{ kind: 'setHaze', entityId: 'fog', haze: WORDS.haze.off }]);
  expect(WORDS.haze.off.density).toBe(0);
  expect(p.touched.entities).toEqual(['fog']);
 });

 it('creates one haze and changes it in a later intent', () => {
  const p = data(compileIntents([{ tool: 'haze_set', density: 'medium' }, { tool: 'haze_set', density: 'thick' }], ctx()));
  expect(p.sceneOps.map(o => o.kind)).toEqual(['createEntity', 'setHaze']);
  expect(p.created.entities).toEqual(['chat_haze_1']);
  expect(p.touched.entities).toEqual([]);
 });

 it('defaults the target to the first avatar and notes it', () => {
  const p = data(compileIntents([{ tool: 'camera_add', framing: 'medium' }], ctx()));
  expect(p.notes).toEqual([{ code: 'targetDefaulted', ref: '@e1' }]);
  expect(aimError(createdEntities(p)[0]!, targetPoint(performer, 'medium'))).toBeLessThan(1);
 });

 it('defaults the target to the origin when the scene has no avatar', () => {
  const empty = { ...scene, entities: scene.entities.filter(e => e.kind !== 'avatar') };
  const p = data(compileIntents([{ tool: 'camera_add', framing: 'wide' }], ctx({ scene: empty })));
  expect(p.notes).toEqual([{ code: 'targetDefaulted' }]);
  expect(createdEntities(p)[0]!.transform.position.map(v => Number(v.toFixed(6)))).toEqual([0, WORDS.framing.wide.aimHeight, WORDS.framing.wide.distance]);
 });
});

describe('compileIntents: proposal', () => {
 it('gives scene ops that pass the patch schema and a working scene that passes the scene schema', () => {
  const p = data(compileIntents([
   ...threePoint, { tool: 'light_setup', role: 'ambient' }, { tool: 'haze_set', density: 'light' }, { tool: 'environment_set', asset: '@a1' },
   { tool: 'camera_add', framing: 'wide', side: 'frontLeft', height: 'high' }, { tool: 'prop_place', asset: '@a2', count: 8 },
   { tool: 'light_setup', role: 'key', replace: '@e3' }, { tool: 'output_camera', camera: '@e2' },
  ], ctx({ selection: 'performer' })));
  for (const op of p.sceneOps) expect(PatchOpSchema.safeParse(op).success).toBe(true);
  expect(p.sceneOps.length).toBeLessThanOrEqual(PROPOSAL_LIMITS.sceneOps);
  const result = p.sceneOps.reduce<SceneView>(applyToWorking, scene);
  expect(SceneViewSchema.safeParse(result).success).toBe(true);
  expect(p.created.entities.every(id => p.refs.entities[id])).toBe(true);
  expect(p.refs.next.e).toBe(summaryRefs.next.e + p.created.entities.length);
  expect(p.output).toEqual({ outputId: 'output_main', cameraId: 'camera_wide' });
 });

 it('rejects intents that are not scene changes', () => {
  for (const intent of [{ tool: 'ask', question: 'Which color?', choices: ['Purple', 'Blue'] }, { tool: 'look_up', ref: '@e1' }] as Intent[])
   expect(compileIntents([intent], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 });

 it('rejects an empty change and an invalid intent', () => {
  expect(compileIntents([], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(compileIntents([{ tool: 'haze_set', density: 'off' }], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(compileIntents([{ tool: 'prop_place', asset: '@a2', count: 20 } as Intent], ctx())).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 });

 it('does not change the context', () => {
  const c = ctx({ selection: 'performer' });
  const snapshot = structuredClone({ scene: c.scene, refs: c.refs, assets: c.assets });
  compileIntents([...threePoint, { tool: 'light_setup', role: 'key', replace: '@e3' }], c);
  expect({ scene: c.scene, refs: c.refs, assets: c.assets }).toEqual(snapshot);
  expect(assets).toHaveLength(3);
 });
});
