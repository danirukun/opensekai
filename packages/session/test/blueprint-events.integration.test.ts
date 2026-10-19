import { expect, it } from 'vitest';
import { keystrokeAccelerator, makeSmokeScene, type BlueprintOp } from '@opensekai/contracts';
import { createSession } from '../src';

// Boundary: the session command API (`editBlueprints`, `runBlueprint`, `emitBlueprintEvent`, `inspectBlueprints`, `advance`) with the real store and runtime.
const at = { x: 0, y: 0 };
const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: at, ...(inputs ? { inputs } : {}) });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const graph = (id: string, nodes: object[], connections: object[], enabled = true) => ({ schemaVersion: 1, id, name: id, enabled, nodes, connections, variables: [] });
const toggle = (id: string, entityId: string) => node(id, 'scene.toggleVisibility', { entityId });
const show = (id: string, entityId: string, visible?: boolean) => node(id, 'scene.setVisibility', { entityId }, visible === undefined ? undefined : { visible });
const keyK = { code: 'KeyK', control: true, alt: true, shift: false, meta: false };

function start(...graphs: object[]) {
 const session = createSession(makeSmokeScene(), 'events');
 let batch = 0, now = 0;
 const edit = (ops: BlueprintOp[]) => session.editBlueprints({ clientId: 'test', batchId: `b${++batch}`, ops });
 const created = edit(graphs.map(item => ({ kind: 'createGraph', graph: item }) as BlueprintOp));
 if (!created.ok) throw new Error(created.error.message);
 const tick = (ms = 16) => { now += ms; return session.advance(now, now); };
 const visible = (id: string) => session.inspect().entities.find(entity => entity.id === id)?.visible;
 const stored = () => { const reply = session.inspectBlueprints(); if (reply.kind !== 'snapshot') throw new Error('no snapshot'); return reply; };
 const enabled = (id: string) => stored().blueprints.find(item => item.id === id)?.enabled;
 tick();
 return { session, edit, tick, visible, stored, enabled };
}

it('delivers a custom event with its payload to each enabled graph, the emitter too, in the same tick', () => {
 const sender = graph('sender', [node('go', 'event.manual'), node('emit', 'event.emit', { name: 'show', payload: 'boolean' }, { payload: false }), node('own', 'event.custom', { name: 'show', payload: 'none' }), toggle('mark', 'marker')],
  [wire('1', 'go', 'flow', 'emit', 'flow'), wire('2', 'own', 'flow', 'mark', 'flow')]);
 const receiver = graph('receiver', [node('on', 'event.custom', { name: 'show', payload: 'boolean' }), show('set', 'performer')],
  [wire('1', 'on', 'flow', 'set', 'flow'), wire('2', 'on', 'payload', 'set', 'visible')]);
 const silent = graph('silent', [node('on', 'event.custom', { name: 'show', payload: 'none' }), toggle('t', 'performer')], [wire('1', 'on', 'flow', 't', 'flow')], false);
 const { session, visible } = start(sender, receiver, silent);
 const markerBefore = visible('marker');
 const revision = session.inspect().revision;
 expect(session.runBlueprint('sender', 'go')).toMatchObject({ ok: true });
 expect(visible('performer')).toBe(false);
 expect(visible('marker')).toBe(!markerBefore);
 // One scene commit for the whole delivery.
 expect(session.inspect().revision).toBe(revision + 1);
 expect(session.emitBlueprintEvent('show', true)).toMatchObject({ ok: true });
 expect(visible('performer')).toBe(true);
 expect(session.emitBlueprintEvent('nobody', 1)).toMatchObject({ ok: true });
});

it('cuts a runaway event loop off with a runtime error, and the session keeps ticking', () => {
 const loop = graph('loop', [node('go', 'event.manual'), node('emit', 'event.emit', { name: 'ping', payload: 'none' }), node('on', 'event.custom', { name: 'ping', payload: 'none' }), node('again', 'event.emit', { name: 'ping', payload: 'none' })],
  [wire('1', 'go', 'flow', 'emit', 'flow'), wire('2', 'on', 'flow', 'again', 'flow')]);
 const { session, tick, stored } = start(loop);
 expect(session.runBlueprint('loop', 'go')).toMatchObject({ ok: true });
 expect(stored().errors).toEqual([{ graphId: 'loop', kind: 'runtime', error: expect.objectContaining({ message: 'Blueprint event hop limit reached', ids: ['again'] }) }]);
 expect(tick().sequence).toBeGreaterThan(0);
 expect(session.emitBlueprintEvent('ping')).toMatchObject({ ok: false, error: { message: 'Blueprint event hop limit reached' } });
});

