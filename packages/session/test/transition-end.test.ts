import { expect, it } from 'vitest';
import { makeSmokeScene, type BlueprintOp } from '@opensekai/contracts';
import { compileBlueprint } from '../src/blueprint';
import { createSession } from '../src/session';
import { EMPTY_TWEENS, MAX_PENDING_ENDS, startTween, writeTransitioned, type PropertyLayers, type TransitionEnd } from '../src/tweens';
import { EMPTY_OVERRIDES } from '../src/overrides';

// Session tests through the public API: a manual trigger writes, and a Log node on On Transition End shows when the end runs.
type S = ReturnType<typeof createSession>;
const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const fov = (id: string, value: number, seconds?: number) => node(id, 'property.set', { entityId: 'camera_wide', property: 'fovDegrees', ...(seconds === undefined ? {} : { transitionSeconds: seconds, easing: 'Linear' }) }, { value });
const log = (id: string, message: string) => node(id, 'debug.log', { level: 'info' }, { message });
const graph = (id: string, nodes: unknown[], connections: unknown[]) => ({ schemaVersion: 1, id, name: id, enabled: true, variables: [], nodes: [node('go', 'event.manual'), ...nodes], connections });
// One graph `g`: go → set; set.transitionEnd → done (a Log line).
const ended = (set: unknown) => graph('g', [set, log('done', 'end')], [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'transitionEnd', 'done', 'flow')]);
function start(...graphs: unknown[]): S {
 const s = createSession(makeSmokeScene(), 's');
 const loaded = s.editBlueprints({ clientId: 't', batchId: 'b', ops: [{ kind: 'replaceAll', graphs }] });
 if (!loaded.ok) throw new Error(loaded.error.message);
 s.advance(0);
 return s;
}
const run = (s: S, graphId = 'g') => s.runBlueprint(graphId, 'go');
const lines = (s: S) => s.debugBlueprints().entries.map(entry => [entry.atMs, entry.kind === 'log' ? entry.message : entry.kind]);
let batch = 0;
const edit = (s: S, ops: BlueprintOp[]) => { const reply = s.editBlueprints({ clientId: 't', batchId: `e${++batch}`, ops }); if (!reply.ok) throw new Error(reply.error.message); };

it('accepts a loop through On Transition End and still rejects a loop through exit', () => {
 const loop = (port: string) => graph('g', [fov('a', 60, 1), fov('b', 40, 1)], [wire('1', 'go', 'flow', 'a', 'flow'), wire('2', 'a', 'exit', 'b', 'flow'), wire('3', 'b', port, 'a', 'flow')]);
 expect(compileBlueprint(loop('transitionEnd')).ok).toBe(true);
 expect(compileBlueprint(loop('exit'))).toMatchObject({ ok: false, error: { message: 'Blueprint has an immediate cycle' } });
});

it('runs the end on the step after the tween ends, and not before', () => {
 const s = start(ended(fov('set', 60, 1)));
 expect(run(s).ok).toBe(true);
 for (let ms = 20; ms <= 1000; ms += 20) s.advance(ms);
 expect(lines(s)).toEqual([]);
 s.advance(1020);
 expect(lines(s)).toEqual([[1020, 'end']]);
 for (let ms = 1040; ms <= 2000; ms += 20) s.advance(ms);
 expect(lines(s)).toHaveLength(1);
});

it('runs the end of an immediate write and of a write to the current value on the next clock step', () => {
 for (const set of [fov('set', 60), fov('set', 60, 0), fov('set', 45, 1)]) {
  const s = start(ended(set));
  expect(run(s).ok).toBe(true);
  expect(lines(s)).toEqual([]);
  s.advance(20);
  expect(lines(s)).toEqual([[20, 'end']]);
 }
 const visible = start(ended(node('set', 'property.set', { entityId: 'reference', property: 'visible', transitionSeconds: 1 }, { value: false })));
 run(visible);
 visible.advance(20);
 expect(lines(visible)).toEqual([[20, 'end']]);
});

