import { expect, it } from 'vitest';
import { applyBlueprintOps, blueprintPorts, DATA_TYPES, isListType, type BlueprintNode, MAX_BLUEPRINT_LIST_LENGTH, MAX_BLUEPRINT_STRING_LENGTH, type BlueprintGraph, type BlueprintValue, type DataType } from '@opensekai/contracts';
import { compileBlueprint, runFlow, type CompiledBlueprint } from '../src/blueprint';
import { createBlueprintRuntime, initialState } from '../src/blueprint-runtime';
import type { RunState } from '../src/blueprint-eval';

type Inputs = Record<string, BlueprintValue>;
const node = (id: string, type: string, settings: object = {}, inputs?: Inputs) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) });
const wire = (id: string, s: string, sp: string, t: string, tp: string) => ({ id, sourceNodeId: s, sourcePort: sp, targetNodeId: t, targetPort: tp });
const variable = (id: string, type: DataType, value: BlueprintValue) => ({ id, name: id, type, default: value });
const doc = (variables: object[], nodes: object[], connections: object[]) => ({ schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables, nodes, connections });
const budget = () => ({ visits: 4096, effects: 64 });
const compile = (graph: object): CompiledBlueprint => { const c = compileBlueprint(graph); if (!c.ok) throw new Error(c.error.message); return c.data; };
const run = (compiled: CompiledBlueprint, state: RunState = initialState(compiled.graph), start = 'start') => runFlow(compiled, { nodeId: start, port: 'flow' }, state, budget(), 0);
const result = (outcome: ReturnType<typeof run>, id = 'out') => outcome.ok ? outcome.data.state.variables.get(id) : outcome.error.message;

// Runs one data node and stores the named output in a variable of the output type. A scalar input is an inline value; a list input reads a list variable.
const evaluate = (type: string, settings: object, inputs: Inputs, output: string, outputType: DataType) => {
 const ports = blueprintPorts(node('op', type, settings) as BlueprintNode).inputs;
 const lists = Object.entries(inputs).filter(([port]) => isListType(ports[port] ?? ''));
 const scalars = Object.fromEntries(Object.entries(inputs).filter(([port]) => !isListType(ports[port] ?? '')));
 const nodes = [node('start', 'event.manual'), node('op', type, settings, Object.keys(scalars).length ? scalars : undefined), node('store', 'variable.set', { variableId: 'out', type: outputType }),
  ...lists.map(([port]) => node(`get_${port}`, 'variable.get', { variableId: `in_${port}`, type: ports[port] }))];
 const variables = [variable('out', outputType, defaultFor(outputType)), ...lists.map(([port, value]) => variable(`in_${port}`, ports[port] as DataType, value))];
 const wires = [wire('f', 'start', 'flow', 'store', 'flow'), wire('d', 'op', output, 'store', 'value'), ...lists.map(([port]) => wire(`w_${port}`, `get_${port}`, 'value', 'op', port))];
 return result(run(compile(doc(variables, nodes, wires))));
};
const defaultFor = (type: DataType): BlueprintValue => type.endsWith('[]') ? [] : type === 'string' ? '' : type === 'boolean' ? false : type === 'vector3' ? [0, 0, 0] : 0;

it('gives the literal values', () => {
 expect(evaluate('value.integer', { value: -12 }, {}, 'value', 'integer')).toBe(-12);
 expect(evaluate('value.string', { value: 'hi' }, {}, 'value', 'string')).toBe('hi');
 expect(evaluate('value.vector3', { value: [1, 2, 3] }, {}, 'value', 'vector3')).toEqual([1, 2, 3]);
});

