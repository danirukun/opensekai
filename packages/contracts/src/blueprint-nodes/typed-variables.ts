import { z } from 'zod';
import { DATA_TYPES, isListType, itemType, type DataType, type ListType } from '../blueprint-values';
import { defineNode, exit, IdSchema, type DefaultRefs } from './define';

const LIST_TYPES = DATA_TYPES.filter(isListType);
const anyVariable = z.strictObject({ variableId: IdSchema, type: z.enum(DATA_TYPES as [DataType, ...DataType[]]) });
const listVariable = z.strictObject({ variableId: IdSchema, type: z.enum(LIST_TYPES as [ListType, ...ListType[]]) });
// The settings of the first variable whose type `accept` takes, or null.
const firstOf = <T extends DataType = DataType>(accept?: (type: DataType) => type is T) => (refs: DefaultRefs) => {
 const variable = refs.variables?.find(v => !accept || accept(v.type));
 return variable ? { variableId: variable.id, type: variable.type as T } : null;
};
const isInteger = (type: DataType): type is 'integer' => type === 'integer';
const field = (lists: boolean) => [{ key: 'variableId', label: 'Variable', kind: 'typedVariable', typeKey: 'type', ...(lists ? { lists } : {}) }] as const;
const keywords = (...words: string[]) => ['variable', ...words];

export const TYPED_VARIABLE_NODES = [
 defineNode({ type: 'variable.get', label: 'Get Variable', category: 'Variables', keywords: keywords('get', 'read'), settings: anyVariable, ports: s => ({ inputs: {}, outputs: { value: s.type } }), defaults: firstOf(), fields: field(false), dynamicPorts: true }),
 defineNode({ type: 'variable.set', label: 'Set Variable', category: 'Variables', keywords: keywords('set', 'write', 'store'), settings: anyVariable, ports: s => ({ inputs: { flow: 'flow', value: s.type }, outputs: { ...exit } }), defaults: firstOf(), fields: field(false), dynamicPorts: true }),
 defineNode({ type: 'variable.appendList', label: 'Append To List Variable', category: 'Variables', keywords: keywords('list', 'append', 'add', 'push'), settings: listVariable, ports: s => ({ inputs: { flow: 'flow', item: itemType(s.type) }, outputs: { ...exit } }), defaults: firstOf(isListType), fields: field(true), dynamicPorts: true }),
 defineNode({ type: 'variable.clearList', label: 'Clear List Variable', category: 'Variables', keywords: keywords('list', 'clear', 'empty', 'reset'), settings: listVariable, ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: firstOf(isListType), fields: field(true) }),
 defineNode({ type: 'variable.incrementInteger', label: 'Increment Integer Variable', category: 'Variables', keywords: keywords('increment', 'add', 'count', 'counter', 'integer'), settings: z.strictObject({ variableId: IdSchema }), ports: () => ({ inputs: { flow: 'flow', amount: 'integer' }, outputs: { ...exit } }), defaults: refs => { const first = firstOf(isInteger)(refs); return first && { variableId: first.variableId }; }, fields: [{ key: 'variableId', label: 'Variable', kind: 'variable', variableType: 'integer' }], inputDefaults: { amount: 1 } }),
] as const;