it('runs no end when a patch, an immediate write, a new target, or a disable stops the tween', () => {
 const patch = start(ended(fov('set', 60, 1)));
 run(patch);
 patch.advance(500);
 expect(patch.applyPatch({ sceneId: 'scene_smoke', expectedRevision: 0, operations: [{ kind: 'setCameraLens', entityId: 'camera_wide', lens: { fovDegrees: 30, near: 0.01, far: 100 } }] }).ok).toBe(true);
 for (let ms = 520; ms <= 1500; ms += 20) patch.advance(ms);
 expect(lines(patch)).toEqual([]);

 // `cut` writes the Field of View at once from a second trigger; `retarget` starts a tween to another value.
 for (const other of [fov('other', 70), fov('other', 70, 1)]) {
  const s = start(ended(fov('set', 60, 1)), graph('h', [other], [wire('a', 'go', 'flow', 'other', 'flow')]));
  run(s);
  s.advance(500);
  run(s, 'h');
  for (let ms = 520; ms <= 2500; ms += 20) s.advance(ms);
  expect(lines(s)).toEqual([]);
 }

 const disabled = start(ended(fov('set', 60, 1)));
 run(disabled);
 disabled.advance(500);
 edit(disabled, [{ kind: 'updateGraph', graphId: 'g', enabled: false }]);
 edit(disabled, [{ kind: 'updateGraph', graphId: 'g', enabled: true }]);
 for (let ms = 520; ms <= 1500; ms += 20) disabled.advance(ms);
 expect(lines(disabled)).toEqual([]);
});

it('drops a pending end when its graph is disabled or its logic changes, and keeps it for an inline input change', () => {
 const disabled = start(ended(fov('set', 60)));
 run(disabled);
 edit(disabled, [{ kind: 'updateGraph', graphId: 'g', enabled: false }]);
 edit(disabled, [{ kind: 'updateGraph', graphId: 'g', enabled: true }]);
 disabled.advance(20);
 expect(lines(disabled)).toEqual([]);

 const changed = start(ended(fov('set', 60)));
 run(changed);
 edit(changed, [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'done', settings: { level: 'warning' } }]);
 changed.advance(20);
 expect(lines(changed)).toEqual([]);

 const inline = start(ended(fov('set', 60)));
 run(inline);
 edit(inline, [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'done', port: 'message', value: 'later' }]);
 inline.advance(20);
 expect(lines(inline)).toEqual([[20, 'later']]);
});

