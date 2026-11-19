// Session boundary: each guide patch goes through the real session, which checks the scene schema
// (the limit of 4 sources, face-only kinds only in the face slot) and the rule that one source belongs to one character.
import { expect, it, vi } from 'vitest';
import { DEFAULT_TRACKING_MAPPING, makeSmokeScene, type AppApi, type Reply, type SceneEntity, type SceneView } from '@opensekai/contracts';
import { createSession } from '@opensekai/session';
import { createEditorModel } from '../src/editor/model';
import { makeAuthoringEntity } from '../src/editor/authoring';
import { planCancel, planSetup, setupSnapshot, type SetupPlan } from '../src/editor/tracking-guide-plan';
import { applySetup, removeGuideGraph } from '../src/editor/tracking-guide-graph';
import { createBlueprintSync } from '../src/blueprints/blueprint-sync';
import { resolveSetup, type SetupChoice } from '../src/editor/tracking-guide-setup';

type Source = Extract<SceneEntity, { kind: 'tracking' }>;
function fixture() {
 const session = createSession(makeSmokeScene(), 'test_session');
 const unsupported = async (): Promise<Reply<never>> => ({ ok: false, error: { code: 'UNSUPPORTED', message: 'Unsupported', ids: [] } });
 const api: AppApi = {
  appStatus: unsupported, sceneInspect: vi.fn(async () => ({ ok: true as const, data: session.inspect() })),
  scenePatch: vi.fn(async params => session.applyPatch(params)), cameraSelect: vi.fn(async params => session.selectCamera(params)),
  sceneReplace: vi.fn(async params => session.replaceScene(params.scene, params.expectedRevision)),
  blueprintRun: unsupported, captureFrame: unsupported, benchmarkStart: unsupported, benchmarkStatus: unsupported, benchmarkCancel: unsupported, evidenceRead: unsupported,
 };
 return { session, model: createEditorModel(api) };
}
const scene = (model: ReturnType<typeof createEditorModel>): SceneView => model.read().scene!;
const ready = (plan: SetupPlan) => { if ('blocked' in plan) throw new Error('blocked'); return plan; };
const avatarOf = (s: SceneView, id: string) => s.entities.find(e => e.id === id && e.kind === 'avatar') as Extract<SceneEntity, { kind: 'avatar' }>;
// The host counts config changes in `generation`, and an absent mapping is the default mapping.
const sources = (s: SceneView) => s.entities.filter((e): e is Source => e.kind === 'tracking').map(e => ({ ...e, generation: 0, mapping: e.mapping ?? DEFAULT_TRACKING_MAPPING }));

async function setUp(model: ReturnType<typeof createEditorModel>, avatarId: string, choice: SetupChoice, phone: string | null, newId: string) {
 const before = scene(model);
 const plan = ready(planSetup(before, avatarId, resolveSetup(choice), phone, true, newId));
 const reply = await model.applyOperations(plan.ops, before.revision);
 expect(reply.ok ? null : reply.error).toBeNull();
 return { plan, snapshot: setupSnapshot(before, avatarId, plan) };
}

