import { expect, it } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, PatchOpSchema, SceneViewSchema, TRACKING_PRESETS, type PatchOp, type SceneEntity, type SceneView, type TrackingConfig, type TrackingPreset } from '@opensekai/contracts';
import { applyOperations } from '../../../packages/session/src/scene-ops';
import { makeAuthoringEntity, makeEmptyScene } from '../src/editor/authoring';
import { planCancel, planSetup, setupSnapshot, type GuideSnapshot, type SetupPlan } from '../src/editor/tracking-guide-plan';
import { resolveSetup, type SetupPart, type SetupRole } from '../src/editor/tracking-guide-setup';

const selfReflect = TRACKING_PRESETS[0]!;
const ifacial = TRACKING_PRESETS[1]!;
const otherVmc = TRACKING_PRESETS[2]!;
const part = (preset: TrackingPreset, roles: SetupRole[] = [...preset.slots]): SetupPart => ({ preset, roles, config: preset.config });
type Ready = Extract<SetupPlan, { ops: PatchOp[] }>;
const ready = (plan: SetupPlan): Ready => { if ('blocked' in plan) throw new Error('blocked'); return plan; };
// The one-part form of the old planConnect cases: the part fills the preset slots.
function planConnect(scene: SceneView, avatarId: string, preset: TrackingPreset, phone: string | null, eyeBones: boolean | undefined, newId: string) {
 const plan = ready(planSetup(scene, avatarId, [part(preset)], phone, eyeBones, newId));
 const first = plan.parts[0];
 return { operations: plan.ops, sourceId: first?.sourceId ?? newId, created: first?.created ?? false, needsPhone: plan.needsPhone, port: first?.port ?? (preset.config as { port: number }).port };
}
const snap = (avatarId: string, tracking: GuideSnapshot['tracking'], created: string[], sources: GuideSnapshot['sources'] = {}): GuideSnapshot => ({ avatarId, tracking, created, sources });
type Avatar = Extract<SceneEntity, { kind: 'avatar' }>;
type Source = Extract<SceneEntity, { kind: 'tracking' }>;

const source = (id: string, kind: 'vmc' | 'ifacialmocap', over: Partial<Source> = {}, config?: TrackingConfig): Source => {
 const entity = makeAuthoringEntity(kind, id, []) as Source;
 return { ...entity, ...over, config: config ?? entity.config };
};
const avatar = (id: string, tracking?: Avatar['tracking']): Avatar => ({ ...(makeAuthoringEntity('character', id, []) as Avatar), tracking });
const sceneOf = (...entities: SceneEntity[]): SceneView => {
 const base = makeEmptyScene();
 return { ...base, entities: [...base.entities, ...entities] };
};
const vmc39539 = (over: Partial<Extract<TrackingConfig, { kind: 'vmc' }>> = {}): TrackingConfig => ({ ...(selfReflect.config as Extract<TrackingConfig, { kind: 'vmc' }>), ...over });

// Every plan must be valid PatchOps and must leave a valid scene.
function apply(scene: SceneView, operations: PatchOp[]): SceneView {
 for (const op of operations) expect(PatchOpSchema.safeParse(op).success).toBe(true);
 const reply = applyOperations(scene, operations, 7);
 expect(reply.ok).toBe(true);
 const next = (reply as { ok: true; data: SceneView }).data;
 const parsed = SceneViewSchema.safeParse(next);
 expect(parsed.success ? null : JSON.stringify(parsed.error.issues).slice(0, 500)).toBeNull();
 expectRoutable(next);
 return next;
}
const find = <T extends SceneEntity['kind']>(scene: SceneView, id: string, kind: T) => scene.entities.find(e => e.id === id && e.kind === kind) as Extract<SceneEntity, { kind: T }>;

it('reuses the same-kind source in the own slot and sends config only when it differs', () => {
 const same = source('s1', 'vmc', {}, vmc39539());
 const scene = sceneOf(same, avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const plan = planConnect(scene, 'a', selfReflect, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 's1', created: false, needsPhone: false });
 expect(plan.operations.map(o => o.kind)).toEqual(['setAvatarTracking']);

 const differs = sceneOf(source('s1', 'vmc', {}, vmc39539({ bindAddress: '127.0.0.1' })), avatar('a', { bodySourceId: 's1', faceSourceId: null }));
 const p2 = planConnect(differs, 'a', selfReflect, null, undefined, 'new');
 expect(p2.operations.map(o => o.kind)).toEqual(['setTrackingConfig', 'setAvatarTracking']);
 expect(p2.operations[0]).toMatchObject({ config: selfReflect.config });
 const out = apply(differs, p2.operations);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 's1', faceSourceId: 's1', fingersSourceId: 's1' });
});

it('adopts a free same-kind source', () => {
 const scene = sceneOf(source('free', 'vmc', {}, vmc39539({ port: 40000 })), avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'a', selfReflect, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'free', created: false });
 expect(plan.operations[0]).toMatchObject({ kind: 'setTrackingConfig', config: selfReflect.config });
 const out = apply(scene, plan.operations);
 expect(find(out, 'a', 'avatar').tracking?.bodySourceId).toBe('free');
});