it('runs On Disable once when the graph is disabled, and the old version before the new On Enable on a logic change', () => {
 const watched = graph('watched', [node('enable', 'event.enable'), node('disable', 'event.disable'), node('n', 'value.number', { value: 1 }), show('up', 'performer', true), show('down', 'performer', false), toggle('count', 'marker')],
  [wire('1', 'enable', 'flow', 'up', 'flow'), wire('2', 'disable', 'flow', 'down', 'flow'), wire('3', 'down', 'exit', 'count', 'flow')]);
 const { edit, tick, visible } = start(watched);
 const marker = visible('marker');
 expect(visible('performer')).toBe(true);
 expect(edit([{ kind: 'updateGraph', graphId: 'watched', enabled: false }]).ok).toBe(true);
 tick();
 expect(visible('performer')).toBe(false);
 expect(visible('marker')).toBe(!marker);
 tick();
 expect(visible('marker')).toBe(!marker);
 expect(edit([{ kind: 'updateGraph', graphId: 'watched', enabled: true }]).ok).toBe(true);
 tick();
 expect(visible('performer')).toBe(true);
 // A logic change: the old version sets the performer hidden, then the new version shows it again.
 expect(edit([{ kind: 'setNodeSettings', graphId: 'watched', nodeId: 'n', settings: { value: 2 } }]).ok).toBe(true);
 tick();
 expect(visible('performer')).toBe(true);
 expect(visible('marker')).toBe(marker);
 // Removal runs On Disable; a version that never started (created and removed between ticks) does not.
 expect(edit([{ kind: 'removeGraph', graphId: 'watched' }]).ok).toBe(true);
 tick();
 expect(visible('marker')).toBe(!marker);
 expect(edit([{ kind: 'createGraph', graph: watched } as BlueprintOp]).ok).toBe(true);
 expect(edit([{ kind: 'removeGraph', graphId: 'watched' }]).ok).toBe(true);
 tick();
 expect(visible('marker')).toBe(!marker);
});

it('runs no On Disable when a show replaces all graphs', () => {
 const watched = graph('watched', [node('disable', 'event.disable'), toggle('count', 'marker')], [wire('1', 'disable', 'flow', 'count', 'flow')]);
 const { edit, tick, visible } = start(watched);
 const marker = visible('marker');
 expect(edit([{ kind: 'replaceAll', graphs: [] }]).ok).toBe(true);
 tick();
 expect(visible('marker')).toBe(marker);
});

