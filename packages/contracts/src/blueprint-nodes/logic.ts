import { defineNode, empty } from './define';

export const LOGIC_NODES = [
 defineNode({ type: 'logic.greater', label: 'Greater Than', category: 'Logic', keywords: ['compare', '>', 'more'], settings: empty, ports: () => ({ inputs: { a: 'number', b: 'number' }, outputs: { result: 'boolean' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'logic.not', label: 'Not', category: 'Logic', keywords: ['invert', 'negate', '!'], settings: empty, ports: () => ({ inputs: { value: 'boolean' }, outputs: { result: 'boolean' } }), defaults: () => ({}), fields: [] }),
] as const;