it('applies the two-part patches and binds each slot', async () => {
 const { model } = fixture(); await model.load();
 await setUp(model, 'performer', { face: 'ifacialmocap', body: 'selfreflect', hands: true }, '127.0.0.1', 'one');
 expect(avatarOf(scene(model), 'performer').tracking).toEqual({ bodySourceId: 'one-2', faceSourceId: 'one', fingersSourceId: 'one-2' });
 const second = await setUp(model, 'performer', { face: 'vmc', body: 'selfreflect', hands: true }, null, 'two');
 expect(second.plan.parts.map(p => [p.sourceId, p.port])).toEqual([['two', 39540], ['one-2', 39539]]);
 expect(second.plan.released).toEqual(['one']);
 const after = scene(model);
 expect(avatarOf(after, 'performer').tracking).toEqual({ bodySourceId: 'one-2', faceSourceId: 'two', fingersSourceId: 'one-2' });
 expect(after.entities.find(e => e.id === 'one')).toMatchObject({ config: { kind: 'ifacialmocap', enabled: false } });
 // Three sources and two new ones would pass the limit of 4.
 expect(planSetup(scene(model), 'performer', resolveSetup({ face: 'facekit', body: 'webcam', hands: true }), null, true, 'x')).toEqual({ blocked: 'sourceLimit' });
 await setUp(model, 'performer', { face: 'facekit', body: 'selfreflect', hands: true }, null, 'three');
 const last = scene(model);
 expect(sources(last)).toHaveLength(4);
 expect(avatarOf(last, 'performer').tracking).toEqual({ bodySourceId: 'one-2', faceSourceId: 'three', fingersSourceId: 'one-2' });
 expect(last.entities.find(e => e.id === 'two')).toMatchObject({ config: { kind: 'vmc', enabled: false } });
 // A full scene still takes a run that reuses its sources.
 const { plan } = await setUp(model, 'performer', { face: 'ifacialmocap', body: 'vmc', hands: true }, '127.0.0.1', 'four');
 expect(plan.parts.map(p => [p.sourceId, p.created])).toEqual([['one', false], ['one-2', false]]);
 expect(scene(model).entities.find(e => e.id === 'one')).toMatchObject({ config: { kind: 'ifacialmocap', enabled: true } });
});

it('a cancel patch gives back the tracking sources and the binding of the snapshot', async () => {
 const { model } = fixture(); await model.load();
 await setUp(model, 'performer', { face: 'selfreflect', body: 'same', hands: true }, null, 'first');
 const before = scene(model);
 // Face and body move to new sources, so the first source fills no slot and stops.
 const { snapshot } = await setUp(model, 'performer', { face: 'ifacialmocap', body: 'webcam', hands: true }, '127.0.0.1', 'second');
 expect(avatarOf(scene(model), 'performer').tracking).toEqual({ bodySourceId: 'second-2', faceSourceId: 'second', fingersSourceId: 'second-2' });
 expect(scene(model).entities.find(e => e.id === 'first')).toMatchObject({ config: { enabled: false } });
 const reply = await model.applyOperations(planCancel(scene(model), snapshot), scene(model).revision);
 expect(reply.ok).toBe(true);
 const after = scene(model);
 expect(sources(after)).toEqual(sources(before));
 expect(avatarOf(after, 'performer').tracking).toEqual(avatarOf(before, 'performer').tracking);
});

it('a run on the second character never changes the source of the first', async () => {
 const { model } = fixture(); await model.load();
 await setUp(model, 'performer', { face: 'vmc', body: 'same', hands: true }, null, 'a-vmc');
 const second = makeAuthoringEntity('character', 'b', scene(model).entities);
 expect((await model.applyOperations([{ kind: 'createEntity', entity: second }], scene(model).revision)).ok).toBe(true);
 const before = scene(model);
 const { plan } = await setUp(model, 'b', { face: 'selfreflect', body: 'same', hands: true }, null, 'b-vmc');
 expect(plan.parts.map(p => [p.sourceId, p.created, p.port])).toEqual([['b-vmc', true, 39540]]);
 const after = scene(model);
 expect(avatarOf(after, 'performer').tracking).toEqual(avatarOf(before, 'performer').tracking);
 expect(after.entities.find(e => e.id === 'a-vmc')).toEqual(before.entities.find(e => e.id === 'a-vmc'));
 expect(avatarOf(after, 'b').tracking).toEqual({ bodySourceId: 'b-vmc', faceSourceId: 'b-vmc', fingersSourceId: 'b-vmc' });
});

// The graph edit goes through the blueprint edit channel of the same session, not through the scene patch.
async function graphFixture() {
 const { session, model } = fixture(); await model.load();
 const sync = createBlueprintSync({ blueprintEdit: async batch => session.editBlueprints(batch), blueprintInspect: async ({ sinceRevision }) => ({ ok: true, data: session.inspectBlueprints(sinceRevision) }) }, 'guide');
 await sync.load();
 const edit = vi.spyOn(sync, 'edit');
 return { session, model, sync, edit };
}
const graphNames = (sync: { view(): { name: string }[] }) => sync.view().map(g => g.name);