it('enables and disables a graph from another graph as a saved document change, with its hotkey registered', () => {
 const control = graph('control', [node('off', 'event.manual'), node('on', 'event.manual'), node('flip', 'event.manual'), node('disable', 'blueprint.disable', { graphId: 'target' }), node('enable', 'blueprint.enable', { graphId: 'target' }), node('toggle', 'blueprint.toggle', { graphId: 'target' }), node('ghost', 'blueprint.enable', { graphId: 'gone' }), node('ghostGo', 'event.manual')],
  [wire('1', 'off', 'flow', 'disable', 'flow'), wire('2', 'on', 'flow', 'enable', 'flow'), wire('3', 'flip', 'flow', 'toggle', 'flow'), wire('4', 'ghostGo', 'flow', 'ghost', 'flow')]);
 const target = graph('target', [node('enable', 'event.enable'), node('disable', 'event.disable'), node('key', 'event.keystroke', keyK), show('up', 'performer', true), show('down', 'performer', false)],
  [wire('1', 'enable', 'flow', 'up', 'flow'), wire('2', 'disable', 'flow', 'down', 'flow')]);
 const { session, tick, visible, stored, enabled } = start(control, target);
 const accelerator = keystrokeAccelerator(keyK);
 expect(stored().keystrokes).toEqual([accelerator]);
 const revision = session.inspectBlueprints().revision;
 expect(session.runBlueprint('control', 'off')).toMatchObject({ ok: true });
 expect(enabled('target')).toBe(false);
 expect(session.inspectBlueprints().revision).toBe(revision + 1);
 // Enable Blueprint can turn the graph on again, so its hotkey stays registered.
 expect(stored().keystrokes).toEqual([accelerator]);
 expect(tick().blueprintRevision).toBe(revision + 1);
 expect(visible('performer')).toBe(false);
 expect(session.runBlueprint('control', 'on')).toMatchObject({ ok: true });
 tick();
 expect(enabled('target')).toBe(true);
 expect(visible('performer')).toBe(true);
 expect(session.runBlueprint('control', 'flip')).toMatchObject({ ok: true });
 expect(enabled('target')).toBe(false);
 // A request that changes nothing is not an edit.
 const settled = session.inspectBlueprints().revision;
 expect(session.runBlueprint('control', 'off')).toMatchObject({ ok: true });
 expect(session.inspectBlueprints().revision).toBe(settled);
 session.runBlueprint('control', 'ghostGo');
 expect(stored().errors).toEqual([{ graphId: 'control', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND', message: 'Blueprint not found', ids: ['gone'] }) }]);
});

it('keeps a repeating timer running on the session clock with no editor and no Blueprint run', () => {
 const timer = graph('timer', [node('enable', 'event.enable'), node('start', 'timer.start', { name: 'blink', repeat: true }, { seconds: 0.5 }), node('on', 'timer.on', { name: 'blink' }), toggle('t', 'marker')],
  [wire('1', 'enable', 'flow', 'start', 'flow'), wire('2', 'on', 'flow', 't', 'flow')]);
 const { tick, visible } = start(timer);
 const marker = visible('marker');
 const seen: (boolean | undefined)[] = [];
 for (let i = 0; i < 4; i += 1) { tick(250); tick(250); seen.push(visible('marker')); }
 expect(seen).toEqual([!marker, marker, !marker, marker]);
});

it('applies an inline value change to the next run without a reset (value model R5)', () => {
 const once = graph('once', [node('go', 'event.manual'), node('do', 'flow.doOnce'), show('set', 'performer', false), node('disable', 'event.disable'), toggle('count', 'marker'),
  node('other', 'event.manual'), show('set2', 'performer', true)],
 [wire('1', 'go', 'flow', 'do', 'flow'), wire('2', 'do', 'exit', 'set', 'flow'), wire('3', 'disable', 'flow', 'count', 'flow'), wire('4', 'other', 'flow', 'set2', 'flow')]);
 const { session, edit, tick, visible } = start(once);
 const marker = visible('marker');
 session.runBlueprint('once', 'go');
 expect(visible('performer')).toBe(false);
 session.runBlueprint('once', 'other');
 expect(visible('performer')).toBe(true);
 expect(edit([{ kind: 'setNodeInput', graphId: 'once', nodeId: 'set2', port: 'visible', value: false }]).ok).toBe(true);
 tick();
 // Do Once stays closed, so the state was kept, and On Disable did not run.
 session.runBlueprint('once', 'go');
 expect(visible('performer')).toBe(true);
 expect(visible('marker')).toBe(marker);
 // The new inline value applies to the next run.
 session.runBlueprint('once', 'other');
 expect(visible('performer')).toBe(false);
});

it('starts On Disable from an empty schedule, so a graph at its timer limit can still start a timer there', () => {
 const starts = Array.from({ length: 16 }, (_, i) => node(`s${i}`, 'timer.start', { name: `t${i}`, repeat: false }, { seconds: 600 }));
 const chain = starts.slice(1).map((item, i) => wire(`c${i}`, `s${i}`, 'exit', item.id, 'flow'));
 const full = graph('full', [node('enable', 'event.enable'), ...starts, node('disable', 'event.disable'), node('extra', 'timer.start', { name: 'extra', repeat: false }), toggle('count', 'marker')],
  [wire('in', 'enable', 'flow', 's0', 'flow'), ...chain, wire('d1', 'disable', 'flow', 'extra', 'flow'), wire('d2', 'extra', 'exit', 'count', 'flow')]);
 const { edit, tick, visible, stored } = start(full);
 const marker = visible('marker');
 expect(stored().errors).toEqual([]);
 expect(edit([{ kind: 'updateGraph', graphId: 'full', enabled: false }]).ok).toBe(true);
 tick();
 expect(visible('marker')).toBe(!marker);
 expect(stored().errors).toEqual([]);
});

it('reports only the errors of the runs that the external event caused', () => {
 const bystander = graph('bystander', [node('enable', 'event.enable'), node('emit', 'event.emit', { name: 'boom', payload: 'none' })], [wire('1', 'enable', 'flow', 'emit', 'flow')]);
 const broken = graph('broken', [node('on', 'event.custom', { name: 'boom', payload: 'none' }), toggle('t', 'gone')], [wire('1', 'on', 'flow', 't', 'flow')]);
 const { session, edit, stored } = start(broken);
 // The bystander's On Enable runs in the same step as the external event, and its event fails in `broken`.
 expect(edit([{ kind: 'createGraph', graph: bystander } as BlueprintOp]).ok).toBe(true);
 expect(session.emitBlueprintEvent('other')).toMatchObject({ ok: true });
 expect(stored().errors).toEqual([{ graphId: 'broken', kind: 'runtime', error: expect.objectContaining({ code: 'NOT_FOUND' }) }]);
 expect(session.emitBlueprintEvent('boom')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});
