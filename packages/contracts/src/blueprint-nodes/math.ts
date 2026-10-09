import { defineNode, empty, type PortShape } from './define';

const binary = (): PortShape => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'number' } });
export const MATH_NODES = [
 defineNode({ type: 'math.add', label: 'Add', category: 'Math', keywords: ['plus', 'sum', '+'], settings: empty, ports: binary, defaults: () => ({}), fields: [] }),
] as const;
