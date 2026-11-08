import { describe, expect, it } from 'vitest';
import { applyBlueprintOps, BlueprintGraphSchema, BlueprintSetSchema, type BlueprintGraph, type Reply } from '@opensekai/contracts';
import { assignRefs, compileIntents, WORDS, type Intent, type Proposal } from '../src';
import { ctx, graph, graphs, summaryRefs } from './context';

const data = <T>(r: Reply<T>): T => { if (!r.ok) throw new Error(r.error.message); return r.data; };
const graphOf = (p: Proposal, i = 0): BlueprintGraph => {
 const op = p.blueprintOps[i];
 if (op?.kind !== 'createGraph') throw new Error('not a createGraph');
 return op.graph;
};
type Build = Extract<Intent, { tool: 'blueprint_build' }>;
const build = (over: Partial<Build> = {}): Intent => ({
 tool: 'blueprint_build', name: 'Heart on Super Chat', trigger: { kind: 'youtube', event: 'superChat' },
 actions: [{ kind: 'expression', character: '@e1', expression: 'heart', mode: 'on' }], ...over,
});
const flowOrder = (g: BlueprintGraph) => {
 const out = ['trigger'];
 for (let id = g.connections.find(c => c.sourceNodeId === 'trigger')?.targetNodeId; id; id = g.connections.find(c => c.sourceNodeId === id && c.sourcePort === 'exit')?.targetNodeId) out.push(id);
 return out;
};
const invalidWith = (ids: string[], message: RegExp = /./) => ({ ok: false, error: { code: 'INVALID_INPUT', message: expect.stringMatching(message), ids } });