const bothFree = () => avatar('b', { bodySourceId: null, faceSourceId: null });
const aHoldsVmc = (over: Partial<Source> = {}) => [source('s1', 'vmc', over, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' })];

// The host rule: enabled sources share a port only when same kind and every member has a distinct address.
function expectRoutable(scene: SceneView) {
 const enabled = scene.entities.filter((e): e is Source => e.kind === 'tracking' && e.config.enabled && 'port' in e.config);
 const byPort = new Map<number, Source[]>();
 for (const s of enabled) byPort.set((s.config as { port: number }).port, [...(byPort.get((s.config as { port: number }).port) ?? []), s]);
 const addr = (s: Source) => (s.config.kind === 'vmc' ? s.config.senderAddress : s.config.kind === 'ifacialmocap' ? s.config.phoneAddress : null);
 for (const members of byPort.values()) {
  if (members.length < 2) continue;
  expect(new Set(members.map(m => m.config.kind)).size).toBe(1);
  const addrs = members.map(addr);
  expect(addrs.every(x => x !== null)).toBe(true);
  expect(new Set(addrs).size).toBe(addrs.length);
 }
}

it('VMC: another character holds 39539, so a new source goes to 39540 and A is untouched', () => {
 const scene = sceneOf(...aHoldsVmc(), bothFree());
 const plan = planConnect(scene, 'b', selfReflect, null, true, 'new');
 expect(plan).toMatchObject({ created: true, needsPhone: false, port: 39540 });
 const out = apply(scene, plan.operations);
 expect(find(out, 'new', 'tracking').config).toMatchObject({ kind: 'vmc', port: 39540, senderAddress: null });
 expect(find(out, 'a', 'avatar')).toEqual(find(scene, 'a', 'avatar'));
 expect(find(out, 's1', 'tracking')).toEqual(find(scene, 's1', 'tracking'));
 expectRoutable(out);
});

it('VMC: the next port skips any port a source uses, enabled or not', () => {
 const off = source('off', 'vmc', {}, vmc39539({ port: 39540, enabled: false }));
 const scene = sceneOf(source('s1', 'vmc', {}, vmc39539()), off, avatar('a', { bodySourceId: 's1', faceSourceId: 's1', fingersSourceId: 'off' }), bothFree());
 expect(planConnect(scene, 'b', selfReflect, null, undefined, 'new')).toMatchObject({ port: 39541 });
});

it('VMC: a free source on another port is adopted and moved off the endpoint that A holds', () => {
 const scene = sceneOf(...aHoldsVmc(), source('free', 'vmc', {}, vmc39539({ port: 40000 })), bothFree());
 const plan = planConnect(scene, 'b', selfReflect, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'free', created: false, port: 39540 });
 const out = apply(scene, plan.operations);
 expect(find(out, 'free', 'tracking').config).toMatchObject({ port: 39540 });
 expectRoutable(out);
});

it('a free source already on the preset endpoint is preferred when none blocks it', () => {
 const scene = sceneOf(source('far', 'vmc', {}, vmc39539({ port: 40000 })), source('near', 'vmc', {}, vmc39539()), bothFree());
 expect(planConnect(scene, 'b', selfReflect, null, undefined, 'new')).toMatchObject({ sourceId: 'near', port: 39539 });
});

it('iFacialMocap: without a phone address on a held endpoint, asks; with one, shares it', () => {
 const held = source('i1', 'ifacialmocap', {}, { ...ifacial.config, phoneAddress: '192.168.1.20' } as TrackingConfig);
 const scene = sceneOf(held, avatar('a', { bodySourceId: null, faceSourceId: 'i1' }), bothFree());
 expect(planConnect(scene, 'b', ifacial, null, undefined, 'new')).toEqual({ operations: [], sourceId: 'new', created: false, needsPhone: true, port: 49983 });
 const plan = planConnect(scene, 'b', ifacial, '192.168.1.21', undefined, 'new');
 expect(plan).toMatchObject({ created: true, needsPhone: false, port: 49983 });
 const out = apply(scene, plan.operations);
 expect(find(out, 'new', 'tracking').config).toMatchObject({ phoneAddress: '192.168.1.21', port: 49983 });
 expectRoutable(out);
});

it('iFacialMocap: a phone address that a source on the endpoint already has asks again', () => {
 const held = source('i1', 'ifacialmocap', {}, { ...ifacial.config, phoneAddress: '192.168.1.20' } as TrackingConfig);
 const scene = sceneOf(held, avatar('a', { bodySourceId: null, faceSourceId: 'i1' }), bothFree());
 const plan = planConnect(scene, 'b', ifacial, '192.168.1.20', undefined, 'new');
 expect(plan).toMatchObject({ operations: [], needsPhone: true });
});

it('reuse order: a same-kind source of this character in any slot that a part fills comes first (R11)', () => {
 const scene = sceneOf(source('free', 'vmc', {}, vmc39539()), source('mine', 'vmc', {}, vmc39539({ port: 40000 })), avatar('a', { bodySourceId: 'mine', faceSourceId: null }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'vmc', body: 'webcam', hands: false }), null, undefined, 'new'));
 expect(plan.parts.map(p => [p.sourceId, p.created])).toEqual([['mine', false], ['new', true]]);
 expect(find(apply(scene, plan.ops), 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new', faceSourceId: 'mine' });
});

it('reuse order: a source in a slot that no part fills stays there and is not taken (R10, R11)', () => {
 const scene = sceneOf(source('free', 'vmc', {}, vmc39539()), source('mine', 'vmc', {}, vmc39539({ port: 40000 })), avatar('a', { bodySourceId: 'mine', faceSourceId: null }));
 const plan = ready(planSetup(scene, 'a', [part(otherVmc, ['face'])], null, undefined, 'new'));
 expect(plan.parts.map(p => [p.sourceId, p.created])).toEqual([['free', false]]);
 expect(plan.ops.filter(o => 'entityId' in o && o.entityId === 'mine')).toEqual([]);
 expect(plan.released).toEqual([]);
 expect(find(apply(scene, plan.ops), 'a', 'avatar').tracking).toEqual({ bodySourceId: 'mine', faceSourceId: 'free' });
});

it('reuse order: an unbound same-kind source comes next, one on the preset port first; a source of the other character never', () => {
 const scene = sceneOf(source('far', 'vmc', {}, vmc39539({ port: 40000 })), source('near', 'vmc', {}, vmc39539({ enabled: false })), ...aHoldsVmc(), bothFree());
 const plan = ready(planSetup(scene, 'b', [part(selfReflect)], null, undefined, 'new'));
 expect(plan.parts.map(p => p.sourceId)).toEqual(['near']);
 const out = apply(scene, plan.ops);
 expect(find(out, 's1', 'tracking')).toEqual(find(scene, 's1', 'tracking'));
 expect(find(out, 'a', 'avatar')).toEqual(find(scene, 'a', 'avatar'));
 const onlyTheirs = sceneOf(...aHoldsVmc(), bothFree());
 expect(ready(planSetup(onlyTheirs, 'b', [part(selfReflect)], null, undefined, 'new')).parts.map(p => [p.sourceId, p.created])).toEqual([['new', true]]);
});

it('one source never serves two parts; the own SelfReflect source stays with the SelfReflect part', () => {
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'v', faceSourceId: 'v', fingersSourceId: 'v' }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'vmc', body: 'selfreflect', hands: true }), null, undefined, 'new'));
 expect(plan.parts.map(p => [p.sourceId, p.created, p.port])).toEqual([['new', true, 39540], ['v', false, 39539]]);
 expect(find(apply(scene, plan.ops), 'a', 'avatar').tracking).toEqual({ bodySourceId: 'v', faceSourceId: 'new', fingersSourceId: 'v' });
});

