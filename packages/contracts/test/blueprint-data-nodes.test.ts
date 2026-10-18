import { expect, it } from 'vitest';
import { applyBlueprintOps, BlueprintNodeSchema, blueprintPorts, defaultBlueprintSettings, type BlueprintGraph, type BlueprintKind, type BlueprintNode, type DefaultRefs } from '../src';

const keystroke = { code: 'KeyH', control: true, alt: true, shift: false, meta: false };
const node = (type: string, settings: unknown, id = 'x') => ({ id, version: 1, type, settings, position: { x: 0, y: 0 } }) as BlueprintNode;
const ports = (type: string, settings: unknown) => blueprintPorts(node(type, settings));
const parses = (type: string, settings: unknown) => BlueprintNodeSchema.safeParse(node(type, settings)).success;

it('gives list node ports the list type of the item type setting', () => {
 expect(ports('list.get', { itemType: 'vector3' })).toEqual({ inputs: { list: 'vector3[]', index: 'integer' }, outputs: { item: 'vector3', ok: 'boolean' } });
 expect(ports('list.make', { itemType: 'integer', count: 3 })).toEqual({ inputs: { item0: 'integer', item1: 'integer', item2: 'integer' }, outputs: { result: 'integer[]' } });
 expect(ports('list.forEach', { itemType: 'string' })).toEqual({ inputs: { flow: 'flow', list: 'string[]' }, outputs: { body: 'flow', item: 'string', index: 'integer', completed: 'flow' } });
 expect(parses('list.get', { itemType: 'string[]' })).toBe(false);
});

it('gives text node ports from their count, argument types, and input type', () => {
 expect(ports('text.concat', { count: 3 }).inputs).toEqual({ text0: 'string', text1: 'string', text2: 'string' });
 expect(ports('text.format', { template: '{0} {1}', args: ['integer', 'vector3'] }).inputs).toEqual({ arg0: 'integer', arg1: 'vector3' });
 expect(ports('text.toString', { type: 'boolean' })).toEqual({ inputs: { value: 'boolean' }, outputs: { result: 'string' } });
 expect(parses('text.toString', { type: 'string' })).toBe(false);
 expect(parses('text.format', { template: '', args: Array(9).fill('string') })).toBe(false);
 expect(parses('text.concat', { count: 1 })).toBe(false);
});

it('rejects switch cases that repeat or are out of range', () => {
 expect(ports('switch.string', { cases: ['a', 'b', 'c'] }).outputs).toEqual({ case0: 'flow', case1: 'flow', case2: 'flow', default: 'flow' });
 expect(parses('switch.string', { cases: ['a', 'a'] })).toBe(false);
 expect(parses('switch.string', { cases: [] })).toBe(false);
 expect(parses('switch.integer', { cases: [0, 1.5] })).toBe(false);
 expect(ports('switch.integer', { cases: [3] }).inputs).toEqual({ flow: 'flow', value: 'integer' });
});

