import { z } from 'zod';
import { defineNode, empty, exit, finite, numbered } from './define';

export const FLOW_NODES = [
 defineNode({ type: 'flow.branch', label: 'If Branch', category: 'Flow', keywords: ['if', 'condition', 'else'], settings: empty, ports: () => ({ inputs: { flow: 'flow', condition: 'boolean' }, outputs: { true: 'flow', false: 'flow' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'flow.sequence', label: 'Sequence', category: 'Flow', keywords: ['then', 'order', 'steps'], settings: z.strictObject({ outputs: z.number().int().min(2).max(8) }), ports: s => ({ inputs: { flow: 'flow' }, outputs: numbered('then', s.outputs) }), defaults: () => ({ outputs: 2 }), fields: [{ key: 'outputs', label: 'Outputs', kind: 'count', min: 2, max: 8 }], dynamicPorts: true }),
 defineNode({ type: 'flow.flipFlop', label: 'Flip Flop', category: 'Flow', keywords: ['toggle', 'alternate', 'switch'], settings: empty, ports: () => ({ inputs: { flow: 'flow' }, outputs: { a: 'flow', b: 'flow', isA: 'boolean' } }), defaults: () => ({}), fields: [] }),
 defineNode({ type: 'flow.delay', label: 'Delay', category: 'Flow', keywords: ['wait', 'timer', 'seconds', 'later'], settings: z.strictObject({ seconds: finite.min(0).max(3600) }), ports: () => ({ inputs: { flow: 'flow' }, outputs: { ...exit } }), defaults: () => ({ seconds: 1 }), fields: [{ key: 'seconds', label: 'Seconds', kind: 'number', min: 0, max: 3600 }] }),
] as const;
