import { z } from 'zod';
import { defineNode, exit, IdSchema, type DefaultRefs } from './define';

const Target = z.strictObject({ graphId: IdSchema });
const target = (refs: DefaultRefs) => (refs.graphId ? { graphId: refs.graphId } : null);
const fields = [{ key: 'graphId', label: 'Blueprint', kind: 'graph' }] as const;
const action = () => ({ inputs: { flow: 'flow' as const }, outputs: { ...exit } });
export const GRAPH_CONTROL_NODES = [
 defineNode({ type: 'blueprint.enable', label: 'Enable Blueprint', category: 'Blueprints', keywords: ['start', 'activate', 'turn on', 'graph'], settings: Target, ports: action, defaults: target, fields }),
 defineNode({ type: 'blueprint.disable', label: 'Disable Blueprint', category: 'Blueprints', keywords: ['stop', 'deactivate', 'turn off', 'graph'], settings: Target, ports: action, defaults: target, fields }),
 defineNode({ type: 'blueprint.toggle', label: 'Toggle Blueprint', category: 'Blueprints', keywords: ['switch', 'flip', 'enable', 'disable', 'graph'], settings: Target, ports: action, defaults: target, fields }),
 defineNode({ type: 'blueprint.isEnabled', label: 'Is Blueprint Enabled', category: 'Blueprints', keywords: ['active', 'running', 'state', 'graph'], settings: Target, ports: () => ({ inputs: {}, outputs: { enabled: 'boolean' } }), defaults: target, fields }),
] as const;
