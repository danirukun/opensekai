import type { EvaluatorTable, FlowContext } from './types';
import './requests';

const control = (action: 'enable' | 'disable' | 'toggle') => ({ flow: (node: { settings: { graphId: string } }, c: FlowContext) => { c.request({ kind: 'control', graphId: node.settings.graphId, action }); c.follow('exit'); } });
export const GRAPH_CONTROL_EVALUATORS = {
 'blueprint.enable': control('enable'),
 'blueprint.disable': control('disable'),
 'blueprint.toggle': control('toggle'),
 'blueprint.isEnabled': { data: (node, _o, _r, _s, env) => env.graphEnabled?.(node.settings.graphId) ?? false },
} satisfies Partial<EvaluatorTable>;
