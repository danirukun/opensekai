import { defineNode, empty, type PortShape } from './define';

const binary = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
const unary = (): PortShape => ({ inputs: { value: 'number' }, outputs: { result: 'number' } });
const math = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape) =>
 defineNode({ type, label, category: 'Math', keywords, settings: empty, ports, defaults: () => ({}), fields: [] });
export const MATH_NODES = [
 math('math.add', 'Add', ['plus', 'sum', '+'], binary),
 math('math.subtract', 'Subtract', ['minus', 'difference', '-'], binary),
 math('math.multiply', 'Multiply', ['times', 'product', '*', 'scale'], binary),
 math('math.divide', 'Divide', ['quotient', '/', 'ratio'], binary),
 math('math.min', 'Min', ['smallest', 'minimum', 'lower'], binary),
 math('math.max', 'Max', ['largest', 'maximum', 'upper'], binary),
 math('math.clamp', 'Clamp', ['limit', 'range', 'bound'], () => ({ inputs: { value: 'number', min: 'number', max: 'number' }, outputs: { result: 'number' } })),
 math('math.abs', 'Abs', ['absolute', 'magnitude'], unary),
 math('math.round', 'Round', ['nearest', 'integer'], unary),
 math('math.floor', 'Floor', ['down', 'integer', 'truncate'], unary),
 math('math.random', 'Random Number', ['random', 'chance', 'dice', 'range'], () => ({ inputs: { min: 'number', max: 'number' }, outputs: { result: 'number' } })),
] as const;
