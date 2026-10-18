import { defaultBlueprintValue } from '@opensekai/contracts';
import { getNodeState, type BlueprintValue, type EvaluatorTable } from './types';
import './requests';

// Event nodes only start runs; the runner follows their output directly.
export const EVENT_EVALUATORS = {
 'event.manual': {},
 'event.keystroke': {},
 'event.enable': {},
 'event.update': { data: (_n, _o, _r, _s, env) => env.deltaSeconds },
 'event.disable': {},
 'event.emit': { flow: (node, c) => {
  c.request({ kind: 'emit', name: node.settings.name, payload: node.settings.payload === 'none' ? null : c.read('payload') });
  c.follow('exit');
 } },
 // The runtime stores the payload of the delivered event in the node state before the run.
 'event.custom': { data: (node, _o, _r, state) => getNodeState<BlueprintValue>(state, node.id) ?? defaultBlueprintValue(node.settings.payload === 'none' ? 'number' : node.settings.payload) },
} satisfies Partial<EvaluatorTable>;
