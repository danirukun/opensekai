import { expect, it } from 'vitest';
import { makeSmokeScene, MAX_BLUEPRINT_LIST_LENGTH, MAX_BLUEPRINT_STRING_LENGTH, type BlueprintGraph } from '@opensekai/contracts';
import { createSession } from '../src/session';
import { BlueprintLimitError, checkBlueprintValue, clearNodeState, cloneState, emptyState, getNodeState, setNodeState } from '../src/blueprint-eval';
import { initialState } from '../src/blueprint-runtime';

const at = { x: 0, y: 0 };
const wire = (id: string, sourceNodeId: string, sourcePort: string, targetNodeId: string, targetPort: string) => ({ id, sourceNodeId, sourcePort, targetNodeId, targetPort });
// Manual → Set Asset Property(reference position), with an inline value and an unwired Make Vector3 that has its own inline values.
const graph = {
 schemaVersion: 1, id: 'g', name: 'G', enabled: true,
 variables: [
  { id: 's', name: 'Greeting', type: 'string', default: 'hello' },
  { id: 'l', name: 'Points', type: 'vector3[]', default: [[1, 2, 3]] },
  { id: 'i', name: 'Count', type: 'integer', default: 3 },
 ],
 nodes: [
  { id: 'go', version: 1, type: 'event.manual', settings: {}, position: at },
  { id: 'set', version: 1, type: 'property.set', settings: { entityId: 'reference', property: 'position' }, position: at, inputs: { value: [1, 2, 3] } },
  { id: 'make', version: 1, type: 'vector3.make', settings: {}, position: at, inputs: { x: 4, y: 5, z: 6 } },
 ],
 connections: [wire('flow', 'go', 'flow', 'set', 'flow')],
} as BlueprintGraph;

const start = () => {
 const session = createSession(makeSmokeScene(), 's');
 let now = 0, batch = 0;
 const edit = (ops: object[]) => session.editBlueprints({ clientId: 't', batchId: `b${batch++}`, ops });
 const tick = (count: number) => { for (let i = 0; i < count; i++) { now += 16; session.advance(now, now); } };
 // A run writes an override; 20 ticks later (320 ms) it is committed to the scene.
 const runAndCommit = () => { tick(1); const reply = session.runBlueprint('g', 'go'); tick(20); return reply; };
 const position = () => session.inspect().entities.find(item => item.id === 'reference')!.transform.position;
 expect(edit([{ kind: 'replaceAll', graphs: [graph] }]).ok).toBe(true);
 return { session, edit, runAndCommit, position };
};

it('reads an inline value on an unwired input, lets a wire win, and reads the type default when the value is cleared', () => {
 const { session, edit, runAndCommit, position } = start();
 expect(session.inspectBlueprints().errors).toEqual([]);
 expect(runAndCommit().ok).toBe(true);
 expect(position()).toEqual([1, 2, 3]);

 expect(edit([{ kind: 'connect', graphId: 'g', connection: wire('data', 'make', 'value', 'set', 'value') }]).ok).toBe(true);
 expect(runAndCommit().ok).toBe(true);
 expect(position()).toEqual([4, 5, 6]);

 expect(edit([{ kind: 'disconnect', graphId: 'g', connectionId: 'data' }, { kind: 'setNodeInput', graphId: 'g', nodeId: 'set', port: 'value', value: [7, 8, 9] }]).ok).toBe(true);
 expect(runAndCommit().ok).toBe(true);
 expect(position()).toEqual([7, 8, 9]);

 expect(edit([{ kind: 'setNodeInput', graphId: 'g', nodeId: 'set', port: 'value', value: null }]).ok).toBe(true);
 expect(runAndCommit().ok).toBe(true);
 expect(position()).toEqual([0, 0, 0]);
});

it('keeps string, list, and integer variables through edits and in the run state', () => {
 const { session, edit } = start();
 const variables = () => { const view = session.inspectBlueprints(); return view.kind === 'snapshot' ? view.blueprints[0]!.variables : []; };
 expect(variables()).toEqual(graph.variables);
 expect(initialState(graph).variables).toEqual(new Map<string, unknown>([['s', 'hello'], ['l', [[1, 2, 3]]], ['i', 3]]));
 expect(edit([{ kind: 'updateVariable', graphId: 'g', variableId: 's', default: 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH) }]).ok).toBe(true);
 expect(edit([{ kind: 'updateVariable', graphId: 'g', variableId: 's', default: 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH + 1) }])).toMatchObject({ ok: false, error: { message: 'Invalid variable' } });
 expect(edit([{ kind: 'updateVariable', graphId: 'g', variableId: 'l', type: 'string[]', default: ['a', 'b'] }]).ok).toBe(true);
 expect(edit([{ kind: 'updateVariable', graphId: 'g', variableId: 'i', default: 2.5 }])).toMatchObject({ ok: false, error: { message: 'Invalid variable' } });
 expect(variables().map(v => [v.type, v.default])).toEqual([['string', 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH)], ['string[]', ['a', 'b']], ['integer', 3]]);
 expect(session.runBlueprint('g', 'go').ok).toBe(true);
 expect(session.inspectBlueprints().errors).toEqual([]);
});

it('checks values against their type and the size limits', () => {
 expect(() => checkBlueprintValue('integer', 4)).not.toThrow();
 expect(() => checkBlueprintValue('string[]', Array.from({ length: MAX_BLUEPRINT_LIST_LENGTH + 1 }, () => ''))).toThrow(BlueprintLimitError);
 expect(() => checkBlueprintValue('string', 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH + 1))).toThrow(BlueprintLimitError);
 expect(() => checkBlueprintValue('integer', 0.5)).toThrow(RangeError);
 expect(() => checkBlueprintValue('integer', 0.5)).not.toThrow(BlueprintLimitError);
});

it('keeps generic node state in a run copy until the copy is kept', () => {
 const state = emptyState();
 setNodeState(state, 'once', { done: false });
 const copy = cloneState(state);
 setNodeState(copy, 'once', { done: true });
 setNodeState(copy, 'timer', 1.5);
 expect(getNodeState(state, 'once')).toEqual({ done: false });
 expect(getNodeState(state, 'timer')).toBeUndefined();
 expect(getNodeState<{ done: boolean }>(copy, 'once')).toEqual({ done: true });
 clearNodeState(copy, 'once');
 expect(getNodeState(copy, 'once')).toBeUndefined();
 expect(getNodeState(state, 'once')).toEqual({ done: false });
});
