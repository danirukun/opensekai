import { expect, it } from 'vitest';
import { compileBlueprint, runFlow } from '../src/blueprint';
import { initialState } from '../src/blueprint-runtime';

const node = (id: string, type: string, settings: object = {}) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const variables = [{ id: 'n', name: 'N', type: 'number', default: 0 }, { id: 'b', name: 'B', type: 'boolean', default: false }];
const doc = (nodes: object[], connections: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', variables, nodes, connections });
const budget = () => ({ visits: 1024, effects: 64 });
// Stores the output of one node in a variable and returns the stored value, or the error message.
const evaluate = (type: string, inputs: Record<string, number | boolean>, settings: object = {}) => {
 const output = /^logic\./.test(type) ? 'b' : 'n';
 const nodes = [node('start', 'event.manual'), node('op', type, settings), node('store', output === 'b' ? 'variable.setBoolean' : 'variable.setNumber', { variableId: output }),
  ...Object.entries(inputs).map(([port, value]) => node(`in_${port}`, typeof value === 'number' ? 'value.number' : 'value.boolean', { value }))];
 const wires = [wire('f', 'start', 'flow', 'store', 'flow'), wire('d', 'op', 'result', 'store', 'value'), ...Object.keys(inputs).map(port => wire(`w_${port}`, `in_${port}`, 'value', 'op', port))];
 const compiled = compileBlueprint(doc(nodes, wires));
 if (!compiled.ok) throw new Error(compiled.error.message);
 const run = runFlow(compiled.data, { nodeId: 'start', port: 'flow' }, initialState(compiled.data.graph), budget(), 0);
 return run.ok ? run.data.state.variables.get(output) : run.error.message;
};

it('computes the math nodes', () => {
 expect(evaluate('math.subtract', { a: 5, b: 3 })).toBe(2);
 expect(evaluate('math.multiply', { a: 4, b: 2.5 })).toBe(10);
 expect(evaluate('math.divide', { a: 9, b: 3 })).toBe(3);
 expect(evaluate('math.divide', { a: 1, b: 0 })).toBe('Blueprint data could not be evaluated');
 expect(evaluate('math.min', { a: 2, b: -1 })).toBe(-1);
 expect(evaluate('math.max', { a: 2, b: -1 })).toBe(2);
 expect(evaluate('math.clamp', { value: 12, min: 0, max: 10 })).toBe(10);
 expect(evaluate('math.clamp', { value: 1, min: 5, max: 0 })).toBe('Blueprint data could not be evaluated');
 expect(evaluate('math.abs', { value: -3 })).toBe(3);
 expect(evaluate('math.round', { value: 2.5 })).toBe(3);
 expect(evaluate('math.floor', { value: -1.5 })).toBe(-2);
});

it('compares numbers and combines booleans', () => {
 expect(evaluate('logic.less', { a: 1, b: 2 })).toBe(true);
 expect(evaluate('logic.greaterOrEqual', { a: 2, b: 2 })).toBe(true);
 expect(evaluate('logic.lessOrEqual', { a: 3, b: 2 })).toBe(false);
 expect(evaluate('logic.equal', { a: 0.1 + 0.2, b: 0.3 })).toBe(false);
 expect(evaluate('logic.and', { a: true, b: false })).toBe(false);
 expect(evaluate('logic.or', { a: true, b: false })).toBe(true);
});

it('draws Random Number from the seeded generator within its range', () => {
 const first = evaluate('math.random', { min: 2, max: 4 });
 expect(evaluate('math.random', { min: 2, max: 4 })).toBe(first);
 expect(first).toBeGreaterThanOrEqual(2); expect(first).toBeLessThan(4);
 expect(evaluate('math.random', { min: 3, max: 3 })).toBe(3);
 expect(evaluate('math.random', { min: 4, max: 2 })).toBe('Blueprint data could not be evaluated');
});

it('sets, adds to, toggles, and reads variables within one run', () => {
 const compiled = compileBlueprint(doc(
  [node('start', 'event.manual'), node('add', 'variable.addNumber', { variableId: 'n' }), node('two', 'value.number', { value: 2 }), node('toggle', 'variable.toggleBoolean', { variableId: 'b' }),
   node('get', 'variable.getNumber', { variableId: 'n' }), node('gt', 'logic.greater'), node('one', 'value.number', { value: 1 }), node('set', 'variable.setBoolean', { variableId: 'b' })],
  [wire('1', 'start', 'flow', 'add', 'flow'), wire('2', 'two', 'value', 'add', 'amount'), wire('3', 'add', 'exit', 'toggle', 'flow'), wire('4', 'toggle', 'exit', 'set', 'flow'),
   wire('5', 'get', 'value', 'gt', 'a'), wire('6', 'one', 'value', 'gt', 'b'), wire('7', 'gt', 'result', 'set', 'value')]));
 if (!compiled.ok) throw new Error(compiled.error.message);
 const run = runFlow(compiled.data, { nodeId: 'start', port: 'flow' }, initialState(compiled.data.graph), budget(), 0);
 expect(run.ok && Object.fromEntries(run.data.state.variables)).toEqual({ n: 2, b: true });
});

it('rejects a variable node whose variable is missing or of the other type', () => {
 const one = (settings: object, type = 'variable.getNumber') => compileBlueprint(doc([node('get', type, settings)], []));
 expect(one({ variableId: 'gone' })).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing', ids: ['get'] } });
 expect(one({ variableId: 'b' })).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing' } });
 expect(one({ variableId: 'n' }).ok).toBe(true);
});

const withR = (graph: ReturnType<typeof doc>) => ({ ...graph, variables: [...variables, { id: 'r', name: 'R', type: 'number', default: 0 }] });
it('keeps the committed variables and random state when a run fails, and draws a new value on each successful run', () => {
 const failing = compileBlueprint(withR(doc(
  [node('start', 'event.manual'), node('seven', 'value.number', { value: 7 }), node('set', 'variable.setNumber', { variableId: 'n' }), node('rand', 'math.random'), node('lo', 'value.number', { value: 0 }), node('hi', 'value.number', { value: 100 }),
   node('keep', 'variable.setNumber', { variableId: 'r' }), node('one', 'value.number', { value: 1 }), node('zero', 'value.number', { value: 0 }), node('div', 'math.divide'), node('bad', 'variable.setNumber', { variableId: 'n' })],
  [wire('1', 'start', 'flow', 'set', 'flow'), wire('2', 'seven', 'value', 'set', 'value'), wire('3', 'set', 'exit', 'keep', 'flow'), wire('4', 'rand', 'result', 'keep', 'value'), wire('5', 'lo', 'value', 'rand', 'min'), wire('6', 'hi', 'value', 'rand', 'max'),
   wire('7', 'keep', 'exit', 'bad', 'flow'), wire('8', 'div', 'result', 'bad', 'value'), wire('9', 'one', 'value', 'div', 'a'), wire('10', 'zero', 'value', 'div', 'b')])));
 if (!failing.ok) throw new Error(failing.error.message);
 const state = initialState(failing.data.graph), before = { variables: new Map(state.variables), random: state.random };
 const run = runFlow(failing.data, { nodeId: 'start', port: 'flow' }, state, budget(), 0);
 expect(run.ok).toBe(false);
 expect(state.variables).toEqual(before.variables);
 expect(state.random).toBe(before.random);

 const draw = compileBlueprint(doc([node('start', 'event.manual'), node('rand', 'math.random'), node('lo', 'value.number', { value: 0 }), node('hi', 'value.number', { value: 100 }), node('keep', 'variable.setNumber', { variableId: 'n' })],
  [wire('1', 'start', 'flow', 'keep', 'flow'), wire('2', 'rand', 'result', 'keep', 'value'), wire('3', 'lo', 'value', 'rand', 'min'), wire('4', 'hi', 'value', 'rand', 'max')]));
 if (!draw.ok) throw new Error(draw.error.message);
 const one = runFlow(draw.data, { nodeId: 'start', port: 'flow' }, initialState(draw.data.graph), budget(), 0);
 if (!one.ok) throw new Error(one.error.message);
 const two = runFlow(draw.data, { nodeId: 'start', port: 'flow' }, one.data.state, budget(), 0);
 expect(two.ok && two.data.state.variables.get('n')).not.toBe(one.data.state.variables.get('n'));
});