it('joins a running tween once for each node, and fails the ninth distinct end with no state change', () => {
 const nine = Array.from({ length: 9 }, (_, i) => fov(`n${i}`, 60, 1));
 const chain = nine.map((item, i) => wire(`w${i}`, i === 0 ? 'go' : `n${i - 1}`, i === 0 ? 'flow' : 'exit', item.id, 'flow'));
 const ends = nine.map((item, i) => wire(`e${i}`, item.id, 'transitionEnd', 'done', 'flow'));
 const s = start(graph('g', [...nine, log('done', 'end')], [...chain, ...ends]));
 expect(run(s)).toMatchObject({ ok: false, error: { message: 'Transition limit reached' } });
 for (let ms = 20; ms <= 1500; ms += 20) s.advance(ms);
 expect(lines(s)).toEqual([]);
 expect(s.advance(1520).scene.entities.find(entity => entity.id === 'camera_wide')).toMatchObject({ lens: { fovDegrees: 45 } });

 // The same node twice joins once; eight distinct nodes all run.
 const scene = makeSmokeScene();
 const end = (nodeId: string): TransitionEnd => ({ graphId: 'g', nodeId, logic: 'k' });
 const write = { kind: 'setProperty' as const, entityId: 'camera_wide', property: 'fovDegrees' as const, value: 60 };
 let tweens = EMPTY_TWEENS;
 for (const id of ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
  const next = startTween(tweens, scene, EMPTY_OVERRIDES, write, { seconds: 1, easing: 'Linear' }, 'g', 0, end(id));
  if (!next.ok) throw new Error(next.error.message);
  tweens = next.data;
 }
 expect([...tweens.values()][0]!.ends.map(item => item.nodeId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
});

it('fails a write over the pending end limit', () => {
 const scene = makeSmokeScene();
 let layers: PropertyLayers = { overrides: EMPTY_OVERRIDES, tweens: EMPTY_TWEENS };
 const write = (i: number) => writeTransitioned(layers, scene, { kind: 'setProperty', entityId: 'camera_wide', property: 'fovDegrees', value: 50 }, 'g', 0, 0, { graphId: 'g', nodeId: `n${i}`, logic: 'k' });
 for (let i = 0; i < MAX_PENDING_ENDS; i++) { const next = write(i); if (!next.ok) throw new Error(next.error.message); layers = next.data; }
 expect(layers.pending).toHaveLength(64);
 expect(write(64)).toMatchObject({ ok: false, error: { message: 'Transition limit reached' } });
});

it('records no end for a run that fails, and runs no end from a manual or event step', () => {
 // `bad` sets a Field of View outside its range after `set`, so the run fails as a whole.
 const failing = start(graph('g', [fov('set', 60), fov('bad', 400), log('done', 'end')], [wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'exit', 'bad', 'flow'), wire('c', 'set', 'transitionEnd', 'done', 'flow')]));
 expect(run(failing).ok).toBe(false);
 failing.advance(20);
 expect(lines(failing)).toEqual([]);

 // A second write from an event step: the ends wait for the clock step.
 const s = start(graph('g', [fov('set', 60), log('done', 'end'), node('on', 'event.custom', { name: 'again', payload: 'none' }), fov('set2', 50)], [
  wire('a', 'go', 'flow', 'set', 'flow'), wire('b', 'set', 'transitionEnd', 'done', 'flow'), wire('c', 'on', 'flow', 'set2', 'flow'), wire('d', 'set2', 'transitionEnd', 'done', 'flow')]));
 run(s);
 expect(s.emitBlueprintEvent('again').ok).toBe(true);
 run(s);
 expect(lines(s)).toEqual([]);
 s.advance(20);
 expect(lines(s)).toEqual([[20, 'end'], [20, 'end'], [20, 'end']]);
});

it('runs an end recorded during a clock step on the next clock step at the earliest', () => {
 // A 0 s loop: a → b → a. Each end runs one step after its write.
 const s = start(graph('g', [fov('a', 60), fov('b', 50), log('la', 'a'), log('lb', 'b')], [
  wire('1', 'go', 'flow', 'a', 'flow'), wire('2', 'a', 'transitionEnd', 'lb', 'flow'), wire('3', 'lb', 'exit', 'b', 'flow'), wire('4', 'b', 'transitionEnd', 'la', 'flow'), wire('5', 'la', 'exit', 'a', 'flow')]));
 run(s);
 for (let ms = 20; ms <= 80; ms += 20) s.advance(ms);
 expect(lines(s)).toEqual([[20, 'b'], [40, 'a'], [60, 'b'], [80, 'a']]);
});

it('records no end for an unwired On Transition End, so an old graph is not limited', () => {
 const nine = Array.from({ length: 9 }, (_, i) => fov(`n${i}`, 60, 1));
 const chain = nine.map((item, i) => wire(`w${i}`, i === 0 ? 'go' : `n${i - 1}`, i === 0 ? 'flow' : 'exit', item.id, 'flow'));
 const s = start(graph('g', nine, chain));
 expect(run(s).ok).toBe(true);
 const many = start(graph('g', [fov('set', 60)], [wire('a', 'go', 'flow', 'set', 'flow')]));
 for (let i = 0; i < 70; i++) expect(run(many).ok).toBe(true);
});