it('evaluates the text nodes', () => {
 const text = (type: string, inputs: Inputs, output = 'result', outputType: DataType = 'string', settings: object = {}) => evaluate(type, settings, inputs, output, outputType);
 expect(text('text.concat', { text0: 'a', text1: 'b', text2: 'c' }, 'result', 'string', { count: 3 })).toBe('abc');
 expect(text('text.format', { arg0: 'Ann', arg1: 3, arg2: [1, 2, 3] }, 'result', 'string', { template: '{0}: {1} at {2}', args: ['string', 'integer', 'vector3'] })).toBe('Ann: 3 at (1, 2, 3)');
 expect(text('text.length', { text: 'hello' }, 'length', 'integer')).toBe(5);
 expect(text('text.substring', { text: 'hello', start: 1, length: 3 })).toBe('ell');
 expect(text('text.contains', { text: 'hello', search: 'ell' }, 'result', 'boolean')).toBe(true);
 expect(text('text.startsWith', { text: 'hello', search: 'he' }, 'result', 'boolean')).toBe(true);
 expect(text('text.endsWith', { text: 'hello', search: 'he' }, 'result', 'boolean')).toBe(false);
 expect(text('text.replace', { text: 'a-b-c', search: '-', replacement: '$&+' })).toBe('a$&+b$&+c');
 expect(text('text.replace', { text: 'abc', search: '', replacement: 'x' })).toBe('abc');
 expect(text('text.toUpper', { text: 'Hi' })).toBe('HI');
 expect(text('text.toLower', { text: 'Hi' })).toBe('hi');
 expect(text('text.trim', { text: '  hi \n' })).toBe('hi');
 expect(text('text.split', { text: 'a,b,c' }, 'result', 'string[]')).toEqual(['a', 'b', 'c']);
 expect(text('text.split', { text: 'a b', separator: ' ' }, 'result', 'string[]')).toEqual(['a', 'b']);
 expect(text('text.join', { items: ['a', 'b'] })).toBe('a,b');
 expect(text('text.join', { items: ['a', 'b'], separator: ' / ' })).toBe('a / b');
 expect(text('text.equals', { a: 'Hi', b: 'hi' }, 'result', 'boolean', { ignoreCase: false })).toBe(false);
 expect(text('text.equals', { a: 'Hi', b: 'hi' }, 'result', 'boolean', { ignoreCase: true })).toBe(true);
 expect(text('text.toString', { value: 2.5 }, 'result', 'string', { type: 'number' })).toBe('2.5');
 expect(text('text.toString', { value: true }, 'result', 'string', { type: 'boolean' })).toBe('true');
 expect(text('text.toString', { value: [0, 1, 2] }, 'result', 'string', { type: 'vector3' })).toBe('(0, 1, 2)');
 expect(text('text.parseNumber', { text: ' 2.5 ' }, 'value', 'number')).toBe(2.5);
 expect(text('text.parseNumber', { text: 'x' }, 'ok', 'boolean')).toBe(false);
 expect(text('text.parseInteger', { text: '-4' }, 'value', 'integer')).toBe(-4);
 expect(text('text.parseInteger', { text: '4.5' }, 'ok', 'boolean')).toBe(false);
});

it('fails a run when a text result is above the string limit', () => {
 const long = 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH);
 expect(evaluate('text.concat', { count: 2 }, { text0: long, text1: 'y' }, 'result', 'string')).toBe('Blueprint value exceeds its limit');
 expect(evaluate('text.split', {}, { text: 'x,'.repeat(MAX_BLUEPRINT_LIST_LENGTH) }, 'result', 'string[]')).toBe('Blueprint value exceeds its limit');
 expect(evaluate('text.toUpper', {}, { text: 'ß'.repeat(MAX_BLUEPRINT_STRING_LENGTH) }, 'result', 'string')).toBe('Blueprint value exceeds its limit');
});

it('evaluates the list nodes with the index rules', () => {
 const list = (type: string, inputs: Inputs, output: string, outputType: DataType, itemType = 'string', extra: object = {}) => evaluate(type, { itemType, ...extra }, inputs, output, outputType);
 const abc = ['a', 'b', 'c'];
 expect(list('list.make', { item0: 1, item1: 2 }, 'result', 'integer[]', 'integer', { count: 3 })).toEqual([1, 2, 0]);
 expect(list('list.get', { list: abc, index: 1 }, 'item', 'string')).toBe('b');
 expect(list('list.get', { list: abc, index: 3 }, 'item', 'string')).toBe('');
 expect(list('list.get', { list: abc, index: 3 }, 'ok', 'boolean')).toBe(false);
 expect(list('list.get', { list: [[1, 2, 3]], index: -1 }, 'item', 'vector3', 'vector3')).toEqual([0, 0, 0]);
 expect(list('list.length', { list: abc }, 'length', 'integer')).toBe(3);
 expect(list('list.append', { list: abc, item: 'd' }, 'result', 'string[]')).toEqual(['a', 'b', 'c', 'd']);
 expect(list('list.insert', { list: abc, index: 3, item: 'd' }, 'result', 'string[]')).toEqual(['a', 'b', 'c', 'd']);
 expect(list('list.insert', { list: abc, index: 4, item: 'd' }, 'result', 'string[]')).toEqual(abc);
 expect(list('list.insert', { list: abc, index: 4, item: 'd' }, 'ok', 'boolean')).toBe(false);
 expect(list('list.removeAt', { list: abc, index: 0 }, 'result', 'string[]')).toEqual(['b', 'c']);
 expect(list('list.removeAt', { list: abc, index: 3 }, 'ok', 'boolean')).toBe(false);
 expect(list('list.set', { list: abc, index: 2, item: 'z' }, 'result', 'string[]')).toEqual(['a', 'b', 'z']);
 expect(list('list.set', { list: abc, index: -1, item: 'z' }, 'result', 'string[]')).toEqual(abc);
 expect(list('list.contains', { list: [[1, 2, 3]], item: [1, 2, 3] }, 'result', 'boolean', 'vector3')).toBe(true);
 expect(list('list.indexOf', { list: [true, false], item: false }, 'index', 'integer', 'boolean')).toBe(1);
 expect(list('list.indexOf', { list: abc, item: 'q' }, 'index', 'integer')).toBe(-1);
 expect(list('list.append', { list: Array(MAX_BLUEPRINT_LIST_LENGTH).fill('x'), item: 'y' }, 'result', 'string[]')).toBe('Blueprint value exceeds its limit');
});