it('an own VMC source does not move onto a port that a free unaddressed source holds; it takes the next free port', () => {
 const scene = sceneOf(source('own', 'vmc', {}, vmc39539({ port: 40000 })), source('free', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'own', faceSourceId: 'own' }));
 const plan = planConnect(scene, 'a', selfReflect, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'own', port: 39540 });
 apply(scene, plan.operations);
});

it('iFacialMocap: a port held by a VMC source or an unaddressed source needs a phone, never a refused layout', () => {
 for (const holder of [source('h', 'vmc', {}, vmc39539({ port: 49983 })), source('h', 'ifacialmocap', {}, ifacial.config)]) {
  const scene = sceneOf(holder, avatar('a', { bodySourceId: 'h', faceSourceId: null }), bothFree());
  for (const phone of [null, '192.168.1.9']) expect(planConnect(scene, 'b', ifacial, phone, undefined, 'new')).toMatchObject({ operations: [], needsPhone: true });
 }
});

it('an own VMC source that already shares 39539 with distinct sender addresses is kept there', () => {
 const mine = source('mine', 'vmc', {}, vmc39539({ senderAddress: '192.168.1.2' }));
 const theirs = source('theirs', 'vmc', {}, vmc39539({ senderAddress: '192.168.1.3' }));
 const scene = sceneOf(mine, theirs, avatar('a', { bodySourceId: 'mine', faceSourceId: 'mine' }), avatar('b', { bodySourceId: 'theirs', faceSourceId: 'theirs' }));
 const plan = planConnect(scene, 'a', selfReflect, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'mine', port: 39539 });
 expect(plan.operations.map(o => o.kind)).toEqual(['setAvatarTracking']);
 apply(scene, plan.operations);
});

// The two old one-preset cases that kept the other slots are now two-part runs: the body part keeps the VMC source.
it('a different-kind source in the slot stays in the scene; the new source takes the slot', () => {
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }));
 const plan = ready(planSetup(scene, 'a', [part(ifacial), part(selfReflect, ['body'])], null, undefined, 'new'));
 expect(plan.parts.map(p => [p.sourceId, p.created])).toEqual([['new', true], ['v', false]]);
 const out = apply(scene, plan.ops);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'v', faceSourceId: 'new' });
 expect(out.entities.some(e => e.id === 'v')).toBe(true);
});

