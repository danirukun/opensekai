import { expect, it } from 'vitest';
import vectors from '../../../fixtures/protocol/blueprint-variables.json';
import {
 applyBlueprintOps, blueprintValueProblem, BlueprintGraphSchema, BlueprintNodeSchema, BlueprintOpSchema, canConnect, connectionType, DATA_TYPES, DATA_TYPE_LABELS,
 defaultBlueprintValue, inlineInputType, isBlueprintValue, itemType, listOf, MAX_BLUEPRINT_LIST_LENGTH, MAX_BLUEPRINT_STRING_LENGTH,
 exportBlueprint, importBlueprint, makeSmokeScene, pruneInlineInputs, serializeBlueprintFile, ShowDocumentSchema, unconnectedInputValue, type BlueprintGraph, type BlueprintNode,
} from '../src';

const node = (id: string, type: string, settings: object = {}, inputs?: object) => ({ id, version: 1, type, settings, position: { x: 0, y: 0 }, ...(inputs ? { inputs } : {}) }) as BlueprintNode;
const graphOf = (nodes: BlueprintNode[]): BlueprintGraph => ({ schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [], nodes, connections: [] });
const ok = (r: ReturnType<typeof applyBlueprintOps>) => { if (!r.ok) throw new Error(r.error.message); return r.data[0]!; };

it('names ten data types: five scalars and a list of each', () => {
 expect(DATA_TYPES).toEqual(['number', 'integer', 'boolean', 'string', 'vector3', 'number[]', 'integer[]', 'boolean[]', 'string[]', 'vector3[]']);
 expect(listOf('string')).toBe('string[]');
 expect(itemType('vector3[]')).toBe('vector3');
 expect(DATA_TYPE_LABELS['integer[]']).toBe('Integer List');
});

it('connects equal types and widens an integer output into a number input only', () => {
 for (const type of [...DATA_TYPES, 'flow'] as const) expect(canConnect(type, type)).toBe(true);
 expect(canConnect('integer', 'number')).toBe(true);
 expect(canConnect('number', 'integer')).toBe(false);
 expect(canConnect('integer[]', 'number[]')).toBe(false);
 expect(canConnect('boolean', 'number')).toBe(false);
 expect(canConnect('flow', 'boolean')).toBe(false);
 expect(canConnect('string', 'string[]')).toBe(false);
});

it('gives each type a default that its own schema accepts', () => {
 expect(DATA_TYPES.map(type => defaultBlueprintValue(type))).toEqual([0, 0, false, '', [0, 0, 0], [], [], [], [], []]);
 for (const type of DATA_TYPES) expect(isBlueprintValue(type, defaultBlueprintValue(type)), type).toBe(true);
 expect(defaultBlueprintValue('vector3')).not.toBe(defaultBlueprintValue('vector3'));
});

it('checks value shapes and tells a limit apart from a wrong type', () => {
 expect(isBlueprintValue('integer', 3)).toBe(true);
 expect(isBlueprintValue('integer', 2.5)).toBe(false);
 expect(isBlueprintValue('integer', Number.MAX_SAFE_INTEGER + 1)).toBe(false);
 expect(isBlueprintValue('number', Number.NaN)).toBe(false);
 expect(isBlueprintValue('vector3', [1, 2])).toBe(false);
 expect(isBlueprintValue('vector3[]', [[1, 2, 3]])).toBe(true);
 expect(isBlueprintValue('number[]', [1, true])).toBe(false);
 expect(blueprintValueProblem('string', 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH))).toBeNull();
 expect(blueprintValueProblem('string', 'x'.repeat(MAX_BLUEPRINT_STRING_LENGTH + 1))).toBe('limit');
 expect(blueprintValueProblem('integer[]', Array.from({ length: MAX_BLUEPRINT_LIST_LENGTH + 1 }, () => 1))).toBe('limit');
 expect(blueprintValueProblem('string[]', ['x'.repeat(MAX_BLUEPRINT_STRING_LENGTH + 1)])).toBe('limit');
 expect(blueprintValueProblem('string', 4)).toBe('type');
});

it('accepts a variable of each data type and inline values in the shared typed vector', () => {
 const typed = BlueprintGraphSchema.parse(structuredClone(vectors.typed));
 expect(typed.variables.map(v => v.type)).toEqual(DATA_TYPES);
 expect(typed.nodes.map(n => n.inputs)).toEqual([{ a: 2, b: 0.5 }, { delta: [0, 0.1, 0] }]);
});

it('retypes a variable to the default of its new type and checks a new default against the type', () => {
 const graphs = [BlueprintGraphSchema.parse(structuredClone(vectors.valid))];
 expect(ok(applyBlueprintOps(graphs, [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'string[]' }])).variables[0]).toEqual({ id: 'count', name: 'Count', type: 'string[]', default: [] });
 expect(ok(applyBlueprintOps(graphs, [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'vector3', default: [1, 2, 3] }])).variables[0]!.default).toEqual([1, 2, 3]);
 expect(applyBlueprintOps(graphs, [{ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'integer', default: 0.5 }])).toMatchObject({ ok: false, error: { message: 'Invalid variable' } });
 expect(BlueprintOpSchema.safeParse({ kind: 'updateVariable', graphId: 'counter', variableId: 'count', type: 'color' }).success).toBe(false);
});