it('picks a random list item from the seeded run random', () => {
 const nodes = [node('start', 'event.manual'), node('get', 'variable.get', { variableId: 'l', type: 'integer[]' }), node('pick', 'list.random', { itemType: 'integer' }),
  node('store', 'variable.set', { variableId: 'out', type: 'integer' }), node('flag', 'variable.set', { variableId: 'ok', type: 'boolean' })];
 const wires = [wire('1', 'start', 'flow', 'store', 'flow'), wire('2', 'store', 'exit', 'flag', 'flow'), wire('3', 'get', 'value', 'pick', 'list'), wire('4', 'pick', 'item', 'store', 'value'), wire('5', 'pick', 'ok', 'flag', 'value')];
 const compiled = (items: number[]) => compile(doc([variable('l', 'integer[]', items), variable('out', 'integer', -1), variable('ok', 'boolean', false)], nodes, wires));
 const picks = (seed: number) => {
  let state: RunState = { ...initialState(compiled([10, 20, 30, 40]).graph), random: seed };
  return Array.from({ length: 8 }, () => { const r = run(compiled([10, 20, 30, 40]), state); if (!r.ok) throw new Error(r.error.message); state = r.data.state; return r.data.state.variables.get('out'); });
 };
 expect(picks(7)).toEqual(picks(7));
 expect(picks(7).every(value => [10, 20, 30, 40].includes(value as number))).toBe(true);
 expect(new Set(picks(7)).size).toBeGreaterThan(1);
 const empty = run(compiled([]), { ...initialState(compiled([]).graph), random: 7 });
 expect(empty.ok && [empty.data.state.variables.get('out'), empty.data.state.variables.get('ok'), empty.data.state.random]).toEqual([0, false, 7]);
});

// For Each → Format String "{0}:{1}" (index, item) → Append To List Variable, then completed → Set Variable `done`.
const forEach = (items: string[]) => compile(doc(
 [variable('l', 'string[]', items), variable('out', 'string[]', []), variable('done', 'boolean', false)],
 [node('start', 'event.manual'), node('get', 'variable.get', { variableId: 'l', type: 'string[]' }), node('each', 'list.forEach', { itemType: 'string' }),
  node('fmt', 'text.format', { template: '{0}:{1}', args: ['integer', 'string'] }), node('add', 'variable.appendList', { variableId: 'out', type: 'string[]' }),
  node('end', 'variable.set', { variableId: 'done', type: 'boolean' }, { value: true })],
 [wire('1', 'start', 'flow', 'each', 'flow'), wire('2', 'get', 'value', 'each', 'list'), wire('3', 'each', 'body', 'add', 'flow'), wire('4', 'each', 'index', 'fmt', 'arg0'),
  wire('5', 'each', 'item', 'fmt', 'arg1'), wire('6', 'fmt', 'result', 'add', 'item'), wire('7', 'each', 'completed', 'end', 'flow')]));

it('runs For Each body once per item in order, then completed', () => {
 const outcome = run(forEach(['a', 'b', 'c']));
 expect(outcome.ok && outcome.data.state.variables.get('out')).toEqual(['0:a', '1:b', '2:c']);
 expect(outcome.ok && outcome.data.state.variables.get('done')).toBe(true);
 const empty = run(forEach([]));
 expect(empty.ok && [empty.data.state.variables.get('out'), empty.data.state.variables.get('done')]).toEqual([[], true]);
 expect(run(forEach(Array(64).fill('x'))).ok).toBe(true);
 expect(run(forEach(Array(65).fill('x')))).toMatchObject({ ok: false, error: { message: 'Blueprint loop exceeded its iteration limit', ids: ['each'] } });
});