it('iFacialMocap binds only face and keeps body and fingers; the phone address goes in phoneAddress', () => {
 const scene = sceneOf(source('body', 'vmc'), avatar('a', { bodySourceId: 'body', faceSourceId: null, fingersSourceId: 'body' }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'vmc', hands: true }), '192.168.1.30', undefined, 'new'));
 expect(plan.parts.map(p => p.created)).toEqual([true, false]);
 const out = apply(scene, plan.ops);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'body', faceSourceId: 'new', fingersSourceId: 'body' });
 expect(find(out, 'new', 'tracking').config).toMatchObject({ kind: 'ifacialmocap', phoneAddress: '192.168.1.30', enabled: true });
 expect(find(out, 'body', 'tracking').config).toMatchObject({ kind: 'vmc', senderAddress: null, enabled: true });
});

it('creates a new source otherwise, with preset smoothing', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'a', selfReflect, null, undefined, 'new');
 expect(plan.operations.map(o => o.kind)).toEqual(['createEntity', 'setTrackingSmoothing', 'setAvatarTracking']);
 const out = apply(scene, plan.operations);
 expect(find(out, 'new', 'tracking').smoothing).toEqual(selfReflect.smoothing);
});

it('smoothing: absent counts as on and is kept; off is replaced with the preset values', () => {
 const keep = sceneOf(source('s1', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 expect(planConnect(keep, 'a', selfReflect, null, undefined, 'n').operations.some(o => o.kind === 'setTrackingSmoothing')).toBe(false);
 const off = sceneOf(source('s1', 'vmc', { smoothing: { enabled: false, minCutoff: 1, beta: 1, derivativeCutoff: 1 } }, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const plan = planConnect(off, 'a', selfReflect, null, undefined, 'n');
 expect(plan.operations).toContainEqual({ kind: 'setTrackingSmoothing', entityId: 's1', smoothing: selfReflect.smoothing });
 const on = sceneOf(source('s1', 'vmc', { smoothing: { enabled: true, minCutoff: 2, beta: 1, derivativeCutoff: 1 } }, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 expect(planConnect(on, 'a', selfReflect, null, undefined, 'n').operations.some(o => o.kind === 'setTrackingSmoothing')).toBe(false);
});

it('positions: a new, disabled, or rule-less source gets the preset rule; an explicit rule on an enabled source is kept', () => {
 const created = apply(sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null })), planConnect(sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null })), 'a', selfReflect, null, undefined, 'new').operations);
 expect(find(created, 'new', 'tracking').config).toMatchObject({ kind: 'vmc', positions: 'rotationsOnly' });
 const { positions: _drop, ...noRule } = vmc39539() as Extract<TrackingConfig, { kind: 'vmc' }>;
 const explicit = { ...noRule, positions: 'all' as const };
 const kept = sceneOf(source('s1', 'vmc', {}, explicit), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const keptPlan = planConnect(kept, 'a', selfReflect, null, undefined, 'n');
 expect(keptPlan.operations.some(o => o.kind === 'setTrackingConfig')).toBe(false);
 expect(find(apply(kept, keptPlan.operations), 's1', 'tracking').config).toEqual(explicit);
 const absent = sceneOf(source('s1', 'vmc', {}, noRule), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const absentPlan = planConnect(absent, 'a', selfReflect, null, undefined, 'n');
 expect(find(apply(absent, absentPlan.operations), 's1', 'tracking').config).toMatchObject({ enabled: true, positions: 'rotationsOnly' });
 const disabled = sceneOf(source('s1', 'vmc', {}, { ...noRule, enabled: false, positions: 'all' }), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const plan = planConnect(disabled, 'a', selfReflect, null, undefined, 'n');
 expect(find(apply(disabled, plan.operations), 's1', 'tracking').config).toMatchObject({ enabled: true, positions: 'rotationsOnly' });
});

it('mapping: writes useEyeBones from a known flag, keeps other fields, never writes for unknown', () => {
 const mapping = { ...DEFAULT_TRACKING_MAPPING, headIntensity: 1.5, blendShapes: { jawOpen: { inputMin: 0.1, inputMax: 0.8, outputMin: 0, outputMax: 1 } } };
 const scene = sceneOf(source('s1', 'vmc', { mapping }, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const known = planConnect(scene, 'a', selfReflect, null, false, 'n');
 expect(known.operations).toContainEqual({ kind: 'setTrackingMapping', entityId: 's1', mapping: { ...mapping, useEyeBones: false } });
 apply(scene, known.operations);
 expect(planConnect(scene, 'a', selfReflect, null, undefined, 'n').operations.some(o => o.kind === 'setTrackingMapping')).toBe(false);
});

it('two parts: Face iFacialMocap with Body SelfReflect is one patch with two new sources and the full binding', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'selfreflect', hands: true }), '192.168.1.40', true, 'new'));
 expect(plan.ops.filter(o => o.kind === 'createEntity')).toHaveLength(2);
 expect(plan.ops.filter(o => o.kind === 'setAvatarTracking')).toEqual([{ kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: 'new-2', faceSourceId: 'new', fingersSourceId: 'new-2' } }]);
 // The eye bone flag goes to the face source only.
 expect(plan.ops.filter(o => o.kind === 'setTrackingMapping').map(o => (o as { entityId: string }).entityId)).toEqual(['new']);
 const out = apply(scene, plan.ops);
 expect(find(out, 'new-2', 'tracking').config).toMatchObject({ kind: 'vmc', port: 39539, positions: 'rotationsOnly' });
 expect(find(out, 'new', 'tracking').name).not.toBe(find(out, 'new-2', 'tracking').name);
});