it('accepts inline values that match scalar data inputs and rejects all others', () => {
 const valid = (inputs: object, type = 'math.add', settings = {}) => BlueprintNodeSchema.safeParse(node('n', type, settings, inputs)).success;
 expect(valid({ a: 1.5, b: -2 })).toBe(true);
 expect(valid({})).toBe(true);
 expect(valid({ delta: [0, 1, 0] }, 'entity.move', { entityId: 'e', space: 'world' })).toBe(true);
 expect(valid({ a: true })).toBe(false);
 expect(valid({ c: 1 })).toBe(false);
 expect(valid({ flow: 1 }, 'scene.setVisibility', { entityId: 'e' })).toBe(false);
 expect(valid({ a: Number.POSITIVE_INFINITY })).toBe(false);
 const proto = BlueprintNodeSchema.parse(JSON.parse('{"id":"n","version":1,"type":"math.add","settings":{},"position":{"x":0,"y":0},"inputs":{"__proto__":{"a":1}}}'));
 expect(Object.getPrototypeOf(proto.inputs)).toBe(Object.prototype);
 expect(Object.keys(proto.inputs!)).toEqual([]);
 expect(BlueprintNodeSchema.safeParse({ ...node('n', 'math.add'), inputs: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`p${i}`, 1])) }).success).toBe(false);
});

it('reads the inline value of an unconnected input, else the default of its type', () => {
 const add = node('n', 'math.add', {}, { a: 4 });
 expect(unconnectedInputValue(add, 'a')).toBe(4);
 expect(unconnectedInputValue(add, 'b')).toBe(0);
 expect(unconnectedInputValue(node('m', 'entity.move', { entityId: 'e', space: 'world' }), 'delta')).toEqual([0, 0, 0]);
 expect(() => unconnectedInputValue(add, 'result')).toThrow();
 expect(inlineInputType(add, 'a')).toBe('number');
 expect(inlineInputType(node('s', 'scene.setVisibility', { entityId: 'e' }), 'flow')).toBeNull();
});

it('sets and clears an inline value with setNodeInput and rejects one that does not fit', () => {
 const graphs = [graphOf([node('add', 'math.add')])];
 const set = ok(applyBlueprintOps(graphs, [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'add', port: 'a', value: 3 }]));
 expect(set.nodes[0]!.inputs).toEqual({ a: 3 });
 const cleared = ok(applyBlueprintOps([set], [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'add', port: 'a', value: null }]));
 expect('inputs' in cleared.nodes[0]!).toBe(false);
 expect(applyBlueprintOps(graphs, [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'add', port: 'a', value: 'x' }])).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid inline input', ids: ['add'] } });
 expect(applyBlueprintOps(graphs, [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'add', port: 'result', value: 1 }])).toMatchObject({ ok: false, error: { message: 'Invalid inline input' } });
 expect(applyBlueprintOps(graphs, [{ kind: 'setNodeInput', graphId: 'g', nodeId: 'gone', port: 'a', value: 1 }])).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
 expect(BlueprintOpSchema.safeParse({ kind: 'setNodeInput', graphId: 'g', nodeId: 'add', port: 'a', value: [1, 2, 3, 4] }).success).toBe(false);
});

it('drops inline values that a settings change makes invalid and keeps the others', () => {
 const set = node('set', 'property.set', { entityId: 'e', property: 'position' }, { value: [1, 2, 3] });
 expect(pruneInlineInputs({ ...set, settings: { entityId: 'e', property: 'visible' } } as BlueprintNode)).not.toHaveProperty('inputs');
 const scale = ok(applyBlueprintOps([graphOf([set])], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'set', settings: { entityId: 'e', property: 'scale' } }]));
 expect(scale.nodes[0]!.inputs).toEqual({ value: [1, 2, 3] });
 const visible = ok(applyBlueprintOps([graphOf([set])], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'set', settings: { entityId: 'e', property: 'visible' } }]));
 expect(visible.nodes[0]).not.toHaveProperty('inputs');
});

it('keeps the port type of an input as the connection type', () => {
 const source = node('v', 'value.number'), target = node('a', 'math.add');
 expect(connectionType(source, 'value', target, 'a')).toBe('number');
 expect(connectionType(node('b', 'value.boolean'), 'value', target, 'a')).toBeNull();
});

it('keeps typed variables and inline values through a Blueprint file and a show document', () => {
 const typed = BlueprintGraphSchema.parse(structuredClone(vectors.typed));
 const scene = makeSmokeScene();
 const imported = importBlueprint(serializeBlueprintFile(exportBlueprint(typed, scene)), scene, () => 'copy');
 expect(imported.ok && imported.data.graph).toEqual({ ...typed, id: 'copy' });
 expect(ShowDocumentSchema.parse({ schemaVersion: 1, name: 'Show', scene, blueprints: [typed] }).blueprints[0]).toEqual(typed);
});