it('routes Switch On String and Switch On Integer to the matching case, else default', () => {
 const route = (type: string, cases: unknown[], value: BlueprintValue) => {
  const compiled = compile(doc([], [node('start', 'event.manual'), node('sw', type, { cases }, { value }), ...['c0', 'c1', 'd'].map(id => node(id, 'scene.toggleVisibility', { entityId: id }))],
   [wire('1', 'start', 'flow', 'sw', 'flow'), wire('2', 'sw', 'case0', 'c0', 'flow'), wire('3', 'sw', 'case1', 'c1', 'flow'), wire('4', 'sw', 'default', 'd', 'flow')]));
  const outcome = run(compiled);
  return outcome.ok ? outcome.data.effects.map(effect => 'entityId' in effect ? effect.entityId : '').join() : outcome.error.message;
 };
 expect(['happy', 'sad', 'Happy', ''].map(value => route('switch.string', ['happy', 'sad'], value))).toEqual(['c0', 'c1', 'd', 'd']);
 expect([5, -3, 0].map(value => route('switch.integer', [-3, 5], value))).toEqual(['c1', 'c0', 'd']);
});

it('sets and gets a variable of each of the ten data types', () => {
 const samples: Record<DataType, BlueprintValue> = {
  number: 2.5, integer: 7, boolean: true, string: 'hi', vector3: [1, 2, 3],
  'number[]': [0.5], 'integer[]': [1, 2], 'boolean[]': [true], 'string[]': ['a', ''], 'vector3[]': [[1, 1, 1]],
 };
 for (const type of DATA_TYPES) {
  // Get Variable(src) → Set Variable(out) → Get Variable(out) → Set Variable(copy).
  const compiled = compile(doc([variable('src', type, samples[type]), variable('out', type, defaultFor(type)), variable('copy', type, defaultFor(type))],
   [node('start', 'event.manual'), node('src', 'variable.get', { variableId: 'src', type }), node('set', 'variable.set', { variableId: 'out', type }),
    node('get', 'variable.get', { variableId: 'out', type }), node('copy', 'variable.set', { variableId: 'copy', type })],
   [wire('1', 'start', 'flow', 'set', 'flow'), wire('2', 'src', 'value', 'set', 'value'), wire('3', 'set', 'exit', 'copy', 'flow'), wire('4', 'get', 'value', 'copy', 'value')]));
  const outcome = run(compiled);
  expect(outcome.ok && [outcome.data.state.variables.get('out'), outcome.data.state.variables.get('copy')], type).toEqual([samples[type], samples[type]]);
 }
});

it('needs a variable of the type in the settings', () => {
 const graph = (type: string) => doc([variable('v', 'string', 'a')], [node('get', 'variable.get', { variableId: 'v', type })], []);
 expect(compileBlueprint(graph('string')).ok).toBe(true);
 expect(compileBlueprint(graph('integer'))).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing', ids: ['get'] } });
 expect(compileBlueprint(doc([], [node('add', 'variable.appendList', { variableId: 'v', type: 'string[]' })], []))).toMatchObject({ ok: false, error: { message: 'Blueprint variable is missing' } });
});

it('appends to, clears, and increments variables within the limits', () => {
 const helper = (type: string, settings: object, initial: BlueprintValue, varType: DataType, inputs?: Inputs) =>
  result(run(compile(doc([variable('out', varType, initial)], [node('start', 'event.manual'), node('op', type, { variableId: 'out', ...settings }, inputs)], [wire('1', 'start', 'flow', 'op', 'flow')]))));
 expect(helper('variable.appendList', { type: 'vector3[]' }, [[0, 0, 0]], 'vector3[]', { item: [1, 2, 3] })).toEqual([[0, 0, 0], [1, 2, 3]]);
 expect(helper('variable.appendList', { type: 'string[]' }, Array(MAX_BLUEPRINT_LIST_LENGTH).fill(''), 'string[]', { item: 'x' })).toBe('Blueprint value exceeds its limit');
 expect(helper('variable.clearList', { type: 'integer[]' }, [1, 2], 'integer[]')).toEqual([]);
 expect(helper('variable.incrementInteger', {}, 5, 'integer')).toBe(6);
 expect(helper('variable.incrementInteger', {}, 5, 'integer', { amount: -8 })).toBe(-3);
 expect(helper('variable.incrementInteger', {}, Number.MAX_SAFE_INTEGER, 'integer')).toBe('Blueprint data could not be evaluated');
});