it('two parts: Face Other VMC app with Body SelfReflect puts the second VMC source on 39540', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'vmc', body: 'selfreflect', hands: true }), null, undefined, 'new'));
 expect(plan.parts.map(p => [p.preset.id, p.port])).toEqual([['vmc', 39539], ['selfreflect', 39540]]);
 apply(scene, plan.ops);
});

it('fingers: a SelfReflect body gives the fingers to the body source; a webcam with Hands off gives none', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const reflect = ready(planSetup(scene, 'a', resolveSetup({ face: 'openseeface', body: 'selfreflect', hands: false }), null, undefined, 'new'));
 expect(find(apply(scene, reflect.ops), 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new-2', faceSourceId: 'new', fingersSourceId: 'new-2' });
 const webcam = ready(planSetup(scene, 'a', resolveSetup({ face: 'webcam', body: 'same', hands: false }), null, undefined, 'new'));
 const out = apply(scene, webcam.ops);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new', faceSourceId: 'new' });
 expect(find(out, 'new', 'tracking').config).toMatchObject({ kind: 'mediapipe', face: true, upperBody: true, hands: false });
});

it('a reused webcam source keeps its camera and mirror', () => {
 const cam = source('w', 'vmc', {}, { kind: 'mediapipe', enabled: false, deviceId: 'cam-2', face: true, upperBody: false, hands: false, mirror: true });
 const scene = sceneOf(cam, avatar('a', { bodySourceId: null, faceSourceId: 'w' }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'webcam', body: 'same', hands: true }), null, undefined, 'new'));
 expect(find(apply(scene, plan.ops), 'w', 'tracking').config).toEqual({ kind: 'mediapipe', enabled: true, deviceId: 'cam-2', face: true, upperBody: true, hands: true, mirror: true });
});

it('released: a second run from SelfReflect to Webcam stops the old VMC source in the same patch', () => {
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'v', faceSourceId: 'v', fingersSourceId: 'v' }));
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'webcam', body: 'same', hands: true }), null, undefined, 'new'));
 expect(plan.released).toEqual(['v']);
 expect(plan.ops).toContainEqual({ kind: 'setTrackingConfig', entityId: 'v', config: vmc39539({ enabled: false }) });
 const out = apply(scene, plan.ops);
 expect(find(out, 'v', 'tracking').config.enabled).toBe(false);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new', faceSourceId: 'new', fingersSourceId: 'new' });
});

it('released: a source of the other character, a disabled source, and a source still bound in another slot get no stop', () => {
 const theirs = sceneOf(source('v', 'vmc', {}, vmc39539({ senderAddress: '10.0.0.2' })), source('t', 'vmc', {}, vmc39539({ senderAddress: '10.0.0.3' })), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }), avatar('b', { bodySourceId: 't', faceSourceId: 't' }));
 const plan = ready(planSetup(theirs, 'a', resolveSetup({ face: 'openseeface', body: 'webcam', hands: true }), null, undefined, 'new'));
 expect(plan.released).toEqual(['v']);
 expect(plan.ops.some(o => 'entityId' in o && o.entityId === 't')).toBe(false);
 const off = sceneOf(source('v', 'vmc', {}, vmc39539({ enabled: false })), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }));
 const offPlan = ready(planSetup(off, 'a', resolveSetup({ face: 'openseeface', body: 'webcam', hands: true }), null, undefined, 'new'));
 expect(offPlan.released).toEqual([]);
 expect(offPlan.ops.some(o => 'entityId' in o && o.entityId === 'v' && o.kind === 'setTrackingConfig')).toBe(false);
 const kept = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }));
 const keptPlan = ready(planSetup(kept, 'a', resolveSetup({ face: 'openseeface', body: 'vmc', hands: true }), null, undefined, 'new'));
 expect(keptPlan.released).toEqual([]);
 expect(find(apply(kept, keptPlan.ops), 'v', 'tracking').config.enabled).toBe(true);
});

