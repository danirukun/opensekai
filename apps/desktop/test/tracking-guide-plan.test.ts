import { expect, it } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, PatchOpSchema, SceneViewSchema, TRACKING_PRESETS, type PatchOp, type SceneEntity, type SceneView, type TrackingConfig } from '@opensekai/contracts';
import { applyOperations } from '../../../packages/session/src/scene-ops';
import { makeAuthoringEntity, makeEmptyScene } from '../src/editor/authoring';
import { planCancel, planConnect, type GuideSnapshot } from '../src/editor/tracking-guide-plan';

const selfReflect = TRACKING_PRESETS[0]!;
const ifacial = TRACKING_PRESETS[1]!;
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

it('a source this character binds in a slot the preset does not fill is not adopted', () => {
 const bodyOnly = source('body', 'ifacialmocap', {}, ifacial.config);
 const scene = sceneOf(bodyOnly, avatar('a', { bodySourceId: 'body', faceSourceId: null }));
 const plan = planConnect(scene, 'a', ifacial, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'new', created: true });
});

it('a different-kind source in the slot stays in the scene; the new source takes the slot', () => {
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 'v', faceSourceId: 'v' }));
 const plan = planConnect(scene, 'a', ifacial, null, undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'new', created: true });
 const out = apply(scene, plan.operations);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'v', faceSourceId: 'new' });
 expect(out.entities.some(e => e.id === 'v')).toBe(true);
});

it('iFacialMocap binds only face and keeps body and fingers; the phone address goes in phoneAddress', () => {
 const scene = sceneOf(source('body', 'vmc'), avatar('a', { bodySourceId: 'body', faceSourceId: null, fingersSourceId: 'body' }));
 const plan = planConnect(scene, 'a', ifacial, '192.168.1.30', undefined, 'new');
 expect(plan.created).toBe(true);
 const out = apply(scene, plan.operations);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: 'body', faceSourceId: 'new', fingersSourceId: 'body' });
 expect(find(out, 'new', 'tracking').config).toMatchObject({ kind: 'ifacialmocap', phoneAddress: '192.168.1.30', enabled: true });
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

it('mapping: writes useEyeBones from a known flag, keeps other fields, never writes for unknown', () => {
 const mapping = { ...DEFAULT_TRACKING_MAPPING, headIntensity: 1.5, blendShapes: { jawOpen: { inputMin: 0.1, inputMax: 0.8, outputMin: 0, outputMax: 1 } } };
 const scene = sceneOf(source('s1', 'vmc', { mapping }, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }));
 const known = planConnect(scene, 'a', selfReflect, null, false, 'n');
 expect(known.operations).toContainEqual({ kind: 'setTrackingMapping', entityId: 's1', mapping: { ...mapping, useEyeBones: false } });
 apply(scene, known.operations);
 expect(planConnect(scene, 'a', selfReflect, null, undefined, 'n').operations.some(o => o.kind === 'setTrackingMapping')).toBe(false);
});

it('cancel removes a created source and restores the bindings', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'a', selfReflect, null, true, 'new');
 const connected = apply(scene, plan.operations);
 const snapshot: GuideSnapshot = { avatarId: 'a', tracking: { bodySourceId: null, faceSourceId: null }, sourceId: 'new', created: true, mapping: undefined };
 const ops = planCancel(connected, snapshot, true);
 expect(ops).toEqual([{ kind: 'removeEntity', entityId: 'new' }, { kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: null, faceSourceId: null } }]);
 const out = apply(connected, ops);
 expect(out.entities.some(e => e.id === 'new')).toBe(false);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: null, faceSourceId: null });
});

it('cancel gives the replaced VMC face source back after an iFacialMocap run', () => {
 const before = { bodySourceId: 'v', faceSourceId: 'v' };
 const scene = sceneOf(source('v', 'vmc', {}, vmc39539()), avatar('a', before));
 const connected = apply(scene, planConnect(scene, 'a', ifacial, null, undefined, 'new').operations);
 expect(find(connected, 'a', 'avatar').tracking?.faceSourceId).toBe('new');
 const out = apply(connected, planCancel(connected, { avatarId: 'a', tracking: before, sourceId: 'new', created: true, mapping: undefined }, false));
 expect(find(out, 'a', 'avatar').tracking).toEqual(before);
 expect(out.entities.some(e => e.id === 'new')).toBe(false);
});

it('cancel on a reused source restores bindings and the mapping, with or without a fit', () => {
 const before = { bodySourceId: 's1', faceSourceId: null };
 const scene = sceneOf(source('s1', 'vmc', {}, vmc39539()), avatar('a', before));
 const connected = apply(scene, planConnect(scene, 'a', selfReflect, null, false, 'n').operations);
 const snapshot: GuideSnapshot = { avatarId: 'a', tracking: before, sourceId: 's1', created: false, mapping: undefined };
 for (const fit of [false, true]) {
  const ops = planCancel(connected, snapshot, fit);
  expect(ops).toEqual([
   { kind: 'setAvatarTracking', entityId: 'a', tracking: before },
   { kind: 'setTrackingMapping', entityId: 's1', mapping: DEFAULT_TRACKING_MAPPING }
  ]);
  const out = apply(connected, ops);
  expect(find(out, 's1', 'tracking').mapping).toEqual(DEFAULT_TRACKING_MAPPING);
  expect(find(out, 'a', 'avatar').tracking).toEqual(before);
 }
 const mapping = { ...DEFAULT_TRACKING_MAPPING, headIntensity: 0.5 };
 expect(planCancel(connected, { ...snapshot, mapping }, false)[1]).toMatchObject({ mapping });
});

it('cancel: a missing source has no operation for it; a missing avatar still removes a created source', () => {
 const snapshot: GuideSnapshot = { avatarId: 'a', tracking: { bodySourceId: 's1', faceSourceId: 's1' }, sourceId: 's1', created: false, mapping: undefined };
 const noSource = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const ops = planCancel(noSource, snapshot, true);
 expect(ops).toEqual([{ kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: null, faceSourceId: null } }]);
 apply(noSource, ops);
 expect(planCancel(noSource, { ...snapshot, created: true }, true)).toEqual(ops);
 expect(planCancel(sceneOf(source('s1', 'vmc')), snapshot, true)).toEqual([]);
 expect(planCancel(sceneOf(source('s1', 'vmc')), { ...snapshot, created: true }, true)).toEqual([{ kind: 'removeEntity', entityId: 's1' }]);
});
