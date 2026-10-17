import { expect, it } from 'vitest';
import { makeSmokeScene, type AssetRecord, type BlueprintGraph, type ExpressionSettings, type SceneView } from '@opensekai/contracts';
import { createSession } from '../src/session';

const record: AssetRecord = {
 id: 'fixture_vrm_1', format: 'vrm', sha256: 'a'.repeat(64), bytes: 1, sourceUrl: null, licenseLabel: 'test', importerVersion: 1, name: 'Rem',
 expressions: [
  { name: 'happy', preset: true }, { name: 'aa', preset: true }, { name: 'blink', preset: true }, { name: 'sad', preset: true },
  { name: 'Wink', preset: false }, { name: 'mouthSmile_L', preset: false }, { name: 'Tears', preset: false },
 ],
};
const other: AssetRecord = { ...record, id: 'avatar_other', expressions: [{ name: 'happy', preset: true }] };
const patch = (revision: number, operations: unknown[]) => ({ sceneId: 'scene_smoke', expectedRevision: revision, operations } as never);
const start = (scene: SceneView = makeSmokeScene()) => createSession(scene, 's', [record, other]);
const view = (s: ReturnType<typeof start>) => { const reply = s.getExpressions('performer'); if (!reply.ok) throw new Error(reply.error.message); return reply.data.expressions; };
const pose = (frame: ReturnType<ReturnType<typeof start>['advance']>) => frame.avatarPoses?.find(item => item.avatarId === 'performer');
const settings = (patchValue: Partial<ExpressionSettings> = {}): ExpressionSettings => ({ layer: 0, fadeSeconds: 0.4, suppress: { blink: false, mouth: false, brow: false }, ...patchValue });

it('lists triggerable expressions in record order with Warudo default settings', () => {
 expect(view(start()).map(({ name, preset, layer, fadeSeconds, active, weight }) => [name, preset, layer, fadeSeconds, active, weight])).toEqual([
  ['happy', true, 0, 0.4, false, 0], ['sad', true, 0, 0.4, false, 0], ['Wink', false, 1, 0.4, false, 0], ['Tears', false, 2, 0.4, false, 0],
 ]);
});

it('fades in over the fade time without a scene revision, and replaces an expression on the same layer', () => {
 const s = start();
 s.advance(0);
 const reply = s.setExpression('performer', 'happy', true);
 expect(reply.ok && reply.data.expressions.find(item => item.name === 'happy')).toMatchObject({ active: true, weight: 0 });
 expect(pose(s.advance(200))?.expressions.happy).toBeCloseTo(0.5);
 expect(pose(s.advance(400))?.expressions.happy).toBe(1);
 expect(s.inspect().revision).toBe(0);
 s.setExpression('performer', 'Wink', true);
 s.setExpression('performer', 'sad', true);
 const frame = s.advance(600);
 expect(pose(frame)?.expressions).toMatchObject({ Wink: 0.5 });
 expect(pose(frame)?.expressions.happy).toBeCloseTo(0.5);
 expect(pose(frame)?.expressions.sad).toBeCloseTo(0.5);
 expect(view(s).filter(item => item.active).map(item => item.name)).toEqual(['sad', 'Wink']);
 s.setExpression('performer', 'sad', false);
 s.setExpression('performer', 'Wink', false);
 s.advance(1200);
 expect(pose(s.advance(1300))).toBeUndefined();
});