describe('compileIntents: blueprint_build', () => {
 it('builds a Super Chat to heart expression Blueprint', () => {
  const p = data(compileIntents([build()], ctx()));
  const g = graphOf(p);
  expect(BlueprintGraphSchema.safeParse(g).success).toBe(true);
  expect(BlueprintSetSchema.safeParse([g]).success).toBe(true);
  expect(g.name).toBe('Heart on Super Chat');
  expect(g.nodes.map(n => [n.id, n.type])).toEqual([['trigger', 'youtube.superChat'], ['action_1', 'character.setExpression']]);
  expect(g.nodes[1]).toMatchObject({ settings: { entityId: 'performer', expression: 'heart' }, inputs: { active: true } });
  expect(g.connections).toEqual([{ id: 'wire_1', sourceNodeId: 'trigger', sourcePort: 'flow', targetNodeId: 'action_1', targetPort: 'flow' }]);
  expect(p.created.blueprints).toEqual([g.id]);
  expect(p.refs.owned).toEqual([g.id]);
  expect(p.refs.blueprints[g.id]).toBe('@b1');
  expect(p.play).toEqual([]);
  expect(applyBlueprintOps([], p.blueprintOps).ok).toBe(true);
 });

 it('maps each action to its node in sequence', () => {
  const p = data(compileIntents([build({
   trigger: { kind: 'hotkey', key: 'Control+Shift+H' },
   actions: [
    { kind: 'expression', character: '@e1', expression: 'heart', mode: 'off' },
    { kind: 'expression', character: '@e1', expression: 'joy', mode: 'toggle' },
    { kind: 'visibility', entity: '@e5', mode: 'show' },
    { kind: 'visibility', entity: '@e5', mode: 'hide' },
    { kind: 'visibility', entity: '@e4', mode: 'toggle' },
    { kind: 'switchCamera', camera: '@e6' },
    { kind: 'wait', length: 'medium' },
    { kind: 'emit', name: 'Cheer' },
   ],
  })], ctx()));
  const g = graphOf(p);
  expect(BlueprintGraphSchema.safeParse(g).success).toBe(true);
  expect(flowOrder(g)).toEqual(['trigger', ...Array.from({ length: 8 }, (_, i) => `action_${i + 1}`)]);
  expect(g.nodes.map(n => ({ type: n.type, settings: n.settings, inputs: n.inputs }))).toEqual([
   { type: 'event.keystroke', settings: { code: 'KeyH', control: true, alt: false, shift: true, meta: false }, inputs: undefined },
   { type: 'character.setExpression', settings: { entityId: 'performer', expression: 'heart' }, inputs: { active: false } },
   { type: 'character.toggleExpression', settings: { entityId: 'performer', expression: 'joy' }, inputs: undefined },
   { type: 'scene.setVisibility', settings: { entityId: 'reference' }, inputs: { visible: true } },
   { type: 'scene.setVisibility', settings: { entityId: 'reference' }, inputs: { visible: false } },
   { type: 'scene.toggleVisibility', settings: { entityId: 'marker' }, inputs: undefined },
   { type: 'camera.switch', settings: { outputId: 'output_main', cameraId: 'camera_close' }, inputs: undefined },
   { type: 'flow.delay', settings: { seconds: WORDS.wait.medium }, inputs: undefined },
   { type: 'event.emit', settings: { name: 'Cheer', payload: 'none' }, inputs: undefined },
  ]);
 });

 it('maps each trigger to its event node', () => {
  const type = (trigger: Build['trigger']) => graphOf(data(compileIntents([build({ trigger })], ctx()))).nodes[0];
  expect(type({ kind: 'manual' })).toMatchObject({ type: 'event.manual', settings: {} });
  expect(type({ kind: 'event', name: 'Cheer' })).toMatchObject({ type: 'event.custom', settings: { name: 'Cheer', payload: 'none' } });
  expect(type({ kind: 'showStart' })).toMatchObject({ type: 'event.enable' });
  expect(type({ kind: 'youtube', event: 'chat' })).toMatchObject({ type: 'youtube.chat' });
  expect(type({ kind: 'youtube', event: 'memberMilestone' })).toMatchObject({ type: 'youtube.memberMilestone' });
  expect(type({ kind: 'hotkey', key: 'ctrl+alt+1' })).toMatchObject({ settings: { code: 'Digit1', control: true, alt: true, shift: false, meta: false } });
  expect(type({ kind: 'hotkey', key: 'Cmd + F5' })).toMatchObject({ settings: { code: 'F5', meta: true, control: false } });
  expect(type({ kind: 'hotkey', key: 'Alt+space' })).toMatchObject({ settings: { code: 'Space', alt: true } });
 });

 it('rejects a hotkey without a modifier or with an unknown key', () => {
  expect(compileIntents([build({ trigger: { kind: 'hotkey', key: 'H' } })], ctx())).toMatchObject(invalidWith([], /Control, Alt, or Meta/));
  expect(compileIntents([build({ trigger: { kind: 'hotkey', key: 'Control+Banana' } })], ctx())).toMatchObject(invalidWith([], /Banana/));
  expect(compileIntents([build({ trigger: { kind: 'hotkey', key: 'Control+Alt' } })], ctx())).toMatchObject(invalidWith([]));
 });

 it('rejects references of the wrong kind', () => {
  expect(compileIntents([build({ actions: [{ kind: 'expression', character: '@e2', expression: 'heart', mode: 'on' }] })], ctx())).toEqual(invalidWith(['@e2']));
  expect(compileIntents([build({ actions: [{ kind: 'switchCamera', camera: '@e1' }] })], ctx())).toEqual(invalidWith(['@e1']));
  expect(compileIntents([build({ actions: [{ kind: 'visibility', entity: '@a1', mode: 'show' }] })], ctx())).toEqual(invalidWith(['@a1']));
 });

 it('replaces only an owned Blueprint', () => {
  const old = graph('chat_old', 'Old');
  const refs = assignRefs(summaryRefs, { entities: [], blueprints: ['chat_old'], assets: [] });
  expect(compileIntents([build({ replace: '@b1' })], ctx({ blueprints: [old], refs }))).toEqual(invalidWith(['@b1']));
  expect(compileIntents([build({ replace: '@e1' })], ctx({ blueprints: [old], refs: { ...refs, owned: ['chat_old'] } }))).toEqual(invalidWith(['@e1']));
  const p = data(compileIntents([build({ replace: '@b1' })], ctx({ blueprints: [old], refs: { ...refs, owned: ['chat_old'] } })));
  expect(p.blueprintOps.map(o => o.kind)).toEqual(['removeGraph', 'createGraph']);
  expect(p.blueprintOps[0]).toEqual({ kind: 'removeGraph', graphId: 'chat_old' });
  expect(graphOf(p, 1).id).toBe('chat_old');
  expect(graphOf(p, 1).name).toBe('Heart on Super Chat');
  expect(p.touched.blueprints).toEqual(['chat_old']);
  expect(p.created.blueprints).toEqual([]);
  expect(p.notes).toEqual([{ code: 'replacedExisting', ref: '@b1' }]);
  const applied = applyBlueprintOps([old], p.blueprintOps);
  expect(applied.ok && applied.data.map(g => g.id)).toEqual(['chat_old']);
 });

 it('replaces a Blueprint that an earlier intent created and drops its Play', () => {
  const p = data(compileIntents([{ tool: 'camera_move', camera: '@e2', kind: 'pushIn' }, build({ replace: '@b1' })], ctx()));
  expect(p.blueprintOps.map(o => o.kind)).toEqual(['createGraph', 'removeGraph', 'createGraph']);
  expect(p.created.blueprints).toEqual(['chat_blueprint_1']);
  expect(p.touched.blueprints).toEqual([]);
  expect(p.play).toEqual([]);
  expect(applyBlueprintOps([], p.blueprintOps).ok).toBe(true);
 });

 it('fails at the Blueprint limit with a message that names it', () => {
  expect(compileIntents([build()], ctx({ blueprints: graphs(8) }))).toEqual(invalidWith([], /8 Blueprints/));
  expect(compileIntents([build(), build()], ctx({ blueprints: graphs(7) }))).toEqual(invalidWith([], /8 Blueprints/));
  // A replace keeps the count, so it works at the limit.
  const full = [...graphs(7), graph('chat_old')];
  const refs = { ...assignRefs(summaryRefs, { entities: [], blueprints: ['chat_old'], assets: [] }), owned: ['chat_old'] };
  expect(compileIntents([build({ replace: '@b1' })], ctx({ blueprints: full, refs })).ok).toBe(true);
 });
});