it('rejects literal values outside their type', () => {
 expect(parses('value.integer', { value: 2.5 })).toBe(false);
 expect(parses('value.integer', { value: Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
 expect(parses('value.string', { value: 'x'.repeat(1025) })).toBe(false);
 expect(parses('value.vector3', { value: [1, 2] })).toBe(false);
});

it('gives typed variable nodes the ports of their type and defaults to the first fitting variable', () => {
 const refs: DefaultRefs = { keystroke, variables: [{ id: 'n', type: 'number' }, { id: 'names', type: 'string[]' }, { id: 'count', type: 'integer' }] };
 const defaults = (type: BlueprintKind) => defaultBlueprintSettings(type, refs);
 expect(defaults('variable.get')).toEqual({ variableId: 'n', type: 'number' });
 expect(defaults('variable.appendList')).toEqual({ variableId: 'names', type: 'string[]' });
 expect(defaults('variable.incrementInteger')).toEqual({ variableId: 'count' });
 expect(defaultBlueprintSettings('variable.clearList', { keystroke, variables: [{ id: 'n', type: 'number' }] })).toBeNull();
 expect(ports('variable.set', { variableId: 'v', type: 'vector3[]' }).inputs).toEqual({ flow: 'flow', value: 'vector3[]' });
 expect(ports('variable.appendList', { variableId: 'v', type: 'boolean[]' }).inputs).toEqual({ flow: 'flow', item: 'boolean' });
 expect(parses('variable.appendList', { variableId: 'v', type: 'boolean' })).toBe(false);
});

it('drops wires and inline values that no longer fit after an item type change', () => {
 const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true, variables: [],
  nodes: [node('value.string', { value: 'a' }, 's'), { ...node('list.append', { itemType: 'string' }, 'a'), inputs: { item: 'b' } }],
  connections: [{ id: 'w', sourceNodeId: 's', sourcePort: 'value', targetNodeId: 'a', targetPort: 'item' }] } as BlueprintGraph;
 const reply = applyBlueprintOps([graph], [{ kind: 'setNodeSettings', graphId: 'g', nodeId: 'a', settings: { itemType: 'integer' } }]);
 expect(reply.ok && reply.data[0]!.connections).toEqual([]);
 expect(reply.ok && reply.data[0]!.nodes[1]!.inputs).toBeUndefined();
});

it('retypes typed variable nodes when their variable changes type, and drops what no longer fits', () => {
 const graph = { schemaVersion: 1, id: 'g', name: 'G', enabled: true,
  variables: [{ id: 'v', name: 'V', type: 'string', default: 'a' }, { id: 'l', name: 'L', type: 'string[]', default: [] }, { id: 'n', name: 'N', type: 'number', default: 0 }],
  nodes: [node('variable.get', { variableId: 'v', type: 'string' }, 'get'), node('text.toUpper', {}, 'up'), { ...node('variable.set', { variableId: 'v', type: 'string' }, 'set'), inputs: { value: 'x' } },
   { ...node('variable.appendList', { variableId: 'l', type: 'string[]' }, 'add'), inputs: { item: 'b' } }, node('variable.setNumber', { variableId: 'n' }, 'old')],
  connections: [{ id: 'w', sourceNodeId: 'get', sourcePort: 'value', targetNodeId: 'up', targetPort: 'text' }] } as BlueprintGraph;
 const apply = (ops: object[]) => { const reply = applyBlueprintOps([graph], ops as never); if (!reply.ok) throw new Error(reply.error.message); return reply.data[0]!; };
 const byId = (g: BlueprintGraph, id: string) => g.nodes.find(item => item.id === id)!;

 const scalar = apply([{ kind: 'updateVariable', graphId: 'g', variableId: 'v', type: 'integer' }]);
 expect(byId(scalar, 'get').settings).toEqual({ variableId: 'v', type: 'integer' });
 expect(byId(scalar, 'set')).toMatchObject({ settings: { variableId: 'v', type: 'integer' } });
 expect(byId(scalar, 'set').inputs).toBeUndefined();
 expect(scalar.connections).toEqual([]);

 const list = apply([{ kind: 'updateVariable', graphId: 'g', variableId: 'l', type: 'integer[]' }]);
 expect(byId(list, 'add').settings).toEqual({ variableId: 'l', type: 'integer[]' });
 expect(byId(list, 'add').inputs).toBeUndefined();
 // A list node cannot take a scalar type, so it stays as it is.
 expect(byId(apply([{ kind: 'updateVariable', graphId: 'g', variableId: 'l', type: 'integer' }]), 'add').settings).toEqual({ variableId: 'l', type: 'string[]' });
 // The number and boolean variable nodes keep their settings.
 expect(byId(apply([{ kind: 'updateVariable', graphId: 'g', variableId: 'n', type: 'boolean' }]), 'old').settings).toEqual({ variableId: 'n' });
 // A name change keeps the wires.
 expect(apply([{ kind: 'updateVariable', graphId: 'g', variableId: 'v', name: 'W' }]).connections).toHaveLength(1);
});
