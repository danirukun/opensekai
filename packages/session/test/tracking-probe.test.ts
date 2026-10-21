import { expect, it } from 'vitest';
import { defaultTrackingConfig, makeSmokeScene, type SceneEntity, type TrackingConfig } from '@opensekai/contracts';
import { createSession } from '../src/session';

const transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
function setup(mapping?: unknown) {
 const session = createSession(makeSmokeScene(), 'probe');
 const config = defaultTrackingConfig('vmc');
 config.enabled = true;
 const entity = { id: 'face', name: 'Face', visible: true, transform, kind: 'tracking', generation: 0, config, ...(mapping ? { mapping } : {}) } as SceneEntity;
 expect(session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'createEntity', entity }] }).ok).toBe(true);
 const generation = () => (session.inspect().entities.find(e => e.id === 'face') as { generation: number }).generation;
 const ingest = (at: number, expressions: Record<string, number>, bones: Record<string, unknown> = {}) =>
  expect(session.ingestTracking({ samples: [{ sourceId: 'face', generation: generation(), receivedAtMs: at, bones: bones as never, expressions }], statuses: [] }).ok).toBe(true);
 const probe = (resetPeaks?: boolean) => {
  const reply = session.probeTracking({ sourceId: 'face', ...(resetPeaks === undefined ? {} : { resetPeaks }) });
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.data;
 };
 return { session, generation, ingest, probe };
}

it('values are smoothed, canonical, and before mapping', () => {
 const range = { inputMin: 0, inputMax: .5, outputMin: 0, outputMax: 1 };
 const { session, ingest, probe } = setup({ headIntensity: 1, headOffset: [0, 0, 0], eyeIntensity: 1, blendShapeSensitivity: 1, linkedBlink: false, blendShapes: { jawOpen: range } });
 ingest(100, { jawOpen: .2 });
 ingest(110, { jawOpen: .6 });
 session.advance(0, 110);
 const smoothed = (session as unknown as { runPeaks(id: string): Record<string, number> }).runPeaks('face').jawOpen!;
 const data = probe();
 expect(data.values.jawOpen).toBeGreaterThan(.2);
 expect(data.values.jawOpen).toBeLessThan(.6);
 expect(data.values.jawOpen).toBeCloseTo(smoothed, 10);
 expect(data.state).toBe('receiving');
});
it('two sender names for one channel merge by max', () => {
 const { session, ingest, probe } = setup();
 ingest(100, { eyeBlink_L: .2, eyeBlinkLeft: .6 });
 session.advance(0, 100);
 const data = probe();
 expect(data.values.eyeBlinkLeft).toBeCloseTo(.6, 6);
 expect(data.presentChannels.filter(name => name === 'eyeBlinkLeft')).toHaveLength(1);
});
it('peaks keep the max until resetPeaks', () => {
 const { session, ingest, probe } = setup();
 for (const [at, value] of [[100, .1], [110, .4], [120, .2]] as const) ingest(at, { jawOpen: value });
 session.advance(0, 120);
 const peak = probe(true).peaks.jawOpen!;
 expect(peak).toBeGreaterThan(.1);
 expect(peak).toBeLessThanOrEqual(.4 + 1e-9);
 expect(probe().peaks).toEqual({});
 ingest(130, { jawOpen: 0 });
 session.advance(0, 130);
 const next = probe();
 expect(next.peaks.jawOpen).toBeCloseTo(next.values.jawOpen!, 10);
 expect(next.peaks.jawOpen).toBeLessThan(peak);
});
it('a generation change clears the peaks', () => {
 const { session, generation, ingest, probe } = setup();
 ingest(100, { jawOpen: .4 });
 expect(probe().peaks.jawOpen).toBeGreaterThan(0);
 const before = generation();
 const config = { ...defaultTrackingConfig('vmc'), enabled: true, port: 39540 } as TrackingConfig;
 expect(session.applyPatch({ sceneId: 'scene_smoke', expectedRevision: session.inspect().revision, operations: [{ kind: 'setTrackingConfig', entityId: 'face', config }] }).ok).toBe(true);
 expect(generation()).toBe(before + 1);
 ingest(110, { jawOpen: .1 });
 const data = probe();
 expect(data.generation).toBe(before + 1);
 expect(data.peaks.jawOpen).toBeCloseTo(.1, 6);
});
it('eyeBones is true only when leftEye and rightEye are in the sample', () => {
 const { session, ingest, probe } = setup();
 const eye = { rotation: [0, 0, 0, 1], space: 'normalized' };
 ingest(100, { jawOpen: .1 }, { leftEye: eye });
 session.advance(0, 100);
 expect(probe().eyeBones).toBe(false);
 ingest(110, { jawOpen: .1 }, { leftEye: eye, rightEye: eye });
 session.advance(0, 110);
 expect(probe().eyeBones).toBe(true);
});
it('probeTracking rejects an unknown id and an avatar id', () => {
 const { session } = setup();
 expect(session.probeTracking({ sourceId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', ids: ['nope'] } });
 expect(session.probeTracking({ sourceId: 'performer' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Entity is not a tracking source' } });
});
it('state comes from the last advance, and a stale source reports no values', () => {
 const { session, ingest, probe } = setup();
 expect(probe().state).toBe('waiting');
 ingest(1000, { jawOpen: .3 });
 session.advance(0, 1000);
 expect(probe().state).toBe('receiving');
 session.advance(0, 1600);
 const stale = probe();
 expect(stale.state).toBe('stale');
 expect(stale.values).toEqual({});
 expect(stale.presentChannels).toEqual([]);
 expect(stale.peaks.jawOpen).toBeGreaterThan(0);
});