it('a face-only run creates the Face-Only Body Motion graph after the connect, and Cancel removes it', async () => {
 const { session, model, sync, edit } = await graphFixture();
 const before = scene(model);
 const plan = ready(planSetup(before, 'performer', resolveSetup({ face: 'vmc', body: 'none', hands: false }), null, true, 'face'));
 const applied = await applySetup(model, sync, before, 'performer', plan, () => crypto.randomUUID());
 expect(applied.reply.ok).toBe(true);
 expect(edit).toHaveBeenCalledTimes(1);
 const ops = edit.mock.calls[0]![0];
 expect(ops).toHaveLength(1);
 expect(ops[0]).toMatchObject({ kind: 'createGraph', graph: { name: 'Face-Only Body Motion' } });
 expect(applied.graphId).toBe(ops[0]!.kind === 'createGraph' ? ops[0].graph.id : null);
 await sync.idle();
 expect(session.inspectBlueprints().kind === 'snapshot' && session.inspectBlueprints().blueprints.map(g => g.id)).toEqual([applied.graphId]);

 const snapshot = { ...setupSnapshot(before, 'performer', plan), graphId: applied.graphId };
 expect((await model.applyOperations(planCancel(scene(model), snapshot), scene(model).revision)).ok).toBe(true);
 expect(removeGuideGraph(sync, snapshot.graphId!).ok).toBe(true);
 expect(edit).toHaveBeenLastCalledWith([{ kind: 'removeGraph', graphId: applied.graphId }]);
 await sync.idle();
 expect(graphNames(sync)).toEqual([]);
 expect(avatarOf(scene(model), 'performer').tracking).toEqual({ bodySourceId: null, faceSourceId: null });
});

it('a failed connect creates no graph', async () => {
 const { model, sync, edit } = await graphFixture();
 const before = scene(model);
 const plan = ready(planSetup(before, 'performer', resolveSetup({ face: 'vmc', body: 'none', hands: false }), null, true, 'face'));
 const applied = await applySetup(model, sync, { ...before, revision: before.revision + 100 }, 'performer', plan, () => crypto.randomUUID());
 expect(applied.reply.ok).toBe(false);
 expect(applied.graphId).toBeUndefined();
 expect(edit).not.toHaveBeenCalled();
 expect(graphNames(sync)).toEqual([]);
});

it('a run with a body part creates no graph, and a later face-only run that keeps that body source creates none', async () => {
 const { model, sync, edit } = await graphFixture();
 const first = scene(model);
 const withBody = ready(planSetup(first, 'performer', resolveSetup({ face: 'vmc', body: 'webcam', hands: false }), null, true, 'a'));
 expect((await applySetup(model, sync, first, 'performer', withBody, () => crypto.randomUUID())).graphId).toBeUndefined();
 expect(edit).not.toHaveBeenCalled();
 const second = scene(model);
 const faceOnly = ready(planSetup(second, 'performer', resolveSetup({ face: 'vmc', body: 'none', hands: false }), null, true, 'b'));
 expect((await applySetup(model, sync, second, 'performer', faceOnly, () => crypto.randomUUID())).graphId).toBeUndefined();
 expect(avatarOf(scene(model), 'performer').tracking?.bodySourceId).not.toBeNull();
 expect(edit).not.toHaveBeenCalled();
});

it('a face-only run on the second character makes a graph that targets that character', async () => {
 const { model, sync } = await graphFixture();
 const second = makeAuthoringEntity('character', 'b', scene(model).entities);
 expect((await model.applyOperations([{ kind: 'createEntity', entity: second }], scene(model).revision)).ok).toBe(true);
 const before = scene(model);
 const plan = ready(planSetup(before, 'b', resolveSetup({ face: 'vmc', body: 'none', hands: false }), null, true, 'face-b'));
 const applied = await applySetup(model, sync, before, 'b', plan, () => crypto.randomUUID());
 expect(applied.graphError).toBeUndefined();
 const graph = sync.view().find(g => g.id === applied.graphId)!;
 const targets = new Set(graph.nodes.flatMap(n => 'entityId' in n.settings ? [n.settings.entityId] : []));
 expect([...targets]).toEqual(['b']);
});
