import { describe, expect, it } from 'vitest';
import { BlendShapeRangeSchema, DEFAULT_TRACKING_MAPPING, defaultTrackingConfig, makeSmokeScene, type SceneEntity, type SceneView, type TrackingMapping } from '@opensekai/contracts';
import { fitRanges, mergeFit } from '../src/blend-shape-fit';
import { createSession } from '../src/session';

const expectValid = (range: ReturnType<typeof fitRanges>) => {
 for (const r of Object.values(range)) {
  expect(r.inputMin).toBeGreaterThanOrEqual(0);
  expect(r.inputMin).toBeLessThan(r.inputMax);
  expect(r.inputMax).toBeLessThanOrEqual(1);
  expect(BlendShapeRangeSchema.safeParse(r).success).toBe(true);
 }
};

describe('fitRanges', () => {
 it('SelfReflect jawOpen', () => {
  const fitted = fitRanges({ jawOpen: 0 }, { jawOpen: .187 });
  expect(fitted.jawOpen).toEqual({ inputMin: .02, inputMax: .187 * .9, outputMin: 0, outputMax: 1 });
  expectValid(fitted);
 });
 it('a channel below the rise gets no range', () => expect(fitRanges({ cheekPuff: 0 }, { cheekPuff: .04 })).toEqual({}));
 it('a channel at exactly the rise gets a range', () => expectValid({ ...fitRanges({}, { cheekPuff: .05 }) }));
 it('a high resting value stays valid', () => {
  const fitted = fitRanges({ eyeSquintLeft: .3 }, { eyeSquintLeft: .36 });
  expectValid(fitted);
  expect(fitted.eyeSquintLeft!.inputMin).toBeCloseTo(.31);
 });
 it('a full peak stays inside 0..1', () => {
  const fitted = fitRanges({ eyeBlinkLeft: 0 }, { eyeBlinkLeft: 1 });
  expectValid(fitted);
  expect(fitted.eyeBlinkLeft!.inputMax).toBeCloseTo(.9);
  expectValid(fitRanges({ eyeBlinkLeft: .95 }, { eyeBlinkLeft: 1 }));
 });
 it('a missing neutral counts as 0', () => expect(fitRanges({}, { jawOpen: .5 })).toEqual(fitRanges({ jawOpen: 0 }, { jawOpen: .5 })));
});

describe('mergeFit', () => {
 it('keeps other ranges and fields', () => {
  const existing: TrackingMapping = { ...structuredClone(DEFAULT_TRACKING_MAPPING) as TrackingMapping, eyeIntensity: 1.5, linkedBlink: true, useEyeBones: true, headIntensity: .5, blendShapes: { jawOpen: { inputMin: .1, inputMax: .8, outputMin: 0, outputMax: 1 }, mouthSmileLeft: { inputMin: .2, inputMax: .6, outputMin: 0, outputMax: 1 } } };
  const fitted = fitRanges({}, { jawOpen: .4 });
  const merged = mergeFit(existing, fitted);
  expect(merged).toEqual({ ...existing, blendShapes: { ...existing.blendShapes, jawOpen: fitted.jawOpen } });
  expect(existing.blendShapes.jawOpen!.inputMin).toBe(.1);
 });
 it('starts from the default mapping', () => expect(mergeFit(undefined, {})).toEqual(DEFAULT_TRACKING_MAPPING));
});

const transform = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
function live(extra: Partial<Extract<SceneEntity, { kind: 'tracking' }>> = {}, expressions: Record<string, number> = { jawOpen: .5 }) {
 const scene: SceneView = makeSmokeScene();
 const config = defaultTrackingConfig('ifacialmocap');
 config.enabled = true;
 scene.entities.push({ id: 'face', kind: 'tracking', name: 'face', visible: true, transform, config, generation: 1, smoothing: { enabled: false, minCutoff: 5, beta: .5, derivativeCutoff: 1 }, ...extra } as SceneEntity);
 const session = createSession(scene, 'fit');
 session.ingestTracking({ samples: [{ sourceId: 'face', generation: 1, receivedAtMs: 0, bones: {}, expressions }], statuses: [] });
 session.advance(16, 10);
 return session;
}
const fit = (session: ReturnType<typeof live>, extra: unknown[] = [], neutral: Record<string, number> = {}) => {
 const scene = session.inspect();
 return session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [...extra, { kind: 'fitBlendShapeRanges', entityId: 'face', neutral }] } as never);
};
const face = (session: ReturnType<typeof live>) => session.inspect().entities.find(e => e.id === 'face') as Extract<SceneEntity, { kind: 'tracking' }>;

describe('session fitBlendShapeRanges', () => {
 it('the live patch saves the merged mapping and increases the revision once', () => {
  const kept: TrackingMapping = { ...structuredClone(DEFAULT_TRACKING_MAPPING) as TrackingMapping, eyeIntensity: 1.5, useEyeBones: true, blendShapes: { mouthSmileLeft: { inputMin: .2, inputMax: .6, outputMin: 0, outputMax: 1 } } };
  const session = live({ mapping: kept });
  const before = session.inspect().revision;
  expect(fit(session)).toEqual({ ok: true, data: { revision: before + 1 } });
  expect(face(session).mapping).toEqual({ ...kept, blendShapes: { ...kept.blendShapes, jawOpen: { inputMin: .02, inputMax: .45, outputMin: 0, outputMax: 1 } } });
 });
 it('reads the neutral from the operation', () => {
  const session = live();
  expect(fit(session, [], { jawOpen: .48 }).ok).toBe(false);
  expect(fit(session, [], { jawOpen: .1 }).ok).toBe(true);
  expect(face(session).mapping!.blendShapes.jawOpen!.inputMin).toBeCloseTo(.12);
 });
 it('no channel rose → INVALID_INPUT with the source id', () => {
  const session = live();
  const before = session.inspect();
  expect(fit(session, [], { jawOpen: .5 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  expect(session.inspect()).toEqual(before);
 });
 it('fails without a current sample, on a missing source, and on a non-tracking entity', () => {
  const session = live();
  session.advance(32, 5000);
  expect(fit(session)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  const scene = session.inspect();
  const op = (entityId: string) => session.applyPatch({ sceneId: scene.sceneId, expectedRevision: scene.revision, operations: [{ kind: 'fitBlendShapeRanges', entityId, neutral: {} }] });
  expect(op('nope')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(op('performer')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['performer'] } });
 });
 it('fails in a patch that also reconfigures or removes the source', () => {
  const session = live();
  const config = face(session).config;
  expect(fit(session, [{ kind: 'setTrackingConfig', entityId: 'face', config }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
  expect(fit(session, [{ kind: 'removeEntity', entityId: 'face' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', ids: ['face'] } });
 });
 it('rejects a neutral with an unknown name or a value above 1', () => {
  const session = live();
  expect(fit(session, [], { notAChannel: 0 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  expect(fit(session, [], { jawOpen: 1.5 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 });
});