// W0 R15: the session tests that waited for a node with an integer port or a string or list output.
it('carries an integer output into a number input', () => {
 const compiled = compile(doc([variable('n', 'number', 0)],
  [node('start', 'event.manual'), node('len', 'text.length', {}, { text: 'four' }), node('add', 'math.add', {}), node('seven', 'value.integer', { value: 7 }), node('set', 'variable.setNumber', { variableId: 'n' })],
  [wire('1', 'start', 'flow', 'set', 'flow'), wire('2', 'len', 'length', 'add', 'a'), wire('3', 'seven', 'value', 'add', 'b'), wire('4', 'add', 'result', 'set', 'value')]));
 expect(result(run(compiled), 'n')).toBe(11);
});

it('rejects a number output into an integer input at connect and at compile', () => {
 const nodes = [node('f', 'value.number', { value: 1.5 }), node('sub', 'text.substring')];
 const connection = wire('w', 'f', 'value', 'sub', 'start');
 const graph = doc([], nodes, []) as BlueprintGraph;
 expect(applyBlueprintOps([graph], [{ kind: 'connect', graphId: 'g', connection }])).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match', ids: ['f', 'sub'] } });
 expect(compileBlueprint(doc([], nodes, [connection]))).toMatchObject({ ok: false, error: { message: 'Blueprint ports do not match' } });
});

it('fails a run that goes above the string or list limit and keeps the variables', () => {
 const items = Array(MAX_BLUEPRINT_LIST_LENGTH).fill('x');
 const graph = doc([variable('s', 'string', 'hello'), variable('l', 'string[]', items)], [
  // `string`: Sequence → set s to "changed", then set s to a string of 1025 code units.
  node('string', 'event.manual'), node('seq', 'flow.sequence', { outputs: 2 }),
  node('first', 'variable.set', { variableId: 's', type: 'string' }, { value: 'changed' }), node('long', 'text.concat', { count: 2 }, { text0: 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH), text1: 'y' }),
  node('second', 'variable.set', { variableId: 's', type: 'string' }),
  // `list`: append one item to the full list.
  node('list', 'event.manual'), node('append', 'variable.appendList', { variableId: 'l', type: 'string[]' }, { item: 'y' }),
  // `check`: visible = (s == "hello") and (length of l == 256, an integer into a number input).
  node('check', 'event.manual'), node('gets', 'variable.get', { variableId: 's', type: 'string' }), node('eq', 'text.equals', { ignoreCase: false }, { b: 'hello' }),
  node('getl', 'variable.get', { variableId: 'l', type: 'string[]' }), node('len', 'list.length', { itemType: 'string' }), node('full', 'logic.equal', {}, { b: MAX_BLUEPRINT_LIST_LENGTH }),
  node('and', 'logic.and'), node('show', 'scene.setVisibility', { entityId: 'marker' }),
 ], [
  wire('1', 'string', 'flow', 'seq', 'flow'), wire('2', 'seq', 'then0', 'first', 'flow'), wire('3', 'seq', 'then1', 'second', 'flow'), wire('4', 'long', 'result', 'second', 'value'),
  wire('5', 'list', 'flow', 'append', 'flow'),
  wire('6', 'check', 'flow', 'show', 'flow'), wire('7', 'gets', 'value', 'eq', 'a'), wire('8', 'getl', 'value', 'len', 'list'), wire('9', 'len', 'length', 'full', 'a'),
  wire('10', 'eq', 'result', 'and', 'a'), wire('11', 'full', 'result', 'and', 'b'), wire('12', 'and', 'result', 'show', 'visible'),
 ]);
 const runtime = createBlueprintRuntime();
 expect(runtime.install([graph]).ok).toBe(true);
 const manual = (nodeId: string) => ({ kind: 'manual' as const, graphId: 'g', nodeId });
 expect(runtime.step([manual('string'), manual('list'), manual('check')], 0)).toEqual([
  { graphId: 'g', effects: [], error: { code: 'INVALID_INPUT', message: 'Blueprint value exceeds its limit', ids: ['second'] } },
  { graphId: 'g', effects: [], error: { code: 'INVALID_INPUT', message: 'Blueprint value exceeds its limit', ids: ['append'] } },
  { graphId: 'g', effects: [{ kind: 'setVisibility', entityId: 'marker', visible: true }], error: null },
 ]);
});