it('rejects unknown, tracked, and non-avatar targets', () => {
 const s = start();
 expect(s.setExpression('performer', 'aa', true)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.setExpression('performer', 'mouthSmile_L', true)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.setExpression('performer', 'Missing', true)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.setExpression('marker', 'happy', true)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.setExpression('nobody', 'happy', true)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(s.getExpressions('nobody')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(s.getExpressions('marker')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('returns an empty list for a model without a record and learns new records', () => {
 const s = createSession(makeSmokeScene(), 's');
 expect(view(s)).toEqual([]);
 s.setAssetRecords([record]);
 expect(view(s)).toHaveLength(4);
});

it('stores settings with setAvatarExpression, keeps them for an absent name, and removes the key on the last reset', () => {
 const s = start();
 expect(s.applyPatch(patch(0, [{ kind: 'setAvatarExpression', entityId: 'performer', name: 'happy', settings: settings({ layer: 3, fadeSeconds: 0 }) }, { kind: 'setAvatarExpression', entityId: 'performer', name: 'NotInModel', settings: settings() }])).ok).toBe(true);
 expect(view(s)[0]).toMatchObject({ name: 'happy', layer: 3, fadeSeconds: 0 });
 s.advance(0);
 s.setExpression('performer', 'happy', true);
 expect(pose(s.advance(16))?.expressions.happy).toBe(1);
 expect(s.applyPatch(patch(1, [{ kind: 'setAvatarExpression', entityId: 'performer', name: 'happy', settings: null }, { kind: 'setAvatarExpression', entityId: 'performer', name: 'NotInModel', settings: null }])).ok).toBe(true);
 expect(s.inspect().entities.find(item => item.id === 'performer')).not.toHaveProperty('expressions');
 expect(s.applyPatch(patch(2, [{ kind: 'setAvatarExpression', entityId: 'marker', name: 'happy', settings: null }]))).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(s.applyPatch(patch(2, [{ kind: 'setAvatarExpression', entityId: 'nobody', name: 'happy', settings: null }]))).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

it('suppresses tracking groups by the expression weight and merges with max', () => {
 const scene = makeSmokeScene();
 scene.entities.push({ id: 'face', name: 'Face', visible: true, transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, kind: 'tracking', generation: 0, config: { kind: 'ifacialmocap', enabled: true, bindAddress: '0.0.0.0', port: 49983, phoneAddress: null }, smoothing: { enabled: false, minCutoff: 5, beta: 0.5, derivativeCutoff: 1 } });
 const performer = scene.entities.find(item => item.id === 'performer')!;
 if (performer.kind === 'avatar') { performer.tracking = { bodySourceId: null, faceSourceId: 'face' }; performer.expressions = { happy: settings({ fadeSeconds: 1, suppress: { blink: true, mouth: true, brow: false } }) }; }
 const s = start(scene);
 const sample = (at: number) => s.ingestTracking({ samples: [{ sourceId: 'face', generation: 0, receivedAtMs: at, bones: {}, expressions: { eyeBlinkLeft: 1, jawOpen: 0.8, browInnerUp: 0.6, happy: 0.9 } }], statuses: [] });
 sample(0); s.advance(0, 0);
 s.setExpression('performer', 'happy', true);
 sample(500);
 const expressions = pose(s.advance(500, 500))!.expressions;
 expect(expressions.eyeBlinkLeft).toBeCloseTo(0.5);
 expect(expressions.jawOpen).toBeCloseTo(0.4);
 expect(expressions.browInnerUp).toBeCloseTo(0.6);
 expect(expressions.happy).toBeCloseTo(0.9);
});

it('clears active state on model change, removal, and show open', () => {
 const s = start();
 s.advance(0);
 s.setExpression('performer', 'happy', true);
 expect(s.applyPatch(patch(0, [{ kind: 'setAvatarModel', entityId: 'performer', assetId: 'avatar_other' }])).ok).toBe(true);
 expect(view(s)).toEqual([expect.objectContaining({ name: 'happy', active: false, weight: 0 })]);
 expect(s.applyPatch(patch(1, [{ kind: 'setAvatarModel', entityId: 'performer', assetId: 'fixture_vrm_1' }])).ok).toBe(true);
 expect(view(s)[0]).toMatchObject({ active: false });
 s.setExpression('performer', 'happy', true);
 expect(s.replaceScene(s.inspect(), 2).ok).toBe(true);
 expect(view(s)[0]).toMatchObject({ active: false });
 s.setExpression('performer', 'happy', true);
 const removed = s.inspect();
 removed.entities = removed.entities.filter(item => item.id !== 'performer');
 expect(s.applyPatch(patch(3, [{ kind: 'removeEntity', entityId: 'performer' }])).ok).toBe(true);
 expect(s.applyPatch(patch(4, [{ kind: 'createEntity', entity: makeSmokeScene().entities.find(item => item.id === 'performer') }])).ok).toBe(true);
 expect(view(s)[0]).toMatchObject({ active: false });
});

const at = { x: 0, y: 0 };
const graph = (nodes: unknown[], connections: unknown[]) => ({ schemaVersion: 1, id: 'faces', name: 'Faces', enabled: true, variables: [], nodes, connections } as unknown as BlueprintGraph);
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const load = (s: ReturnType<typeof start>, graphs: unknown[]) => s.editBlueprints({ clientId: 't', batchId: crypto.randomUUID(), ops: [{ kind: 'replaceAll', graphs }] });

it('toggles an expression from a Blueprint hotkey without a scene revision', () => {
 const s = start();
 expect(load(s, [graph([
  { id: 'key', version: 1, type: 'event.keystroke', settings: { code: 'KeyH', control: true, alt: true, shift: false, meta: false }, position: at },
  { id: 'toggle', version: 1, type: 'character.toggleExpression', settings: { entityId: 'performer', expression: 'happy' }, position: at },
 ], [wire('a', 'key', 'flow', 'toggle', 'flow')])]).ok).toBe(true);
 s.advance(0);
 s.advance(16, 16, { events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }] });
 expect(view(s)[0]).toMatchObject({ active: true });
 s.advance(32, 32, { events: [{ kind: 'keystroke', accelerator: 'Control+Alt+KeyH' }] });
 expect(view(s)[0]).toMatchObject({ active: false });
 expect(s.inspect().revision).toBe(0);
});

it('makes a failed expression effect the runtime error of its graph and keeps the scene effects of that run out', () => {
 const s = start();
 expect(load(s, [graph([
  { id: 'run', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'hide', version: 1, type: 'scene.toggleVisibility', settings: { entityId: 'marker' }, position: at },
  { id: 'on', version: 1, type: 'value.boolean', settings: { value: true }, position: at },
  { id: 'set', version: 1, type: 'character.setExpression', settings: { entityId: 'performer', expression: 'Missing' }, position: at },
 ], [wire('a', 'run', 'flow', 'hide', 'flow'), wire('b', 'hide', 'exit', 'set', 'flow'), wire('c', 'on', 'value', 'set', 'active')])]).ok).toBe(true);
 expect(s.runBlueprint('faces', 'run')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Expression not found' } });
 expect(s.inspect().entities.find(item => item.id === 'marker')?.visible).toBe(true);
 expect(s.inspectBlueprints().errors).toEqual([expect.objectContaining({ graphId: 'faces', kind: 'runtime' })]);
});

it('sets an expression from a Blueprint with its boolean input', () => {
 const s = start();
 expect(load(s, [graph([
  { id: 'run', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'on', version: 1, type: 'value.boolean', settings: { value: true }, position: at },
  { id: 'set', version: 1, type: 'character.setExpression', settings: { entityId: 'performer', expression: 'Tears' }, position: at },
 ], [wire('a', 'run', 'flow', 'set', 'flow'), wire('c', 'on', 'value', 'set', 'active')])]).ok).toBe(true);
 expect(s.runBlueprint('faces', 'run')).toEqual({ ok: true, data: { revision: 0 } });
 expect(view(s).find(item => item.name === 'Tears')).toMatchObject({ active: true });
});
