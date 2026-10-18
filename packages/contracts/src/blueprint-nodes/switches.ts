import { z } from 'zod';
import { BlueprintStringSchema } from './literals';
import { defineNode, numbered } from './define';

export const MAX_SWITCH_CASES = 8;
const distinct = <T>(cases: readonly T[]) => new Set(cases).size === cases.length;
const outputs = (count: number) => ({ ...numbered('case', count), default: 'flow' as const });
export const SWITCH_NODES = [
 defineNode({ type: 'switch.string', label: 'Switch On String', category: 'Switches', keywords: ['switch', 'case', 'select', 'choose', 'text', 'string'], settings: z.strictObject({ cases: z.array(BlueprintStringSchema).min(1).max(MAX_SWITCH_CASES).refine(distinct, 'Duplicate case') }), ports: s => ({ inputs: { flow: 'flow', value: 'string' }, outputs: outputs(s.cases.length) }), defaults: () => ({ cases: ['a', 'b'] }), fields: [{ key: 'cases', label: 'Cases', kind: 'stringCases' }], dynamicPorts: true }),
 defineNode({ type: 'switch.integer', label: 'Switch On Integer', category: 'Switches', keywords: ['switch', 'case', 'select', 'choose', 'integer', 'int'], settings: z.strictObject({ cases: z.array(z.number().int().min(-1e6).max(1e6)).min(1).max(MAX_SWITCH_CASES).refine(distinct, 'Duplicate case') }), ports: s => ({ inputs: { flow: 'flow', value: 'integer' }, outputs: outputs(s.cases.length) }), defaults: () => ({ cases: [0, 1] }), fields: [{ key: 'cases', label: 'Cases', kind: 'cases' }], dynamicPorts: true }),
] as const;
