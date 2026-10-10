import { z } from 'zod';
import { defineNode, exit, IdSchema, type DefaultRefs, type PortShape } from './define';

const settings = z.strictObject({ variableId: IdSchema });
const first = (type: 'number' | 'boolean') => (refs: DefaultRefs) => { const variable = refs.variables?.find(v => v.type === type); return variable ? { variableId: variable.id } : null; };
const variable = <const T extends string>(type: T, label: string, keywords: string[], valueType: 'number' | 'boolean', ports: () => PortShape) =>
 defineNode({ type, label, category: 'Variables', keywords: ['variable', ...keywords], settings, ports, defaults: first(valueType), fields: [{ key: 'variableId', label: 'Variable', kind: 'variable', variableType: valueType }] });
export const VARIABLE_NODES = [
 variable('variable.getNumber', 'Get Number Variable', ['get', 'read'], 'number', () => ({ inputs: {}, outputs: { value: 'number' } })),
 variable('variable.getBoolean', 'Get Boolean Variable', ['get', 'read'], 'boolean', () => ({ inputs: {}, outputs: { value: 'boolean' } })),
 variable('variable.setNumber', 'Set Number Variable', ['set', 'write', 'store'], 'number', () => ({ inputs: { flow: 'flow', value: 'number' }, outputs: { ...exit } })),
 variable('variable.setBoolean', 'Set Boolean Variable', ['set', 'write', 'store'], 'boolean', () => ({ inputs: { flow: 'flow', value: 'boolean' }, outputs: { ...exit } })),
 variable('variable.addNumber', 'Add To Number Variable', ['add', 'increment', 'count', 'counter'], 'number', () => ({ inputs: { flow: 'flow', amount: 'number' }, outputs: { ...exit } })),
 variable('variable.toggleBoolean', 'Toggle Boolean Variable', ['toggle', 'flip', 'invert'], 'boolean', () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } })),
] as const;
