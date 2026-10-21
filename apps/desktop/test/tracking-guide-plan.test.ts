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

it('asks for the phone when another character holds the endpoint, and touches nothing', () => {
 const scene = sceneOf(source('s1', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }), avatar('b', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'b', selfReflect, null, true, 'new');
 expect(plan).toEqual({ operations: [], sourceId: 'new', created: false, needsPhone: true });
});

it('with a phone address creates a new source that shares the endpoint', () => {
 const scene = sceneOf(source('s1', 'vmc', {}, vmc39539()), avatar('a', { bodySourceId: 's1', faceSourceId: 's1' }), avatar('b', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'b', selfReflect, '192.168.1.20', undefined, 'new');
 expect(plan).toMatchObject({ sourceId: 'new', created: true, needsPhone: false });
 const out = apply(scene, plan.operations);
 expect(find(out, 'new', 'tracking').config).toMatchObject({ kind: 'vmc', port: 39539, senderAddress: '192.168.1.20', enabled: true });
 expect(find(out, 'a', 'avatar').tracking?.bodySourceId).toBe('s1');
 expect(find(out, 'b', 'avatar').tracking?.faceSourceId).toBe('new');
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

it('cancel removes a created source and nothing else', () => {
 const scene = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const plan = planConnect(scene, 'a', selfReflect, null, true, 'new');
 const connected = apply(scene, plan.operations);
 const snapshot: GuideSnapshot = { avatarId: 'a', tracking: undefined, sourceId: 'new', created: true, mapping: undefined };
 const ops = planCancel(connected, snapshot, true);
 expect(ops).toEqual([{ kind: 'removeEntity', entityId: 'new' }]);
 const out = apply(connected, ops);
 expect(out.entities.some(e => e.id === 'new')).toBe(false);
 expect(find(out, 'a', 'avatar').tracking).toEqual({ bodySourceId: null, faceSourceId: null });
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

it('cancel: a missing source has no operation, a missing avatar gives an empty plan', () => {
 const snapshot: GuideSnapshot = { avatarId: 'a', tracking: { bodySourceId: 's1', faceSourceId: 's1' }, sourceId: 's1', created: false, mapping: undefined };
 const noSource = sceneOf(avatar('a', { bodySourceId: null, faceSourceId: null }));
 const ops = planCancel(noSource, snapshot, true);
 expect(ops).toEqual([{ kind: 'setAvatarTracking', entityId: 'a', tracking: { bodySourceId: null, faceSourceId: null } }]);
 apply(noSource, ops);
 expect(planCancel(noSource, { ...snapshot, created: true }, true)).toEqual([]);
 expect(planCancel(sceneOf(source('s1', 'vmc')), snapshot, true)).toEqual([]);
});
