import { expect, it } from 'vitest';
import { type BlueprintGraph, makeSmokeScene } from '@opensekai/contracts';
import { compileBlueprint, executeBlueprint } from '../src/blueprint';
import { createSession } from '../src/session';

const node = (id: string, type: BlueprintGraph['nodes'][number]['type'], settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
const graph = () => ({
 schemaVersion: 1, id: 'visibility', name: 'Visibility',
 nodes: [node('start', 'event.manual'), node('yes', 'value.boolean', { value: false }), node('hide', 'scene.setVisibility', { entityId: 'marker' })],
 connections: [wire('flow', 'start', 'flow', 'hide', 'flow'), wire('value', 'yes', 'value', 'hide', 'visible')],
});

it('compiles a typed graph and executes only its selected trigger', () => {
 const compiled = compileBlueprint(graph());
 expect(compiled.ok).toBe(true);
 if (!compiled.ok) return;
 expect(executeBlueprint(compiled.data, 'start')).toEqual({ ok: true, data: [{ kind: 'setVisibility', entityId: 'marker', visible: false }] });
 expect(executeBlueprint(compiled.data, 'yes')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('evaluates number data through Add and Greater Than before an effect', () => {
 const arithmetic = graph();
 arithmetic.nodes = [
  node('start', 'event.manual'),
  node('one', 'value.number', { value: 1 }),
  node('two', 'value.number', { value: 2 }),
  node('limit', 'value.number', { value: 2 }),
  node('sum', 'math.add'),
  node('greater', 'logic.greater'),
  node('show', 'scene.setVisibility', { entityId: 'marker' }),
 ];
 arithmetic.connections = [
  wire('flow', 'start', 'flow', 'show', 'flow'),
  wire('one', 'one', 'value', 'sum', 'a'),
  wire('two', 'two', 'value', 'sum', 'b'),
  wire('sum', 'sum', 'result', 'greater', 'a'),
  wire('limit', 'limit', 'value', 'greater', 'b'),
  wire('decision', 'greater', 'result', 'show', 'visible'),
 ];
 const session = createSession(makeSmokeScene(), 'test');
 expect(session.runBlueprint(arithmetic, 'start')).toEqual({ ok: true, data: { revision: 1 } });
 expect(session.inspect().entities.find(entity => entity.id === 'marker')?.visible).toBe(true);
});

it('rejects non-finite arithmetic without changing the scene', () => {
 const arithmetic = graph();
 arithmetic.nodes = [node('start', 'event.manual'), node('a', 'value.number', { value: 1e308 }), node('b', 'value.number', { value: 1e308 }), node('zero', 'value.number', { value: 0 }), node('sum', 'math.add'), node('greater', 'logic.greater'), node('show', 'scene.setVisibility', { entityId: 'marker' })];
 arithmetic.connections = [wire('flow', 'start', 'flow', 'show', 'flow'), wire('a', 'a', 'value', 'sum', 'a'), wire('b', 'b', 'value', 'sum', 'b'), wire('sum', 'sum', 'result', 'greater', 'a'), wire('zero', 'zero', 'value', 'greater', 'b'), wire('decision', 'greater', 'result', 'show', 'visible')];
 const session = createSession(makeSmokeScene(), 'test');
 const before = session.inspect();
 expect(session.runBlueprint(arithmetic, 'start')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(session.inspect()).toEqual(before);
});

it('stops an oversized flow before committing any effect', () => {
 const large = graph();
 large.nodes = [node('start', 'event.manual'), node('yes', 'value.boolean', { value: false }), ...Array.from({ length: 65 }, (_, index) => node(`action-${index}`, 'scene.setVisibility', { entityId: 'marker' }))];
 large.connections = large.nodes.slice(2).flatMap((action, index) => [wire(`flow-${index}`, 'start', 'flow', action.id, 'flow'), wire(`value-${index}`, 'yes', 'value', action.id, 'visible')]);
 const session = createSession(makeSmokeScene(), 'test');
 const before = session.inspect();
 expect(session.runBlueprint(large, 'start')).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 expect(session.inspect()).toEqual(before);
});

it('rejects missing nodes, wrong port types, and duplicate inputs', () => {
 const missing = graph(); missing.connections[0]!.sourceNodeId = 'gone';
 expect(compileBlueprint(missing)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
 const wrongType = graph(); wrongType.connections[1]!.sourcePort = 'flow'; wrongType.connections[1]!.sourceNodeId = 'start';
 expect(compileBlueprint(wrongType)).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match' } });
 const duplicate = graph(); duplicate.connections.push(wire('extra', 'yes', 'value', 'hide', 'visible'));
 expect(compileBlueprint(duplicate)).toMatchObject({ ok: false, error: { message: 'Blueprint input has multiple connections' } });
});

it('rejects missing required inputs and immediate data cycles', () => {
 const missing = graph(); missing.connections.pop();
 expect(compileBlueprint(missing)).toMatchObject({ ok: false, error: { message: 'Blueprint input is not connected' } });
 const cycle = graph();
 cycle.nodes.push(node('add', 'math.add'));
 cycle.connections.push(wire('self', 'add', 'result', 'add', 'a'));
 cycle.connections.push(wire('other', 'add', 'result', 'add', 'b'));
 expect(compileBlueprint(cycle)).toMatchObject({ ok: false, error: { message: 'Blueprint has an immediate cycle' } });
});

it('applies a visibility graph through one scene patch', () => {
 const session = createSession(makeSmokeScene(), 'test');
 expect(session.runBlueprint(graph(), 'start')).toEqual({ ok: true, data: { revision: 1 } });
 expect(session.inspect().entities.find(entity => entity.id === 'marker')?.visible).toBe(false);
});

it('keeps the scene unchanged when a graph targets a missing entity', () => {
 const session = createSession(makeSmokeScene(), 'test');
 const before = session.inspect();
 const invalid = graph(); invalid.nodes[2]!.settings = { entityId: 'missing' };
 expect(session.runBlueprint(invalid, 'start')).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(session.inspect()).toEqual(before);
});