it('limit: a run that would make more than 4 sources is blocked; a run that reuses one and creates one is not', () => {
 const three = [source('x', 'vmc', {}, vmc39539({ port: 40001, enabled: false })), source('y', 'vmc', {}, vmc39539({ port: 40002, enabled: false })), source('z', 'ifacialmocap', {}, { ...ifacial.config, enabled: false } as TrackingConfig)];
 const scene = sceneOf(...three, avatar('a', { bodySourceId: 'x', faceSourceId: 'x' }), avatar('b', { bodySourceId: 'y', faceSourceId: null }));
 expect(planSetup(scene, 'b', resolveSetup({ face: 'facekit', body: 'webcam', hands: true }), null, undefined, 'new')).toEqual({ blocked: 'sourceLimit' });
 const reuse = sceneOf(...three, avatar('a', { bodySourceId: 'x', faceSourceId: 'x' }), avatar('b', { bodySourceId: 'y', faceSourceId: 'z' }));
 const plan = ready(planSetup(reuse, 'a', resolveSetup({ face: 'facekit', body: 'vmc', hands: true }), null, undefined, 'new'));
 expect(plan.parts.map(p => [p.sourceId, p.created])).toEqual([['new', true], ['x', false]]);
 apply(reuse, plan.ops);
});

// The host counts config changes in `generation`, and a mapping cannot go back to absent; absent is the default mapping.
const restorable = (e: Source) => ({ ...e, generation: 0, mapping: e.mapping ?? DEFAULT_TRACKING_MAPPING });
const run = (scene: SceneView, avatarId: string, parts: SetupPart[], phone: string | null = null) => {
 const plan = ready(planSetup(scene, avatarId, parts, phone, false, 'new'));
 return { plan, snapshot: setupSnapshot(scene, avatarId, plan), connected: apply(scene, plan.ops) };
};

it('cancel removes a created source and restores the bindings', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const { snapshot, connected } = run(scene, 'a', [part(selfReflect)]);
 expect(snapshot).toEqual(snap('a', { bodySourceId: null, faceSourceId: null }, ['new']));
 const ops = planCancel(connected, snapshot);
 expect(ops).toEqual([{ kind: 'removeEntity', entityId: 'new' }, { kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: null, faceSourceId: null } }]);
 const out = apply(connected, ops);
 expect(out.entities.some(e => e.id === 'new')).toBe(false);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: null, faceSourceId: null });
});

it('cancel gives the replaced VMC source back, started, after an iFacialMocap and Webcam run', () => {
 const before = { bodySourceId: 'v', faceSourceId: 'v' };
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', before));
 const { plan, snapshot, connected } = run(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'webcam', hands: true }), '192.168.1.50');
 expect(plan.released).toEqual(['v']);
 expect(find(connected, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new-2', faceSourceId: 'new', fingersSourceId: 'new-2' });
 expect(find(connected, 'v', 'tracking').config.enabled).toBe(false);
 const out = apply(connected, planCancel(connected, snapshot));
 expect(find(out, 'a', 'avatar').tracking).toEqual(before);
 expect(restorable(find(out, 'v', 'tracking'))).toEqual(restorable(find(scene, 'v', 'tracking')));
 expect(out.entities.some(e => e.id === 'new' || e.id === 'new-2')).toBe(false);
});

it('cancel on a reused source restores bindings and the mapping', () => {
 const before = { bodySourceId: 's1', faceSourceId: null };
 const scene = sceneOf(source('s1', 'vmc', {}, vmc39539()), avatar('a', before));
 const { snapshot, connected } = run(scene, 'a', [part(selfReflect)]);
 const ops = planCancel(connected, snapshot);
 expect(ops).toEqual([
  { kind: 'setAvatarTracking', entityId: 'a', tracking: before },
  { kind: 'setTrackingMapping', entityId: 's1', mapping: DEFAULT_TRACKING_MAPPING }
 ]);
 const out = apply(connected, ops);
 expect(find(out, 's1', 'tracking').mapping).toEqual(DEFAULT_TRACKING_MAPPING);
 expect(find(out, 'a', 'avatar').tracking).toEqual(before);
 const mapping = { ...DEFAULT_TRACKING_MAPPING, headIntensity: 0.5 };
 expect(planCancel(connected, { ...snapshot, sources: { s1: { ...snapshot.sources.s1!, mapping } } })[1]).toMatchObject({ mapping });
});

it('cancel restores the config and smoothing of a reused and a released source', () => {
 const smoothing = { enabled: false, minCutoff: 2, beta: 1, derivativeCutoff: 1 };
 const scene = sceneOf(source('v', 'vmc', { smoothing }, vmc39539({ bindAddress: '127.0.0.1' })), source('i', 'ifacialmocap', {}, { ...ifacial.config, phoneAddress: '192.168.1.9' } as TrackingConfig), avatar('a', { bodySourceId: 'v', faceSourceId: 'i' }));
 const { plan, snapshot, connected } = run(scene, 'a', resolveSetup({ face: 'vmc', body: 'webcam', hands: false }));
 expect(plan.parts.map(p => p.sourceId)).toEqual(['v', 'new']);
 expect(plan.released).toEqual(['i']);
 expect(find(connected, 'v', 'tracking').smoothing).not.toEqual(smoothing);
 const out = apply(connected, planCancel(connected, snapshot));
 for (const id of ['v', 'i']) expect(restorable(find(out, id, 'tracking'))).toEqual(restorable(find(scene, id, 'tracking')));
 expect(find(out, 'a', 'avatar')).toEqual(find(scene, 'a', 'avatar'));
 expect(out.entities.some(e => e.id === 'new')).toBe(false);
});

