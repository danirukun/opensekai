import type { EvaluatorTable } from './types';

export const FLOW_EVALUATORS = {
 'flow.branch': { flow: (_node, c) => c.follow(c.read('condition') ? 'true' : 'false') },
 'flow.sequence': { flow: (node, c) => c.follow(...Array.from({ length: node.settings.outputs }, (_, i) => `then${i}`)) },
 'flow.flipFlop': {
  data: (node, _output, _read, state) => state.flip.get(node.id) ?? false,
  flow: (node, c) => { const isA = !(c.state.flip.get(node.id) ?? false); c.state.flip.set(node.id, isA); c.follow(isA ? 'a' : 'b'); },
 },
 'flow.delay': { flow: (node, c) => c.delay(node.settings.seconds) },
} satisfies Partial<EvaluatorTable>;
