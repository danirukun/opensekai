import type { ScalarValue } from '../blueprint-values';
import { defineNode, empty, type NodeCategory, type PortShape } from './define';

const toInteger = (): PortShape => ({ inputs: { value: 'number' }, outputs: { result: 'integer' } });
const unary = (): PortShape => ({ inputs: { value: 'integer' }, outputs: { result: 'integer' } });
const binary = (): PortShape => ({ inputs: { a: 'integer', b: 'integer' }, outputs: { result: 'integer' } });
const integer = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape, inputDefaults?: Record<string, ScalarValue>, category: NodeCategory = 'Math') =>
 defineNode({ type, label, category, keywords: ['integer', 'int', ...keywords], settings: empty, ports, defaults: () => ({}), fields: [], ...(inputDefaults ? { inputDefaults } : {}) });
export const INTEGER_NODES = [
 integer('integer.round', 'Round to Integer', ['round', 'nearest', 'convert', 'float'], toInteger),
 integer('integer.floor', 'Floor to Integer', ['floor', 'down', 'convert', 'float'], toInteger),
 integer('integer.ceil', 'Ceil to Integer', ['ceil', 'ceiling', 'up', 'convert', 'float'], toInteger),
 integer('integer.truncate', 'Truncate to Integer', ['truncate', 'toward zero', 'convert', 'float'], toInteger),
 integer('integer.add', 'Add Integer', ['plus', 'sum', '+'], binary),
 integer('integer.subtract', 'Subtract Integer', ['minus', 'difference', '-'], binary),
 integer('integer.multiply', 'Multiply Integer', ['times', 'product', '*'], binary),
 integer('integer.divide', 'Divide Integer', ['quotient', '/', 'truncate'], binary, { b: 1 }),
 integer('integer.modulo', 'Modulo Integer', ['remainder', '%', 'mod', 'wrap'], binary, { b: 2 }),
 integer('integer.negate', 'Negate Integer', ['negative', 'invert sign', '-'], unary),
 integer('integer.abs', 'Abs Integer', ['absolute', 'magnitude'], unary),
 integer('integer.min', 'Min Integer', ['smallest', 'minimum', 'lower'], binary),
 integer('integer.max', 'Max Integer', ['largest', 'maximum', 'upper'], binary),
 integer('integer.clamp', 'Clamp Integer', ['limit', 'range', 'bound'], () => ({ inputs: { value: 'integer', min: 'integer', max: 'integer' }, outputs: { result: 'integer' } }), { max: 1 }),
 integer('integer.random', 'Random Integer', ['chance', 'dice', 'range', 'roll'], () => ({ inputs: { min: 'integer', max: 'integer' }, outputs: { result: 'integer' } }), { max: 1 }),
 integer('integer.isEven', 'Is Even', ['even', 'odd', 'parity'], () => ({ inputs: { value: 'integer' }, outputs: { result: 'boolean' } }), undefined, 'Logic'),
] as const;