it('cancel puts back the config of a disabled SelfReflect-port source that Other VMC app reused (the old deferred defect)', () => {
 const reflect = vmc39539({ enabled: false });
 const scene = sceneOf(source('v', 'vmc', {}, reflect), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }));
 const { snapshot, connected } = run(scene, 'a', [part(otherVmc)]);
 expect(find(connected, 'v', 'tracking').config).toMatchObject({ enabled: true });
 expect('positions' in find(connected, 'v', 'tracking').config).toBe(false);
 const out = apply(connected, planCancel(connected, snapshot));
 expect(find(out, 'v', 'tracking').config).toEqual(reflect);
});

it('cancel: a missing source has no operation for it; a missing avatar still removes a created source', () => {
 const held = source('s1', 'vmc');
 const sources = { s1: { config: held.config, smoothing: undefined, mapping: undefined } };
 const snapshot = snap('a', { bodySourceId: 's1', faceSourceId: 's1' }, [], sources);
 const noSource = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const ops = planCancel(noSource, snapshot);
 expect(ops).toEqual([{ kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: null, faceSourceId: null } }]);
 apply(noSource, ops);
 expect(planCancel(noSource, { ...snapshot, created: ['s1'] })).toEqual(ops);
 expect(planCancel(sceneOf(held), snapshot)).toEqual([]);
 expect(planCancel(sceneOf(held), { ...snapshot, created: ['s1'] })).toEqual([{ kind: 'removeEntity', entityId: 's1' }]);
});


it('does not reuse a source that another character also binds: A and B share S, and a run on A leaves S as it was', () => {
 const shared = source('s', 'vmc', {}, vmc39539());
 const scene = sceneOf(shared, avatar('a', { bodySourceId: 's', faceSourceId: 's' }), avatar('b', { bodySourceId: 's', faceSourceId: 's' }));
 const plan = ready(planSetup(scene, 'a', [part(otherVmc, ['face'])], null, undefined, 'new'));
 expect(plan.parts).toMatchObject([{ sourceId: 'new', created: true, port: 39540 }]);
 expect(plan.ops.filter(o => 'entityId' in o && o.entityId === 's')).toEqual([]);
 expect(plan.released).toEqual([]);
 const out = applyOperations(scene, plan.ops, 7);
 expect(out.ok).toBe(true);
 const next = (out as { ok: true; data: SceneView }).data;
 expect(find(next, 's', 'tracking')).toEqual(find(scene, 's', 'tracking'));
 expect(find(next, 'b', 'avatar')).toEqual(find(scene, 'b', 'avatar'));
});

it('gives the own SelfReflect source to the SelfReflect body part, not to an Other VMC app face part before it', () => {
 const scene = sceneOf(source('x', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'x', faceSourceId: 'x', fingersSourceId: 'x' }));
 const plan = ready(planSetup(scene, 'a', [part(otherVmc, ['face']), part(selfReflect, ['body', 'fingers'])], null, undefined, 'new'));
 expect(plan.parts.map(p => [p.preset.id, p.sourceId, p.created, p.port])).toEqual([['vmc', 'new', true, 39540], ['selfreflect', 'x', false, 39539]]);
 expect(plan.ops.filter(o => o.kind === 'setTrackingConfig' && o.entityId === 'x')).toEqual([]);
 const out = apply(scene, plan.ops);
 expect(find(out, 'x', 'tracking').config).toMatchObject({ port: 39539, positions: 'rotationsOnly' });
 expect(find(out, 'a', 'avatar').tracking).toMatchObject({ bodySourceId: 'x', faceSourceId: 'new', fingersSourceId: 'x' });
});

it('does not take the port of an enabled VMC sender that sends to this computer', () => {
 const sender = (id: string, address: string, port: number, enabled = true): SceneEntity => ({ ...(makeAuthoringEntity('vmcSender', id, []) as Extract<SceneEntity, { kind: 'vmcSender' }>), vmcSender: { enabled, address, port, avatarId: null } });
 const portFor = (...entities: SceneEntity[]) => ready(planSetup(sceneOf(...entities, avatar('a')), 'a', [part(selfReflect)], null, undefined, 'new')).parts[0]!.port;
 expect(portFor(sender('o', '127.0.0.1', 39539))).toBe(39540);
 expect(portFor(sender('o', 'localhost', 39539), sender('p', '::1', 39540))).toBe(39541);
 expect(portFor(sender('o', '127.0.0.1', 39539), source('s', 'ifacialmocap', {}, { kind: 'ifacialmocap', enabled: false, bindAddress: '0.0.0.0', port: 39540, phoneAddress: null }))).toBe(39541);
 expect(portFor(sender('o', '192.168.1.20', 39539))).toBe(39539);
 expect(portFor(sender('o', '127.0.0.1', 39539, false))).toBe(39539);
});

// Keep unused slots (owner decision, 2026-11-17): the run changes only the slots that its parts fill.
const handScene = () => sceneOf(
 source('b', 'vmc', {}, vmc39539()),
 source('h', 'vmc', {}, vmc39539({ port: 40000, senderAddress: '192.168.1.60' })),
 avatar('a', { bodySourceId: 'b', faceSourceId: 'b', fingersSourceId: 'h' })
);

