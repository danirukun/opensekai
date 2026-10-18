import { z } from 'zod';
import { DATA_TYPE_LABELS, SCALAR_TYPES, type ScalarType } from '../blueprint-values';
import { BlueprintStringSchema } from './literals';
import { defineNode, empty, type PortShape, type PortType } from './define';

export const MAX_FORMAT_ARGS = 8;
const numberedOf = (prefix: string, types: readonly PortType[]): Record<string, PortType> => Object.fromEntries(types.map((type, i) => [`${prefix}${i}`, type]));
const STRINGABLE = ['number', 'integer', 'boolean', 'vector3'] as const;
const pure = <const T extends string>(type: T, label: string, keywords: string[], ports: () => PortShape, inputDefaults?: Record<string, string>) =>
 defineNode({ type, label, category: 'Text', keywords: ['string', 'text', ...keywords], settings: empty, ports, defaults: () => ({}), fields: [], ...(inputDefaults ? { inputDefaults } : {}) });
const unary = (): PortShape => ({ inputs: { text: 'string' }, outputs: { result: 'string' } });
const test = (): PortShape => ({ inputs: { text: 'string', search: 'string' }, outputs: { result: 'boolean' } });
const parse = (type: 'number' | 'integer') => (): PortShape => ({ inputs: { text: 'string' }, outputs: { value: type, ok: 'boolean' } });

export const TEXT_NODES = [
 defineNode({ type: 'text.concat', label: 'Concat', category: 'Text', keywords: ['string', 'text', 'join', 'append', 'combine', '+'], settings: z.strictObject({ count: z.number().int().min(2).max(8) }), ports: s => ({ inputs: numberedOf('text', Array(s.count).fill('string')), outputs: { result: 'string' } }), defaults: () => ({ count: 2 }), fields: [{ key: 'count', label: 'Inputs', kind: 'count', min: 2, max: 8 }], dynamicPorts: true }),
 defineNode({ type: 'text.format', label: 'Format String', category: 'Text', keywords: ['string', 'text', 'template', 'interpolate', 'placeholder'], settings: z.strictObject({ template: BlueprintStringSchema, args: z.array(z.enum(SCALAR_TYPES)).max(MAX_FORMAT_ARGS) }), ports: s => ({ inputs: numberedOf('arg', s.args), outputs: { result: 'string' } }), defaults: () => ({ template: '{0}', args: ['string' as ScalarType] }), fields: [{ key: 'template', label: 'Template', kind: 'string' }, { key: 'args', label: 'Arguments', kind: 'types', options: SCALAR_TYPES, max: MAX_FORMAT_ARGS }], dynamicPorts: true }),
 pure('text.length', 'String Length', ['length', 'count', 'size', 'characters'], () => ({ inputs: { text: 'string' }, outputs: { length: 'integer' } })),
 pure('text.substring', 'Substring', ['slice', 'cut', 'part', 'mid'], () => ({ inputs: { text: 'string', start: 'integer', length: 'integer' }, outputs: { result: 'string' } })),
 pure('text.contains', 'String Contains', ['contains', 'includes', 'find', 'search'], test),
 pure('text.startsWith', 'Starts With', ['prefix', 'begins'], test),
 pure('text.endsWith', 'Ends With', ['suffix', 'ends'], test),
 pure('text.replace', 'Replace String', ['replace', 'substitute', 'swap'], () => ({ inputs: { text: 'string', search: 'string', replacement: 'string' }, outputs: { result: 'string' } })),
 pure('text.toUpper', 'To Upper Case', ['upper', 'uppercase', 'capital'], unary),
 pure('text.toLower', 'To Lower Case', ['lower', 'lowercase'], unary),
 pure('text.trim', 'Trim String', ['trim', 'whitespace', 'strip'], unary),
 pure('text.split', 'Split String', ['split', 'separate', 'tokens', 'list'], () => ({ inputs: { text: 'string', separator: 'string' }, outputs: { result: 'string[]' } }), { separator: ',' }),
 pure('text.join', 'Join Strings', ['join', 'combine', 'list'], () => ({ inputs: { items: 'string[]', separator: 'string' }, outputs: { result: 'string' } }), { separator: ',' }),
 defineNode({ type: 'text.equals', label: 'String Equals', category: 'Text', keywords: ['string', 'text', 'compare', 'equal', 'same', '=='], settings: z.strictObject({ ignoreCase: z.boolean() }), ports: () => ({ inputs: { a: 'string', b: 'string' }, outputs: { result: 'boolean' } }), defaults: () => ({ ignoreCase: false }), fields: [{ key: 'ignoreCase', label: 'Ignore case', kind: 'boolean' }] }),
 defineNode({ type: 'text.toString', label: 'To String', category: 'Text', keywords: ['string', 'text', 'convert', 'format', 'number'], settings: z.strictObject({ type: z.enum(STRINGABLE) }), ports: s => ({ inputs: { value: s.type }, outputs: { result: 'string' } }), defaults: () => ({ type: 'number' as const }), fields: [{ key: 'type', label: 'Type', kind: 'choice', options: STRINGABLE.map(value => ({ value, label: DATA_TYPE_LABELS[value] })) }], dynamicPorts: true }),
 pure('text.parseNumber', 'Parse Number', ['parse', 'convert', 'float', 'number'], parse('number')),
 pure('text.parseInteger', 'Parse Integer', ['parse', 'convert', 'int', 'integer'], parse('integer')),
] as const;