it('keep unused slots: face iFacialMocap and body SelfReflect keep a separate VMC hand source in the fingers slot, and no operation touches it', () => {
 const scene = handScene();
 const plan = ready(planSetup(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'selfreflect', hands: true }), '192.168.1.40', undefined, 'new'));
 expect(plan.parts.map(p => [p.preset.id, p.roles, p.sourceId, p.created])).toEqual([['ifacialmocap', ['face'], 'new', true], ['selfreflect', ['body'], 'b', false]]);
 expect(plan.ops.filter(o => 'entityId' in o && o.entityId === 'h')).toEqual([]);
 expect(plan.released).toEqual([]);
 const out = apply(scene, plan.ops);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'b', faceSourceId: 'new', fingersSourceId: 'h' });
 expect(find(out, 'h', 'tracking')).toEqual(find(scene, 'h', 'tracking'));
});

it('keep unused slots: Face None, Body None, and Hands off keep the binding and the source of the slot', () => {
 const ifm = source('i', 'ifacialmocap', {}, { ...ifacial.config, phoneAddress: '192.168.1.9' } as TrackingConfig);
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), ifm, avatar('a', { bodySourceId: 'v', faceSourceId: 'i', fingersSourceId: 'v' }));
 const check = (choice: Parameters<typeof resolveSetup>[0], tracking: Avatar['tracking'], untouched: string, released: string[] = []) => {
  const plan = ready(planSetup(scene, 'a', resolveSetup(choice), null, undefined, 'new'));
  expect(plan.released).toEqual(released);
  expect(plan.ops.filter(o => 'entityId' in o && o.entityId === untouched)).toEqual([]);
  const out = apply(scene, plan.ops);
  expect(find(out, 'a', 'avatar').tracking).toEqual(tracking);
  expect(find(out, untouched, 'tracking')).toEqual(find(scene, untouched, 'tracking'));
 };
 // Face None: the face slot keeps the iFacialMocap source; the VMC source loses body and fingers and stops.
 check({ face: 'none', body: 'webcam', hands: true }, { bodySourceId: 'new', faceSourceId: 'i', fingersSourceId: 'new' }, 'i', ['v']);
 // Body None and Hands off: the VMC source keeps its slots and runs on; the iFacialMocap source loses the face slot and stops.
 check({ face: 'webcam', body: 'none', hands: true }, { bodySourceId: 'v', faceSourceId: 'new', fingersSourceId: 'v' }, 'v', ['i']);
 check({ face: 'webcam', body: 'same', hands: false }, { bodySourceId: 'new', faceSourceId: 'new', fingersSourceId: 'v' }, 'v', ['i']);
});

it('keep unused slots: a source that loses its last slot of this character stops; one that keeps a slot does not', () => {
 const ifm = source('i', 'ifacialmocap', {}, { ...ifacial.config, phoneAddress: '192.168.1.9' } as TrackingConfig);
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), ifm, avatar('a', { bodySourceId: 'v', faceSourceId: 'i', fingersSourceId: 'v' }));
 const all = ready(planSetup(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'webcam', hands: true }), null, undefined, 'new'));
 expect(all.parts.map(p => [p.sourceId, p.created])).toEqual([['i', false], ['new', true]]);
 expect(all.released).toEqual(['v']);
 expect(all.ops).toContainEqual({ kind: 'setTrackingConfig', entityId: 'v', config: vmc39539({ enabled: false }) });
 const out = apply(scene, all.ops);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new', faceSourceId: 'i', fingersSourceId: 'new' });
 expect(find(out, 'v', 'tracking').config.enabled).toBe(false);
 expect(find(out, 'i', 'tracking').config.enabled).toBe(true);
 // With Hands off, the fingers slot keeps the VMC source, so it runs on.
 const some = ready(planSetup(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'webcam', hands: false }), null, undefined, 'new'));
 expect(some.released).toEqual([]);
 expect(find(apply(scene, some.ops), 'v', 'tracking').config.enabled).toBe(true);
});

it('keep unused slots: cancel after a run that keeps the hand source restores the scene exactly', () => {
 const scene = handScene();
 const { snapshot, connected } = run(scene, 'a', resolveSetup({ face: 'ifacialmocap', body: 'webcam', hands: false }), '192.168.1.40');
 expect(find(connected, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'new-2', faceSourceId: 'new', fingersSourceId: 'h' });
 expect(find(connected, 'b', 'tracking').config.enabled).toBe(false);
 const out = apply(connected, planCancel(connected, snapshot));
 expect(find(out, 'a', 'avatar')).toEqual(find(scene, 'a', 'avatar'));
 for (const id of ['b', 'h']) expect(restorable(find(out, id, 'tracking'))).toEqual(restorable(find(scene, id, 'tracking')));
 expect(find(out, 'h', 'tracking')).toEqual(find(scene, 'h', 'tracking'));
 expect(out.entities.filter(e => e.kind === 'tracking').map(e => e.id)).toEqual(['b', 'h']);
});
